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
        case .ok(let events), .stale(let events, _), .partial(let events, _, _): return events.map(\.id)
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

    @Test func stopsAtTheTenPageCapAndAnswersPartialWithTheCursorLeft() async {
        // Every page has a cursor: the service reads ten and stops, and says the window is not complete.
        let s = make(script: [page(["x"], cursor: "more")])
        let result = await read(s)
        #expect(s.api.playEventsCalls.count == SyncPlayHistoryService.maxPages)
        #expect(SyncPlayHistoryService.maxPages == 10)
        #expect(ids(result)?.count == 10)
        guard case .partial(_, let cursor, let busy) = result else { Issue.record("expected .partial, got \(result)"); return }
        #expect(cursor == "more")
        #expect(busy == nil)
    }

    @Test func aCappedWindowIsNotCachedAndContinuingFetchesTheRest() async {
        let capped = (1...SyncPlayHistoryService.maxPages).map { page(["p\($0)"], cursor: "c\($0)") }
        let s = make(script: capped + [page(["last"])])
        let first = await read(s)
        guard case .partial(_, let cursor, _) = first else { Issue.record("expected .partial, got \(first)"); return }
        #expect(cursor == "c10")
        // Continuing starts at that cursor and answers only what follows, as a whole.
        let rest = await s.service.events(from: Self.from, to: Self.to, force: false, cursor: cursor)
        #expect(ids(rest) == ["last"])
        if case .ok = rest {} else { Issue.record("expected .ok, got \(rest)") }
        #expect(s.api.playEventsCalls.count == SyncPlayHistoryService.maxPages + 1)
        #expect(s.api.playEventsCalls.last?.cursor == "c10")
        // Nothing was cached as complete: a plain read goes out again from the first page.
        _ = await read(s)
        #expect(s.api.playEventsCalls.count > SyncPlayHistoryService.maxPages + 1)
        #expect(s.api.playEventsCalls[SyncPlayHistoryService.maxPages + 1].cursor == nil)
    }

    @Test func aFailureOnPageThreeIsPartialAndARetryResumesFromPageThreesCursor() async {
        let s = make(script: [page(["a"], cursor: "c1"), page(["b"], cursor: "c2"), .failure(SyncApiError.network("boom"))])
        let first = await read(s)
        guard case .partial(let events, let cursor, let busy) = first else { Issue.record("expected .partial, got \(first)"); return }
        #expect(events.map(\.id) == ["a", "b"])
        #expect(cursor == "c2") // the cursor page 3 was asked with
        #expect(busy == false)
        s.api.playEventsScript = [page(["c"])]
        let rest = await s.service.events(from: Self.from, to: Self.to, force: false, cursor: cursor)
        #expect(ids(rest) == ["c"])
        #expect(s.api.playEventsCalls.last?.cursor == "c2")
        // The partial answer was not kept as a complete window.
        _ = await read(s)
        #expect(s.api.playEventsCalls.last?.cursor == nil)
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

    @Test func aTimeoutKeepsTheBudgetChargeBecauseTheRequestMayHaveArrived() async {
        let s = make(script: [page(["a"]), .failure(SyncApiError.unreachable("timed out"))])
        _ = await read(s)
        let result = await read(s, force: true)
        #expect(ids(result) == ["a"])
        #expect(s.defaults.array(forKey: SyncPlayStatsService.requestTimesKey)?.count == 2)
    }

    @Test func switchingAccountsDropsTheServicesCache() async {
        let s = make(script: [page(["a"])])
        let before = s.service.session
        _ = await read(s)
        s.account.save(email: "b@example.com", deviceToken: "other", deviceId: "device-2")
        #expect(s.service.session != before)
        // Back to the first account: what it had cached is gone, so this goes to the service again.
        s.account.save(email: "a@example.com", deviceToken: "token", deviceId: "device-1")
        _ = await read(s)
        #expect(s.api.playEventsCalls.count == 2)
    }

    @Test func offlineKeepsTheLastAnswerAndDoesNotSpendTheBudget() async {
        let s = make(script: [page(["a"]), .failure(SyncApiError.unreachable("offline", beforeDelivery: true))])
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

    // MARK: One budget identity

    private func emptySummary() -> Result<SyncPlaysSummaryPage, Error> {
        .success(SyncPlaysSummaryPage(tracks: [], allTime: [], nextCursor: nil))
    }

    private func switchToB(_ s: Setup) {
        s.account.save(email: "b@example.com", deviceToken: "other", deviceId: "device-2")
    }

    @Test func aHistoryBackOffForTheNewAccountSurvivesTheStatsServiceSeeingTheSwitch() async {
        let s = make(script: [page(["a"]), .failure(SyncApiError.rateLimited)])
        s.api.playsSummaryScript = [emptySummary(), emptySummary()]
        _ = await read(s)
        _ = await s.stats.summary(from: "2026-10-01", to: "2026-10-15", force: false)
        let summaries = s.api.playsSummaryCalls.count
        switchToB(s)
        #expect(await read(s) == .busy) // B's 429
        _ = await s.stats.summary(from: "2026-10-01", to: "2026-10-15", force: false)
        #expect(s.api.playsSummaryCalls.count == summaries) // B's back-off holds
    }

    @Test func aStatsBackOffForTheNewAccountSurvivesTheHistoryServiceSeeingTheSwitch() async {
        let s = make(script: [page(["a"]), page(["b"])])
        s.api.playsSummaryScript = [emptySummary(), .failure(SyncApiError.rateLimited)]
        _ = await read(s)
        _ = await s.stats.summary(from: "2026-10-01", to: "2026-10-15", force: false)
        switchToB(s)
        _ = await s.stats.summary(from: "2026-10-01", to: "2026-10-15", force: false) // B's 429
        let events = s.api.playEventsCalls.count
        #expect(await read(s) == .busy)
        #expect(s.api.playEventsCalls.count == events)
    }

    @Test func switchingBackToTheFirstAccountDoesNotInheritTheSecondsBackOff() async {
        let s = make(script: [page(["a"]), .failure(SyncApiError.rateLimited), page(["a2"])])
        _ = await read(s)
        switchToB(s)
        #expect(await read(s) == .busy)
        s.account.save(email: "a@example.com", deviceToken: "token", deviceId: "device-1")
        #expect(ids(await read(s)) == ["a2"])
    }

    // MARK: A late error from the old account leaves the new account's budget alone

    private func holdEvents(_ s: Setup, _ latch: Latch) {
        s.api.playEventsGate = { [api = s.api] in
            if api.playEventsCalls.count == 1 { await latch.wait() }
        }
    }

    private func waitForEvents(_ s: Setup) async {
        for _ in 0..<2000 where s.api.playEventsCalls.count < 1 { try? await Task.sleep(nanoseconds: 2_000_000) }
    }

    @Test func aLateTooManyRequestsFromTheOldAccountDoesNotBackOffTheNewOne() async {
        let s = make(script: [.failure(SyncApiError.rateLimited), page(["b"]), page(["b2"])])
        let latch = Latch()
        holdEvents(s, latch)
        let task = Task { await self.read(s) }
        await waitForEvents(s)
        switchToB(s)
        #expect(ids(await read(s)) == ["b"]) // B's request completes
        latch.release()
        _ = await task.value
        #expect(ids(await read(s, force: true)) == ["b2"]) // no back-off: B's next request is sent
        #expect(s.api.playEventsCalls.count == 3)
    }

    @Test func aLateUnreachableFromTheOldAccountDoesNotRefundTheNewOnesRequest() async {
        let s = make(script: [.failure(SyncApiError.unreachable("offline", beforeDelivery: true)), page(["b"])])
        let latch = Latch()
        holdEvents(s, latch)
        let task = Task { await self.read(s) }
        await waitForEvents(s)
        switchToB(s)
        #expect(ids(await read(s)) == ["b"])
        #expect(s.defaults.array(forKey: SyncPlayStatsService.requestTimesKey)?.count == 1)
        latch.release()
        _ = await task.value
        #expect(s.defaults.array(forKey: SyncPlayStatsService.requestTimesKey)?.count == 1)
    }
}
