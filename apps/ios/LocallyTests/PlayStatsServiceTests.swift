import Foundation
import Testing
@testable import Locally

/// A hand-moved clock for the service's cache, budget and back-off.
final class TestClock: @unchecked Sendable {
    var date = Date(timeIntervalSince1970: 1_800_000_000)
    func advance(_ seconds: TimeInterval) { date = date.addingTimeInterval(seconds) }
}

/// Holds a fake request open until the test lets it go.
final class Latch: @unchecked Sendable {
    private let lock = NSLock()
    private var open = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        await withCheckedContinuation { continuation in
            lock.lock()
            if open {
                lock.unlock()
                continuation.resume()
            } else {
                waiters.append(continuation)
                lock.unlock()
            }
        }
    }

    func release() {
        lock.lock()
        open = true
        let pending = waiters
        waiters = []
        lock.unlock()
        pending.forEach { $0.resume() }
    }
}

@MainActor
struct PlayStatsServiceTests {
    private struct Setup {
        let service: SyncPlayStatsService
        let api: FakeSyncApi
        let account: InMemorySyncAccountStore
        let clock: TestClock
        let defaults: UserDefaults
    }

    private func make(signedIn: Bool = true, script: [Result<SyncPlaysSummaryPage, Error>] = []) -> Setup {
        let api = FakeSyncApi()
        api.playsSummaryScript = script
        let account = InMemorySyncAccountStore()
        if signedIn { account.save(email: "a@example.com", deviceToken: "token", deviceId: "device-1") }
        let clock = TestClock()
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let service = SyncPlayStatsService(api: api, account: account, now: { clock.date }, defaults: defaults)
        return Setup(service: service, api: api, account: account, clock: clock, defaults: defaults)
    }

    private func page(_ plays: Int = 1, cursor: String? = nil, track: String = "t1") -> Result<SyncPlaysSummaryPage, Error> {
        .success(SyncPlaysSummaryPage(
            tracks: [SyncPeriodPlays(trackId: track, releaseId: "r1", plays: plays, lastPlayedDay: "2026-10-14")],
            allTime: [SyncAllTimePlays(trackId: track, releaseId: "r1", plays: plays * 10)],
            nextCursor: cursor
        ))
    }

    private func summary(_ plays: Int = 1, track: String = "t1") -> PlaysSummary {
        PlaysSummary(
            tracks: [PlayCount(trackId: track, releaseId: "r1", plays: plays, lastPlayedDay: "2026-10-14")],
            allTime: [PlayCount(trackId: track, releaseId: "r1", plays: plays * 10, lastPlayedDay: nil)]
        )
    }

    private func read(_ s: Setup, _ from: String = "2026-10-12", _ to: String = "2026-10-15", force: Bool = false) async -> PlayStatsRead {
        await s.service.summary(from: from, to: to, force: force)
    }

    @Test func signedOutMakesNoRequest() async {
        let s = make(signedIn: false)
        #expect(await read(s) == .signedOut)
        #expect(s.api.playsSummaryCalls.isEmpty)
    }

    @Test func signingOutDropsTheCache() async {
        let s = make(script: [page(1)])
        _ = await read(s)
        s.account.clear()
        #expect(await read(s) == .signedOut)
        s.account.save(email: "a@example.com", deviceToken: "token", deviceId: "device-1")
        #expect(await read(s) == .ok(summary(1))) // fetched again, not served from before
        #expect(s.api.playsSummaryCalls.count == 2)
    }

    @Test func aFreshCacheServesWithoutARequestAndStaleRefetches() async {
        let s = make(script: [page(1), page(2)])
        #expect(await read(s) == .ok(summary(1)))
        s.clock.advance(4 * 60)
        #expect(await read(s) == .ok(summary(1)))
        #expect(s.api.playsSummaryCalls.count == 1)
        s.clock.advance(61)
        #expect(await read(s) == .ok(summary(2)))
        #expect(s.api.playsSummaryCalls.count == 2)
    }

    @Test func forceSkipsFreshness() async {
        let s = make(script: [page(1), page(2)])
        _ = await read(s)
        #expect(await read(s, force: true) == .ok(summary(2)))
        #expect(s.api.playsSummaryCalls.count == 2)
    }

