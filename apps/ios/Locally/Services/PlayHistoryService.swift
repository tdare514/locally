import Foundation

/// What a read of one window of play events came to. `.failed` and `.busy` mean there was nothing to show:
/// whenever an earlier answer for the window exists the service returns it as `.stale` instead.
enum PlayHistoryRead: Equatable {
    case ok([HistoryEvent])
    /// The last answer for the window, kept because a fresh read could not be made: `busy` when the request
    /// budget or a 429 stopped it, else offline or an error.
    case stale([HistoryEvent], busy: Bool)
    case signedOut
    case failed
    /// The phone's request budget or a back-off after a 429 stopped the read.
    case busy
}

/// What the History screen reads (#399). One production implementation (`SyncPlayHistoryService`); tests and the
/// gallery use fakes.
protocol PlayHistoryReading: AnyObject {
    /// The events with `from <= startedAt < to`, newest first, at most 400 days apart. `force` skips the 5-minute
    /// freshness of the cache (pull to refresh), never the request budget or a back-off.
    @MainActor func events(from: Date, to: Date, force: Bool) async -> PlayHistoryRead
}

/// Reads `GET /v1/plays/events` frugally, the way `SyncPlayStatsService` reads the summary: every page request is
/// taken from that service's hourly budget (the server shares one limit), a 429 starts its 10-minute back-off, each
/// window is cached for 5 minutes and concurrent readers of one window share a request. A window follows cursors
/// up to `maxPages` pages (500 events each); past that the newest events are kept and the older ones left out.
@MainActor
final class SyncPlayHistoryService: PlayHistoryReading {
    static let freshSeconds: TimeInterval = SyncPlayStatsService.freshSeconds
    static let maxCacheEntries = 40
    static let maxPages = 10

    private struct Identity: Hashable {
        var deviceId: String?
        var token: String?
    }

    private struct Key: Hashable {
        var identity: Identity
        var from: Int64
        var to: Int64
    }

    private struct Entry {
        var events: [HistoryEvent]
        var fetchedAt: Date
    }

    private let api: SyncApi
    private let account: SyncAccountStore
    private let budget: PlayRequestBudget
    private let now: () -> Date

    /// Oldest first, so the front is the one to drop.
    private var cache: [(key: Key, entry: Entry)] = []
    private var cachedIdentity: Identity?
    private var inFlight: [Key: Task<PlayHistoryRead, Never>] = [:]

    init(api: SyncApi, account: SyncAccountStore, budget: PlayRequestBudget, now: @escaping () -> Date = Date.init) {
        self.api = api
        self.account = account
        self.budget = budget
        self.now = now
    }

    private var identity: Identity { Identity(deviceId: account.deviceId, token: account.deviceToken) }

    func events(from: Date, to: Date, force: Bool) async -> PlayHistoryRead {
        guard account.deviceToken != nil else {
            cache.removeAll()
            cachedIdentity = nil
            return .signedOut
        }
        let session = identity
        if session != cachedIdentity {
            cache.removeAll()
            // The first read after a launch has no identity yet: keep the saved budget then.
            if cachedIdentity != nil { budget.resetBudget() }
            cachedIdentity = session
        }
        let key = Key(identity: session, from: Self.ms(from), to: Self.ms(to))
        if !force, let entry = cached(key), now().timeIntervalSince(entry.fetchedAt) < Self.freshSeconds {
            return .ok(entry.events)
        }
        if let running = inFlight[key] {
            return stillCurrent(await running.value, session)
        }
        let task = Task { await self.load(key) }
        inFlight[key] = task
        let result = await task.value
        inFlight[key] = nil
        return stillCurrent(result, session)
    }

    private static func ms(_ date: Date) -> Int64 { Int64((date.timeIntervalSince1970 * 1000).rounded()) }

    private func stillCurrent(_ result: PlayHistoryRead, _ session: Identity) -> PlayHistoryRead {
        session == identity ? result : identityChanged()
    }

    private func cached(_ key: Key) -> Entry? { cache.first { $0.key == key }?.entry }

    private func store(_ events: [HistoryEvent], for key: Key) {
        cache.removeAll { $0.key == key }
        cache.append((key, Entry(events: events, fetchedAt: now())))
        while cache.count > Self.maxCacheEntries { cache.removeFirst() }
    }

    /// What to answer when the window could not be read in full: the cached answer (stale), else what the pages
    /// already read held, else the empty failure.
    private func fallback(_ key: Key, partial: [HistoryEvent], busy: Bool) -> PlayHistoryRead {
        guard key.identity == identity else { return identityChanged() }
        if let entry = cached(key) { return .stale(entry.events, busy: busy) }
        if !partial.isEmpty { return .stale(partial, busy: busy) }
        return busy ? .busy : .failed
    }

    private func identityChanged() -> PlayHistoryRead {
        cache.removeAll { $0.key.identity != identity }
        if account.deviceToken == nil {
            cache.removeAll()
            cachedIdentity = nil
            return .signedOut
        }
        return .failed
    }

    private func load(_ key: Key) async -> PlayHistoryRead {
        var events: [HistoryEvent] = []
        var cursor: String?
        var pages = 0
        while pages < Self.maxPages {
            guard key.identity == identity else { return identityChanged() }
            guard budget.takeRequest() else { return fallback(key, partial: events, busy: true) }
            pages += 1
            let page: SyncPlayEventsPage
            do {
                page = try await api.playEvents(from: key.from, to: key.to, cursor: cursor)
            } catch SyncApiError.rateLimited {
                budget.startBackOff()
                return fallback(key, partial: events, busy: true)
            } catch SyncApiError.notFound {
                // An API that predates the route: nothing to show, quietly. Kept like any answer so it is not asked again for 5 minutes.
                guard key.identity == identity else { return identityChanged() }
                store([], for: key)
                return .ok([])
            } catch SyncApiError.unreachable {
                // No HTTP response: the service never saw it, so it does not count against the budget.
                budget.refundLastRequest()
                return fallback(key, partial: events, busy: false)
            } catch {
                return fallback(key, partial: events, busy: false)
            }
            guard key.identity == identity else { return identityChanged() }
            events += page.events.map {
                HistoryEvent(
                    id: $0.id, releaseId: $0.releaseId, trackId: $0.trackId, source: $0.source, startedAt: $0.startedAt,
                    day: $0.day, listenedMs: $0.listenedMs,
                    device: HistoryDevice(name: $0.device.name, platform: $0.device.platform, current: $0.device.current))
            }
            guard let next = page.nextCursor else { break }
            cursor = next
        }
        store(events, for: key)
        return .ok(events)
    }
}
