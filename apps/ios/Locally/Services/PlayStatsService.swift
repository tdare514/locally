import Foundation

/// The plays in one range of days, over all the signed-in user's devices (#204): `tracks` for the
/// requested days (with `lastPlayedDay`), `allTime` for everything (`lastPlayedDay` is nil).
struct PlaysSummary: Equatable {
    var tracks: [PlayCount]
    var allTime: [PlayCount]
}

/// What a read of the summary came to. `.failed` and `.busy` mean there was nothing to show:
/// whenever a cached summary exists (even a stale one) the service returns it as `.ok` instead.
enum PlayStatsRead: Equatable {
    case ok(PlaysSummary)
    case signedOut
    case failed
    /// The phone's request budget or a back-off after a 429 stopped the read.
    case busy
}

/// What the Stats page reads. One production implementation (`SyncPlayStatsService`); tests use `FakePlayStats`.
protocol PlayStatsReading: AnyObject {
    /// The summary for `from`...`to` (`YYYY-MM-DD`). `force` skips the 5-minute freshness of the
    /// cache (pull to refresh), never the request budget or a back-off.
    @MainActor func summary(from: String, to: String, force: Bool) async -> PlayStatsRead
}

/// Reads `GET /v1/plays/summary` frugally. The server allows 60 requests an hour per user, shared
/// with the Mac (which keeps itself to 30), so this phone keeps to 20 page requests an hour, backs
/// off 10 minutes after a 429, caches each range for 5 minutes and shares one request between
/// concurrent callers of the same range.
@MainActor
final class SyncPlayStatsService: PlayStatsReading {
    static let freshSeconds: TimeInterval = 5 * 60
    static let maxCacheEntries = 12
    static let maxPages = 10
    static let budgetPerHour = 20
    static let budgetWindowSeconds: TimeInterval = 60 * 60
    static let backOffSeconds: TimeInterval = 10 * 60

    private struct Key: Hashable {
        var deviceId: String?
        var from: String
        var to: String
    }

    private struct Entry {
        var summary: PlaysSummary
        var fetchedAt: Date
    }

    private let api: SyncApi
    private let account: SyncAccountStore
    private let now: () -> Date

    /// Oldest first, so the front is the one to drop.
    private var cache: [(key: Key, entry: Entry)] = []
    private var cachedDeviceId: String?
    private var inFlight: [Key: Task<PlayStatsRead, Never>] = [:]
    private var requestTimes: [Date] = []
    private var backOffUntil: Date?
    /// How many callers joined a request already in flight (tests wait on this).
    private(set) var sharedJoins = 0

    init(api: SyncApi, account: SyncAccountStore, now: @escaping () -> Date = Date.init) {
        self.api = api
        self.account = account
        self.now = now
    }

    func summary(from: String, to: String, force: Bool) async -> PlayStatsRead {
        guard account.deviceToken != nil else {
            cache.removeAll()
            cachedDeviceId = nil
            return .signedOut
        }
        let deviceId = account.deviceId
        if deviceId != cachedDeviceId {
            cache.removeAll()
            cachedDeviceId = deviceId
        }
        let key = Key(deviceId: deviceId, from: from, to: to)
        if !force, let entry = cached(key), now().timeIntervalSince(entry.fetchedAt) < Self.freshSeconds {
            return .ok(entry.summary)
        }
        if let running = inFlight[key] {
            sharedJoins += 1
            return await running.value
        }
        let task = Task { await self.load(key, deviceId: deviceId) }
        inFlight[key] = task
        let result = await task.value
        inFlight[key] = nil
        return result
    }

    // MARK: - Loading

    private func cached(_ key: Key) -> Entry? {
        cache.first { $0.key == key }?.entry
    }

    private func store(_ summary: PlaysSummary, for key: Key) {
        cache.removeAll { $0.key == key }
        cache.append((key, Entry(summary: summary, fetchedAt: now())))
        while cache.count > Self.maxCacheEntries { cache.removeFirst() }
    }

    /// What to answer when nothing could be fetched: the cached summary if there is one.
    private func fallback(_ key: Key, empty: PlayStatsRead) -> PlayStatsRead {
        if let entry = cached(key) { return .ok(entry.summary) }
        return empty
    }

    /// Whether one more page request is allowed right now (and, if so, counts it).
    private func takeRequest() -> Bool {
        let current = now()
        if let until = backOffUntil, current < until { return false }
        requestTimes.removeAll { current.timeIntervalSince($0) >= Self.budgetWindowSeconds }
        guard requestTimes.count < Self.budgetPerHour else { return false }
        requestTimes.append(current)
        return true
    }

    private func load(_ key: Key, deviceId: String?) async -> PlayStatsRead {
        var tracks: [PlayCount] = []
        var allTime: [PlayCount] = []
        var cursor: String?
        var pages = 0
        while true {
            if pages >= Self.maxPages { return fallback(key, empty: .failed) }
            guard takeRequest() else { return fallback(key, empty: .busy) }
            pages += 1
            let page: SyncPlaysSummaryPage
            do {
                page = try await api.playsSummary(from: key.from, to: key.to, cursor: cursor)
            } catch SyncApiError.rateLimited {
                backOffUntil = now().addingTimeInterval(Self.backOffSeconds)
                return fallback(key, empty: .busy)
            } catch {
                // `.unauthorized` too: the sync engine owns sign-out.
                return fallback(key, empty: .failed)
            }
            tracks += page.tracks.map {
                PlayCount(trackId: $0.trackId, releaseId: $0.releaseId, plays: $0.plays, lastPlayedDay: $0.lastPlayedDay)
            }
            allTime += page.allTime.map {
                PlayCount(trackId: $0.trackId, releaseId: $0.releaseId, plays: $0.plays, lastPlayedDay: nil)
            }
            guard let next = page.nextCursor else { break }
            cursor = next
        }
        let summary = PlaysSummary(tracks: tracks, allTime: allTime)
        // A sign-out or another account while the pages were in flight: don't cache for the wrong one.
        if account.deviceToken != nil, account.deviceId == deviceId {
            store(summary, for: key)
        }
        return .ok(summary)
    }
}