    @Test func sendsTheRangeAndFollowsCursorsMergingPages() async {
        let s = make(script: [page(1, cursor: "t1", track: "t1"), page(2, cursor: "t2", track: "t2"), page(3, track: "t3")])
        let result = await read(s, "2026-10-01", "2026-10-15")
        guard case .ok(let merged) = result else { Issue.record("expected .ok, got \(result)"); return }
        #expect(merged.tracks.map(\.trackId) == ["t1", "t2", "t3"])
        #expect(merged.allTime.map(\.plays) == [10, 20, 30])
        #expect(merged.allTime.allSatisfy { $0.lastPlayedDay == nil })
        #expect(s.api.playsSummaryCalls.map(\.cursor) == [nil, "t1", "t2"])
        #expect(s.api.playsSummaryCalls.allSatisfy { $0.from == "2026-10-01" && $0.to == "2026-10-15" })
    }

    @Test func concurrentReadsOfTheSameRangeShareOneRequest() async {
        let s = make(script: [page(1)])
        let latch = Latch()
        s.api.playsSummaryGate = { await latch.wait() }
        let first = Task { await self.read(s) }
        let second = Task { await self.read(s, force: true) }
        for _ in 0..<2000 where s.service.sharedJoins < 1 { try? await Task.sleep(nanoseconds: 2_000_000) }
        #expect(s.service.sharedJoins == 1)
        latch.release()
        let results = [await first.value, await second.value]
        #expect(results == [.ok(summary(1)), .ok(summary(1))])
        #expect(s.api.playsSummaryCalls.count == 1)
    }

    @Test func moreThanTenPagesIsFailed() async {
        let s = make(script: [page(1, cursor: "next")])
        #expect(await read(s) == .failed)
        #expect(s.api.playsSummaryCalls.count == 10)
    }

    @Test func exactlyTenPagesIsFine() async {
        let script = (1...10).map { page(1, cursor: $0 < 10 ? "c\($0)" : nil, track: "t\($0)") }
        let s = make(script: script)
        guard case .ok(let merged) = await read(s) else { Issue.record("expected .ok"); return }
        #expect(merged.tracks.count == 10)
    }

    @Test func aRateLimitBacksOffTenMinutesThenRecovers() async {
        let s = make(script: [.failure(SyncApiError.rateLimited), page(1)])
        #expect(await read(s) == .busy)
        #expect(s.api.playsSummaryCalls.count == 1)
        s.clock.advance(9 * 60)
        #expect(await read(s, force: true) == .busy)
        #expect(s.api.playsSummaryCalls.count == 1) // no request while backing off
        s.clock.advance(61)
        #expect(await read(s, force: true) == .ok(summary(1)))
        #expect(s.api.playsSummaryCalls.count == 2)
    }

    @Test func backOffReturnsTheCachedEntryWhenThereIsOne() async {
        let s = make(script: [page(1), .failure(SyncApiError.rateLimited)])
        _ = await read(s)
        s.clock.advance(10 * 60)
        #expect(await read(s) == .ok(summary(1)))
        #expect(await read(s, "2026-01-01", "2026-01-31") == .busy) // a range with no cache
        #expect(s.api.playsSummaryCalls.count == 2)
    }

    @Test func twentyPageRequestsAnHourThenBusyUntilTheWindowMoves() async {
        let s = make(script: [page(1)])
        for i in 0..<20 {
            #expect(await read(s, "2026-01-\(String(format: "%02d", i + 1))", "2026-01-31") == .ok(summary(1)))
        }
        #expect(s.api.playsSummaryCalls.count == 20)
        #expect(await read(s, "2025-01-01", "2025-01-31") == .busy)
        #expect(s.api.playsSummaryCalls.count == 20)
        // A forced read of a range that is cached falls back to it.
        #expect(await read(s, "2026-01-20", "2026-01-31", force: true) == .ok(summary(1)))
        #expect(s.api.playsSummaryCalls.count == 20)
        s.clock.advance(60 * 60 + 1)
        #expect(await read(s, "2025-01-01", "2025-01-31") == .ok(summary(1)))
        #expect(s.api.playsSummaryCalls.count == 21)
    }

