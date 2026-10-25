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

/// The phone's share of the server's per-user request limit, which the summary and the events routes both spend
/// (`playsSummary`, 600 an hour). `SyncPlayStatsService` keeps it; the History service spends from the same one.
@MainActor
protocol PlayRequestBudget: AnyObject {
    /// Whether one more request is allowed now (and, if so, counts it).
    func takeRequest() -> Bool
    /// Gives back the latest request: it never reached the service. `identity` is the budget key the request was
    /// charged under; a request that outlived its account (the budget has moved on) is ignored.
    func refundLastRequest(identity: String?)
    /// A 429: no request for the back-off. Ignored when `identity` is no longer the budget's account.
    func startBackOff(identity: String?)
    /// The budget belongs to one account (`identity`, nil when signed out). A real change of account resets the
    /// per-hour list and the back-off once; the same identity again is a no-op, so whichever service sees the new
    /// account first resets it and the other cannot erase a back-off the new account has earned since.
    func ensure(identity: String?)
}

/// Reads `GET /v1/plays/summary` frugally. The server allows 600 requests an hour per user, shared
/// with the Mac (which keeps itself to 200), so this phone keeps to 200 page requests an hour (a
/// request that provably never left the phone is not counted; a timeout is), backs
/// off 10 minutes after a 429, caches each range for 5 minutes and shares one request between
/// concurrent callers of the same range.
@MainActor
final class SyncPlayStatsService: PlayStatsReading, PlayRequestBudget {
    static let freshSeconds: TimeInterval = 5 * 60
    static let maxCacheEntries = 12
    static let maxPages = 10
    static let budgetPerHour = 200
    static let budgetWindowSeconds: TimeInterval = 60 * 60
    static let backOffSeconds: TimeInterval = 10 * 60

    /// Who the phone is signed in as: a read belongs to one identity and never outlives it.
    private struct Identity: Hashable {
        var deviceId: String?
        var token: String?
        var budgetKey: String { "\(deviceId ?? "")|\(token ?? "")" }
    }

    private struct Key: Hashable {
        var identity: Identity
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
    private var cachedIdentity: Identity?
    /// Who the budget and back-off belong to (see `ensure(identity:)`).
    private var budgetIdentity: String?
    private var inFlight: [Key: Task<PlayStatsRead, Never>] = [:]
    private var requestTimes: [Date] = [] { didSet { saveBudget() } }
    private var backOffUntil: Date? { didSet { saveBudget() } }
    private let defaults: UserDefaults
    static let requestTimesKey = "playstats.requestTimes"
    static let backOffKey = "playstats.backOffUntil"
    /// How many callers joined a request already in flight (tests wait on this).
    private(set) var sharedJoins = 0

    /// `defaults` keeps the request budget and back-off across launches, so relaunching does not
    /// hand the phone a fresh hour.
    init(api: SyncApi, account: SyncAccountStore, now: @escaping () -> Date = Date.init, defaults: UserDefaults = .standard) {
        self.api = api
        self.account = account
        self.now = now
        self.defaults = defaults
        let current = now()
        let saved = (defaults.array(forKey: Self.requestTimesKey) as? [Double] ?? [])
            .map { Date(timeIntervalSince1970: $0) }
            .filter { current.timeIntervalSince($0) < Self.budgetWindowSeconds && $0 <= current }
            .suffix(Self.budgetPerHour)
        requestTimes = Array(saved)
        if let until = defaults.object(forKey: Self.backOffKey) as? Double, Date(timeIntervalSince1970: until) > current {
            backOffUntil = Date(timeIntervalSince1970: until)
        }
    }

    private func saveBudget() {
        defaults.set(requestTimes.map(\.timeIntervalSince1970), forKey: Self.requestTimesKey)
        if let backOffUntil {
            defaults.set(backOffUntil.timeIntervalSince1970, forKey: Self.backOffKey)
        } else {
            defaults.removeObject(forKey: Self.backOffKey)
        }
    }

    private var identity: Identity { Identity(deviceId: account.deviceId, token: account.deviceToken) }

    func summary(from: String, to: String, force: Bool) async -> PlayStatsRead {
        guard account.deviceToken != nil else {
            cache.removeAll()
            cachedIdentity = nil
            ensure(identity: nil)
            return .signedOut
        }
        let session = identity
        if session != cachedIdentity {
            cache.removeAll()
            cachedIdentity = session
        }
        ensure(identity: session.budgetKey)
        let key = Key(identity: session, from: from, to: to)
        if !force, let entry = cached(key), now().timeIntervalSince(entry.fetchedAt) < Self.freshSeconds {
            return .ok(entry.summary)
        }
        if let running = inFlight[key] {
            sharedJoins += 1
            return stillCurrent(await running.value, session)
        }
        let task = Task { await self.load(key) }
        inFlight[key] = task
        let result = await task.value
        inFlight[key] = nil
        return stillCurrent(result, session)
    }

