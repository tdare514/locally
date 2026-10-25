import Foundation
import Testing
@testable import Locally

@MainActor
struct PlayHistoryServiceTests {
    private struct Setup {
        let service: SyncPlayHistoryService
        let stats: SyncPlayStatsService
        let api: FakeSyncApi
        let account: InMemorySyncAccountStore
        let clock: TestClock
        let defaults: UserDefaults
    }

    private static let from = Date(timeIntervalSince1970: 1_799_000_000)
    private static let to = Date(timeIntervalSince1970: 1_799_100_000)

    private func make(signedIn: Bool = true, script: [Result<SyncPlayEventsPage, Error>] = []) -> Setup {
        let api = FakeSyncApi()
        api.playEventsScript = script
        let account = InMemorySyncAccountStore()
        if signedIn { account.save(email: "a@example.com", deviceToken: "token", deviceId: "device-1") }
        let clock = TestClock()
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let stats = SyncPlayStatsService(api: api, account: account, now: { clock.date }, defaults: defaults)
        let service = SyncPlayHistoryService(api: api, account: account, budget: stats, now: { clock.date })
        return Setup(service: service, stats: stats, api: api, account: account, clock: clock, defaults: defaults)
    }

    private func stored(_ id: String) -> SyncStoredPlayEvent {
        SyncStoredPlayEvent(
            id: id, releaseId: UUID(uuidString: "00000000-0000-0000-0000-0000000000a1")!, trackId: UUID(uuidString: "00000000-0000-0000-0000-0000000000a2")!,
            source: "locally", startedAt: 1_799_050_000_000, day: "2026-10-24", listenedMs: 60_000,
            device: .init(id: "d1", name: "iPhone", platform: "ios", current: true))
    }

    private func page(_ ids: [String], cursor: String? = nil) -> Result<SyncPlayEventsPage, Error> {
        .success(SyncPlayEventsPage(events: ids.map(stored), nextCursor: cursor))
    }

    private func ids(_ read: PlayHistoryRead) -> [String]? {
        switch read {
        case .ok(let events), .stale(let events, _): return events.map(\.id)
        default: return nil
        }
    }

    /// For a stale answer, whether it was kept because the service was busy; nil for any other answer.
    private func staleBusy(_ read: PlayHistoryRead) -> Bool? {
        if case .stale(_, let busy) = read { return busy }
        return nil
    }

    private func read(_ s: Setup, force: Bool = false) async -> PlayHistoryRead {
        await s.service.events(from: Self.from, to: Self.to, force: force)
    }

    @Test func sendsTheWindowAsIntegerMillisecondsAndMapsTheEvents() async {
        let s = make(script: [page(["e1", "e2"])])
        let result = await read(s)
        #expect(ids(result) == ["e1", "e2"])
        #expect(s.api.playEventsCalls.count == 1)
        #expect(s.api.playEventsCalls[0].from == 1_799_000_000_000)
        #expect(s.api.playEventsCalls[0].to == 1_799_100_000_000)
        #expect(s.api.playEventsCalls[0].cursor == nil)
        if case .ok(let events) = result {
            #expect(events[0].device == HistoryDevice(name: "iPhone", platform: "ios", current: true))
            #expect(events[0].startedAt == 1_799_050_000_000)
        }
    }

    @Test func followsCursorsAndStopsAtTheLastPage() async {
        let s = make(script: [page(["a"], cursor: "c1"), page(["b"], cursor: "c2"), page(["c"])])
        #expect(ids(await read(s)) == ["a", "b", "c"])
        #expect(s.api.playEventsCalls.map(\.cursor) == [nil, "c1", "c2"])
    }

    @Test func stopsAtTheTenPageCapKeepingTheNewestEvents() async {
        // Every page has a cursor: the service reads ten and stops, keeping what it has.
        let s = make(script: [page(["x"], cursor: "more")])
        let result = await read(s)
        #expect(s.api.playEventsCalls.count == SyncPlayHistoryService.maxPages)
        #expect(SyncPlayHistoryService.maxPages == 10)
        #expect(ids(result)?.count == 10)
        if case .ok = result {} else { Issue.record("expected .ok, got \(result)") }
    }

    @Test func aWindowIsCachedForFiveMinutes() async {
        let s = make(script: [page(["a"])])
        _ = await read(s)
        s.clock.advance(4 * 60)
        #expect(ids(await read(s)) == ["a"])
        #expect(s.api.playEventsCalls.count == 1)
        s.clock.advance(2 * 60)
        _ = await read(s)
        #expect(s.api.playEventsCalls.count == 2)
    }