    @Test func aBudgetThatRunsOutMidwayStopsTheRead() async {
        let s = make(script: [page(1, cursor: "c", track: "t1")])
        // Two reads of 10 pages each use the whole budget (the 10-page cap makes each fail) ...
        #expect(await read(s, "2026-02-01", "2026-02-02") == .failed)
        #expect(await read(s, "2026-03-01", "2026-03-02") == .failed)
        #expect(s.api.playsSummaryCalls.count == 20)
        // ... so a third is stopped before any request.
        #expect(await read(s, "2026-04-01", "2026-04-02") == .busy)
        #expect(s.api.playsSummaryCalls.count == 20)
    }

    @Test func staleCacheIsServedOnAnError() async {
        let s = make(script: [page(1), .failure(SyncApiError.network("offline"))])
        _ = await read(s)
        s.clock.advance(10 * 60)
        #expect(await read(s) == .ok(summary(1)))
        #expect(s.api.playsSummaryCalls.count == 2)
    }

    @Test func anErrorWithNothingCachedIsFailed() async {
        let s = make(script: [.failure(SyncApiError.network("offline"))])
        #expect(await read(s) == .failed)
    }

    @Test func unauthorizedIsFailedNotSignedOut() async {
        let s = make(script: [.failure(SyncApiError.unauthorized)])
        #expect(await read(s) == .failed)
    }

    @Test func aDifferentDeviceIdClearsTheCache() async {
        let s = make(script: [page(1), page(2)])
        _ = await read(s)
        s.account.save(email: "b@example.com", deviceToken: "token-2", deviceId: "device-2")
        #expect(await read(s) == .ok(summary(2)))
        #expect(s.api.playsSummaryCalls.count == 2)
    }

    @Test func keepsAtMostTwelveRangesDroppingTheOldest() async {
        let s = make(script: [page(1)])
        for i in 1...13 { _ = await read(s, "2026-01-01", "2026-01-\(String(format: "%02d", i))") }
        #expect(s.api.playsSummaryCalls.count == 13)
        _ = await read(s, "2026-01-01", "2026-01-13") // newest: still cached
        #expect(s.api.playsSummaryCalls.count == 13)
        _ = await read(s, "2026-01-01", "2026-01-01") // oldest: dropped, fetched again
        #expect(s.api.playsSummaryCalls.count == 14)
    }

    // MARK: - Account changes while a read is in flight (P1)

    /// Holds the `which`th request open (1-based) until the latch is released.
    private func hold(_ s: Setup, request which: Int, _ latch: Latch) {
        s.api.playsSummaryGate = { [api = s.api] in
            if api.playsSummaryCalls.count == which { await latch.wait() }
        }
    }

    private func waitForCalls(_ s: Setup, _ count: Int) async {
        for _ in 0..<2000 where s.api.playsSummaryCalls.count < count { try? await Task.sleep(nanoseconds: 2_000_000) }
    }

    @Test func signingOutDuringTheFirstPageReturnsSignedOutAndCachesNothing() async {
        let s = make(script: [page(1)])
        let latch = Latch()
        hold(s, request: 1, latch)
        let task = Task { await self.read(s) }
        await waitForCalls(s, 1)
        s.account.clear()
        latch.release()
        #expect(await task.value == .signedOut)
        s.account.save(email: "a@example.com", deviceToken: "token", deviceId: "device-1")
        #expect(await read(s) == .ok(summary(1)))
        #expect(s.api.playsSummaryCalls.count == 2) // nothing was kept from the first
    }

    @Test func switchingAccountsDuringTheFirstPageReturnsFailedAndCachesNothing() async {
        let s = make(script: [page(1), page(2)])
        let latch = Latch()
        hold(s, request: 1, latch)
        let task = Task { await self.read(s) }
        await waitForCalls(s, 1)
        s.account.save(email: "b@example.com", deviceToken: "token-b", deviceId: "device-2")
        latch.release()
        #expect(await task.value == .failed)
        #expect(await read(s) == .ok(summary(2))) // the new account fetches for itself
        #expect(s.api.playsSummaryCalls.count == 2)
    }