    /// A load can finish for one account and the phone switch before the caller resumes: what comes
    /// back must still be for whoever is signed in when it is returned.
    private func stillCurrent(_ result: PlayStatsRead, _ session: Identity) -> PlayStatsRead {
        session == identity ? result : identityChanged()
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

    /// What to answer when nothing could be fetched: the cached summary if there is one, and only
    /// one of the identity that is signed in now.
    private func fallback(_ key: Key, empty: PlayStatsRead) -> PlayStatsRead {
        guard key.identity == identity else { return identityChanged() }
        if let entry = cached(key) { return .ok(entry.summary) }
        return empty
    }

    /// The account changed or signed out while a read was under way: nothing fetched is kept or returned.
    private func identityChanged() -> PlayStatsRead {
        cache.removeAll { $0.key.identity != identity }
        if account.deviceToken == nil {
            cache.removeAll()
            cachedIdentity = nil
            ensure(identity: nil)
            return .signedOut
        }
        return .failed
    }

    /// Whether one more page request is allowed right now (and, if so, counts it).
    func takeRequest() -> Bool {
        let current = now()
        if let until = backOffUntil, current < until { return false }
        requestTimes.removeAll { current.timeIntervalSince($0) >= Self.budgetWindowSeconds }
        guard requestTimes.count < Self.budgetPerHour else { return false }
        requestTimes.append(current)
        return true
    }

    /// A new identity starts with a fresh budget and no back-off: both belong to the account that spent them.
    /// The first identity after a launch keeps the saved budget.
    func ensure(identity: String?) {
        guard identity != budgetIdentity else { return }
        let first = budgetIdentity == nil
        budgetIdentity = identity
        if !first {
            requestTimes = []
            backOffUntil = nil
        }
    }

    func refundLastRequest(identity: String?) {
        guard identity == budgetIdentity else { return }
        if !requestTimes.isEmpty { requestTimes.removeLast() }
    }

    func startBackOff(identity: String?) {
        guard identity == budgetIdentity else { return }
        backOffUntil = now().addingTimeInterval(Self.backOffSeconds)
    }

    private func load(_ key: Key) async -> PlayStatsRead {
        var tracks: [PlayCount] = []
        var allTime: [PlayCount] = []
        var cursor: String?
        var pages = 0
        while true {
            guard key.identity == identity else { return identityChanged() }
            if pages >= Self.maxPages { return fallback(key, empty: .failed) }
            guard takeRequest() else { return fallback(key, empty: .busy) }
            pages += 1
            let page: SyncPlaysSummaryPage
            do {
                page = try await api.playsSummary(from: key.from, to: key.to, cursor: cursor)
            } catch SyncApiError.rateLimited {
                startBackOff(identity: key.identity.budgetKey)
                return fallback(key, empty: .busy)
            } catch SyncApiError.unreachable(_, let beforeDelivery) {
                // Only a failure known to happen before delivery is given back; a timeout may have been counted.
                if beforeDelivery { refundLastRequest(identity: key.identity.budgetKey) }
                return fallback(key, empty: .failed)
            } catch {
                // `.unauthorized` too: the sync engine owns sign-out.
                return fallback(key, empty: .failed)
            }
            // The request goes out with whatever token is current when it is sent, so a switch
            // while it was in flight may have fetched another account's page: drop it all.
            guard key.identity == identity else { return identityChanged() }
            tracks += page.tracks.map {
                PlayCount(
                    trackId: $0.trackId, releaseId: $0.releaseId, plays: $0.plays, lastPlayedDay: $0.lastPlayedDay,
                    lastPlayedAt: $0.lastPlayedAt, listenedMs: $0.listenedMs, events: $0.events
                )
            }
            allTime += page.allTime.map {
                PlayCount(
                    trackId: $0.trackId, releaseId: $0.releaseId, plays: $0.plays, lastPlayedDay: nil,
                    lastPlayedAt: $0.lastPlayedAt, listenedMs: $0.listenedMs, events: $0.events
                )
            }
            guard let next = page.nextCursor else { break }
            cursor = next
        }
        let summary = PlaysSummary(tracks: tracks, allTime: allTime)
        store(summary, for: key)
        return .ok(summary)
    }
}