    @Test func forceSkipsTheCacheAndAnotherWindowHasItsOwn() async {
        let s = make(script: [page(["a"])])
        _ = await read(s)
        _ = await read(s, force: true)
        #expect(s.api.playEventsCalls.count == 2)
        _ = await s.service.events(from: Self.from.addingTimeInterval(-86_400), to: Self.from, force: false)
        #expect(s.api.playEventsCalls.count == 3)
    }

    @Test func eachPageSpendsTheSummarysHourlyBudget() async {
        let s = make(script: [page(["a"], cursor: "c1"), page(["b"])])
        _ = await s.stats.summary(from: "2026-10-01", to: "2026-10-15", force: false)
        _ = await read(s)
        // One summary page and two event pages on the one list.
        #expect(s.defaults.array(forKey: SyncPlayStatsService.requestTimesKey)?.count == 3)
    }

    @Test func stopsWhenTheHourlyBudgetIsSpentAndKeepsTheLastAnswer() async {
        let s = make(script: [page(["a"])])
        _ = await read(s)
        for _ in 0..<(SyncPlayStatsService.budgetPerHour - 1) { _ = await read(s, force: true) }
        let before = s.api.playEventsCalls.count
        #expect(before == SyncPlayStatsService.budgetPerHour)
        // The budget is spent: no request, the cached answer comes back as stale and busy.
        let kept = await read(s, force: true)
        #expect(ids(kept) == ["a"])
        #expect(staleBusy(kept) == true)
        #expect(s.api.playEventsCalls.count == before)
        // A window with no earlier answer is simply busy.
        let other = await s.service.events(from: Self.from.addingTimeInterval(-9_999_999), to: Self.from, force: false)
        #expect(other == .busy)
        #expect(s.api.playEventsCalls.count == before)
        s.clock.advance(SyncPlayStatsService.budgetWindowSeconds + 1)
        _ = await read(s, force: true)
        #expect(s.api.playEventsCalls.count == before + 1)
    }

    @Test func aTooManyRequestsBacksOffTenMinutesForEveryRead() async {
        let s = make(script: [.failure(SyncApiError.rateLimited), page(["a"])])
        #expect(await read(s) == .busy)
        #expect(s.api.playEventsCalls.count == 1)
        s.clock.advance(9 * 60)
        #expect(await read(s) == .busy)
        #expect(s.api.playEventsCalls.count == 1) // no request while backing off
        // The summary is held back by the same back-off.
        _ = await s.stats.summary(from: "2026-10-01", to: "2026-10-15", force: false)
        #expect(s.api.playsSummaryCalls.isEmpty)
        s.clock.advance(2 * 60)
        #expect(ids(await read(s)) == ["a"])
        #expect(s.api.playEventsCalls.count == 2)
    }

    @Test func aTooManyRequestsKeepsTheLastAnswerAsStaleAndBusy() async {
        let s = make(script: [page(["a"]), .failure(SyncApiError.rateLimited)])
        _ = await read(s)
        let result = await read(s, force: true)
        #expect(ids(result) == ["a"])
        #expect(staleBusy(result) == true)
    }

    @Test func aNotFoundMeansAnOlderApiAndGivesAnEmptyAnswerQuietly() async {
        let s = make(script: [.failure(SyncApiError.notFound)])
        #expect(await read(s) == .ok([]))
        // Kept like any answer: not asked again inside five minutes, and no back-off for others.
        #expect(await read(s) == .ok([]))
        #expect(s.api.playEventsCalls.count == 1)
        let ok = await s.stats.summary(from: "2026-10-01", to: "2026-10-15", force: false)
        #expect(ok == .ok(PlaysSummary(tracks: [], allTime: [])))
    }

    @Test func signedOutAsksForNothing() async {
        let s = make(signedIn: false)
        #expect(await read(s) == .signedOut)
        #expect(s.api.playEventsCalls.isEmpty)
    }

    @Test func offlineKeepsTheLastAnswerAndDoesNotSpendTheBudget() async {
        let s = make(script: [page(["a"]), .failure(SyncApiError.unreachable("offline"))])
        _ = await read(s)
        let result = await read(s, force: true)
        #expect(ids(result) == ["a"])
        #expect(staleBusy(result) == false)
        #expect(s.defaults.array(forKey: SyncPlayStatsService.requestTimesKey)?.count == 1) // only the request that arrived
    }

    @Test func aFailureWithNothingKeptIsFailed() async {
        let s = make(script: [.failure(SyncApiError.network("boom"))])
        #expect(await read(s) == .failed)
    }

    @Test func aSwitchedAccountDoesNotSeeTheFirstOnesAnswer() async {
        let s = make(script: [page(["a"])])
        _ = await read(s)
        s.account.save(email: "b@example.com", deviceToken: "other", deviceId: "device-2")
        s.api.playEventsScript = [page(["b"])]
        #expect(ids(await read(s)) == ["b"])
        #expect(s.api.playEventsCalls.count == 2)
    }
}