    @Test func aTokenChangeOnTheSameDeviceCountsAsAnotherAccount() async {
        let s = make(script: [page(1), page(2)])
        let latch = Latch()
        hold(s, request: 1, latch)
        let task = Task { await self.read(s) }
        await waitForCalls(s, 1)
        s.account.save(email: "a@example.com", deviceToken: "token-2", deviceId: "device-1")
        latch.release()
        #expect(await task.value == .failed)
    }

    @Test func signingOutBetweenPagesDiscardsTheFirstPage() async {
        let s = make(script: [page(1, cursor: "c", track: "t1"), page(2, track: "t2")])
        let latch = Latch()
        hold(s, request: 2, latch)
        let task = Task { await self.read(s) }
        await waitForCalls(s, 2)
        s.account.clear()
        latch.release()
        #expect(await task.value == .signedOut)
        s.account.save(email: "a@example.com", deviceToken: "token", deviceId: "device-1")
        _ = await read(s)
        #expect(s.api.playsSummaryCalls.count >= 3) // fetched again, not served from the half-read one
    }

    @Test func switchingAccountsBetweenPagesReturnsNoMixedData() async {
        let s = make(script: [page(1, cursor: "c", track: "t1"), page(2, track: "t2")])
        let latch = Latch()
        hold(s, request: 2, latch)
        let task = Task { await self.read(s) }
        await waitForCalls(s, 2)
        s.account.save(email: "b@example.com", deviceToken: "token-b", deviceId: "device-2")
        latch.release()
        #expect(await task.value == .failed)
    }

    @Test func anOldAccountsCacheIsNeverTheFallbackAfterASwitch() async {
        let s = make(script: [page(1), .failure(SyncApiError.network("down"))])
        _ = await read(s) // cached for device-1
        let latch = Latch()
        hold(s, request: 2, latch)
        let task = Task { await self.read(s, force: true) }
        await waitForCalls(s, 2)
        s.account.save(email: "b@example.com", deviceToken: "token-b", deviceId: "device-2")
        latch.release()
        // The failing second request would fall back to device-1's entry; it must not.
        #expect(await task.value == .failed)
        #expect(await read(s) == .failed) // device-2 has no cache of its own
    }

    // MARK: - The budget survives a relaunch (P2)

    private func relaunch(_ s: Setup, script: [Result<SyncPlaysSummaryPage, Error>] = []) -> (SyncPlayStatsService, FakeSyncApi) {
        let api = FakeSyncApi()
        api.playsSummaryScript = script
        let clock = s.clock
        return (SyncPlayStatsService(api: api, account: s.account, now: { clock.date }, defaults: s.defaults), api)
    }

    @Test func aSpentBudgetStaysSpentAfterARelaunch() async {
        let s = make(script: [page(1)])
        for _ in 0..<SyncPlayStatsService.budgetPerHour { _ = await read(s, force: true) }
        #expect(s.api.playsSummaryCalls.count == 20)
        let (again, api) = relaunch(s, script: [page(1)])
        #expect(await again.summary(from: "2026-10-12", to: "2026-10-15", force: true) == .busy)
        #expect(api.playsSummaryCalls.isEmpty)
        s.clock.advance(61 * 60) // an hour on, the old requests no longer count
        let (later, laterApi) = relaunch(s, script: [page(1)])
        #expect(await later.summary(from: "2026-10-12", to: "2026-10-15", force: true) == .ok(summary(1)))
        #expect(laterApi.playsSummaryCalls.count == 1)
    }

    @Test func aBackOffStaysAfterARelaunch() async {
        let s = make(script: [.failure(SyncApiError.rateLimited)])
        #expect(await read(s) == .busy)
        s.clock.advance(5 * 60)
        let (again, api) = relaunch(s, script: [page(1)])
        #expect(await again.summary(from: "2026-10-12", to: "2026-10-15", force: true) == .busy)
        #expect(api.playsSummaryCalls.isEmpty)
        s.clock.advance(6 * 60)
        let (done, doneApi) = relaunch(s, script: [page(1)])
        #expect(await done.summary(from: "2026-10-12", to: "2026-10-15", force: true) == .ok(summary(1)))
        #expect(doneApi.playsSummaryCalls.count == 1)
    }
}
