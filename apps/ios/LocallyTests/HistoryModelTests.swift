import Foundation
import Testing
@testable import Locally

@MainActor
private final class FakePlayHistory: PlayHistoryReading {
    var reads: [PlayHistoryRead] = [.ok([])]
    var session = "A"
    private(set) var calls: [(from: Date, to: Date, force: Bool, cursor: String?)] = []
    /// When set, the first call waits here until `release()`: a reply that lands late.
    var holdFirst = false
    private(set) var gate: CheckedContinuation<Void, Never>?

    func events(from: Date, to: Date, force: Bool, cursor: String?) async -> PlayHistoryRead {
        let index = calls.count
        calls.append((from, to, force, cursor))
        let read = reads[min(index, reads.count - 1)]
        if holdFirst && index == 0 { await withCheckedContinuation { gate = $0 } }
        return read
    }

    func release() {
        gate?.resume()
        gate = nil
    }
}

@MainActor
struct HistoryModelTests {
    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Toronto")!
        return calendar
    }

    /// 25 Oct 2026, 15:00 in Toronto.
    private static let now = ISO8601DateFormatter().date(from: "2026-10-25T19:00:00Z")!

    private func make(_ fake: FakePlayHistory, selected: String? = nil, now: Date? = nil, calendar: Calendar? = nil, focus: Int64? = nil) -> HistoryModel {
        HistoryModel(service: fake, releases: { [] }, now: now ?? Self.now, calendar: calendar ?? Self.calendar, selected: selected, focusStartedAt: focus)
    }

    private func event(_ id: String, day: String, startedAt: Int64 = 1, release: UUID = UUID()) -> HistoryEvent {
        HistoryEvent(id: id, releaseId: release, trackId: UUID(), source: "locally", startedAt: startedAt, day: day, listenedMs: 1,
                     device: HistoryDevice(name: "iPhone", platform: "ios", current: true))
    }

    private func ms(_ iso: String) -> Int64 { Int64(ISO8601DateFormatter().date(from: iso)!.timeIntervalSince1970 * 1000) }

    @Test func theWindowsAreFourteenDaysEachBackToFourHundred() {
        let model = make(FakePlayHistory())
        #expect(model.today == "2026-10-25")
        #expect(model.window(0) == ("2026-10-12", "2026-10-26"))
        #expect(model.window(1) == ("2026-09-28", "2026-10-12"))
        let last = model.window(HistoryModel.maxWindows - 1)
        #expect(last.from == PlayPeriods.addDays("2026-10-25", -399))
        #expect(HistoryModel.maxWindows == 29)
    }

    @Test func theFirstLoadReadsTheLastFourteenDaysFromLocalMidnight() async {
        let fake = FakePlayHistory()
        let model = make(fake)
        #expect(model.phase == .loading)
        await model.load()
        #expect(model.phase == .ready)
        #expect(model.isEmpty)
        #expect(fake.calls.count == 1)
        let cal = Self.calendar
        #expect(fake.calls[0].from == cal.startOfDay(for: PlayHistory.date(of: "2026-10-12", calendar: cal)))
        #expect(fake.calls[0].to == cal.startOfDay(for: PlayHistory.date(of: "2026-10-26", calendar: cal)))
        #expect(model.strip.count == 14)
        #expect(model.selected == "2026-10-25")
    }

    @Test func olderWindowsLoadFourteenDaysAtATimeAndStopAtFourHundred() async {
        let fake = FakePlayHistory()
        let model = make(fake)
        await model.load()
        await model.loadOlder()
        #expect(model.strip.count == 28)
        #expect(model.strip.last?.day == "2026-09-28")
        for _ in 0..<40 { await model.loadOlder() }
        #expect(model.strip.count == 400)
        #expect(fake.calls.count == HistoryModel.maxWindows)
        #expect(!model.canLoadOlder)
    }

    @Test func revealReadsOlderWindowsUntilTheDayIsInTheStrip() async {
        let fake = FakePlayHistory()
        fake.reads = [.ok([]), .ok([]), .ok([event("a", day: "2026-09-20")])]
        let model = make(fake, selected: "2026-09-20")
        await model.load()
        await model.reveal("2026-09-20")
        #expect(fake.calls.count == 3)
        #expect(model.strip.map(\.day).contains("2026-09-20"))
        #expect(model.selectedDay.playCount == 1)
    }

    @Test func aFutureDayToOpenOnFallsBackToToday() {
        #expect(make(FakePlayHistory(), selected: "2027-01-01").selected == "2026-10-25")
    }

    @Test func aStaleAnswerIsShownWithANotice() async {
        let fake = FakePlayHistory()
        fake.reads = [.stale([event("a", day: "2026-10-24")], busy: false)]
        let model = make(fake)
        await model.load()
        #expect(model.phase == .ready)
        #expect(model.notice == .offline)
        #expect(model.history.days.count == 1)
    }

    @Test func aBusyReadAfterDataKeepsWhatIsShown() async {
        let fake = FakePlayHistory()
        fake.reads = [.ok([event("a", day: "2026-10-24")]), .busy]
        let model = make(fake)
        await model.load()
        await model.loadOlder()
        #expect(model.phase == .ready)
        #expect(model.notice == .busy)
        #expect(model.history.days.count == 1)
        #expect(model.strip.count == 14)
    }

    @Test func aFirstReadThatFailsHasNothingToShow() async {
        let fake = FakePlayHistory()
        fake.reads = [.busy, .ok([event("a", day: "2026-10-24")])]
        let model = make(fake)
        await model.load()
        #expect(model.phase == .failed)
        #expect(model.notice == .busy)
        await model.load(force: true)
        #expect(model.phase == .ready)
        #expect(model.notice == .none)
    }

    @Test func signedOutShowsNoPlays() async {
        let fake = FakePlayHistory()
        fake.reads = [.signedOut]
        let model = make(fake)
        await model.load()
        #expect(model.phase == .signedOut)
        #expect(!model.isEmpty)
    }

    // MARK: Account switch (P1)

    @Test func switchingAccountsDropsTheOlderWindowsOfTheFirst() async {
        let fake = FakePlayHistory()
        fake.reads = [.ok([event("a0", day: "2026-10-20")]), .ok([event("a1", day: "2026-10-01")]), .ok([event("b0", day: "2026-10-22")])]
        let model = make(fake)
        await model.load()
        await model.loadOlder()
        #expect(model.history.days.map(\.day).sorted() == ["2026-10-01", "2026-10-20"])
        fake.session = "B"
        await model.load(force: true)
        #expect(model.history.days.map(\.day) == ["2026-10-22"])
        #expect(model.windowsRead == 1)
        #expect(model.strip.count == 14)
    }

    @Test func aReplyFromTheFirstAccountThatLandsAfterTheSwitchIsDropped() async {
        let fake = FakePlayHistory()
        fake.holdFirst = true
        fake.reads = [.ok([event("a0", day: "2026-10-20")]), .ok([event("b0", day: "2026-10-22")])]
        let model = make(fake)
        let late = Task { await model.load() }
        while fake.gate == nil { await Task.yield() }
        fake.session = "B"
        await model.load()
        fake.release()
        await late.value
        #expect(model.history.days.map(\.day) == ["2026-10-22"])
        #expect(model.windowsRead == 1)
    }

    // MARK: Incomplete windows (P2)

    @Test func aWindowThatFailedPartWayIsContinuedFromItsCursorBeforeAnyOlderWindow() async {
        let fake = FakePlayHistory()
        fake.reads = [
            .ok([event("w0", day: "2026-10-20")]),
            .partial([event("w1a", day: "2026-10-05")], cursor: "c2", busy: false),
            .ok([event("w1b", day: "2026-10-04")]),
            .ok([event("w2", day: "2026-09-20")]),
        ]
        let model = make(fake)
        await model.load()
        await model.loadOlder()
        #expect(model.incompleteWindows == [1])
        #expect(model.notice == .offline)
        #expect(model.canLoadOlder) // more to read even though the strip has not reached 400 days
        await model.loadOlder()
        #expect(fake.calls[2].cursor == "c2")
        #expect(fake.calls[2].from == fake.calls[1].from && fake.calls[2].to == fake.calls[1].to) // the same window
        #expect(model.incompleteWindows.isEmpty)
        #expect(model.notice == .none)
        #expect(Set(model.history.days.map(\.day)) == ["2026-10-20", "2026-10-05", "2026-10-04"])
        // Only now does it advance to the next older window.
        await model.loadOlder()
        #expect(fake.calls[3].cursor == nil)
        #expect(fake.calls[3].to == fake.calls[1].from)
        #expect(model.windowsRead == 3)
    }

    @Test func aCappedNewestWindowIsContinuedOnTheNextRefresh() async {
        let fake = FakePlayHistory()
        fake.reads = [.partial([event("x", day: "2026-10-24")], cursor: "more", busy: nil), .ok([event("y", day: "2026-10-23")])]
        let model = make(fake)
        await model.load()
        #expect(model.incompleteWindows == [0])
        #expect(model.notice == .none)
        await model.load(force: true)
        #expect(fake.calls[1].cursor == "more")
        #expect(model.incompleteWindows.isEmpty)
        #expect(model.history.days.count == 2)
    }

    @Test func aStuckWindowDoesNotLoopOrAdvance() async {
        let fake = FakePlayHistory()
        fake.reads = [.ok([]), .partial([event("a", day: "2026-10-05")], cursor: "c", busy: false), .failed]
        let model = make(fake)
        await model.load()
        await model.loadOlder()
        await model.reveal("2026-01-01")
        #expect(model.windowsRead == 2)
        #expect(model.incompleteWindows == [1])
        #expect(fake.calls.count == 3)
    }

    // MARK: The day a play is stored under (P2)

    @Test func lastPlayedOpensTheEventsStoredDayNotThisPhonesDate() async {
        // Played 23:30 on the 24th at UTC-5 (stored day the 24th); this phone is UTC+1, where it was already the 25th.
        var phone = Calendar(identifier: .gregorian)
        phone.timeZone = TimeZone(secondsFromGMT: 3600)!
        let started = ms("2026-10-25T04:30:00Z")
        let fake = FakePlayHistory()
        fake.reads = [.ok([event("p", day: "2026-10-24", startedAt: started)])]
        let model = make(fake, selected: "2026-10-25", now: ms("2026-10-25T12:00:00Z").asDate, calendar: phone, focus: started)
        await model.load()
        await model.focus()
        #expect(model.selected == "2026-10-24")
        #expect(model.selectedDay.playCount == 1)
    }

    @Test func focusReadsOlderWindowsUntilTheEventIsFound() async {
        let started = ms("2026-09-30T16:00:00Z")
        let fake = FakePlayHistory()
        fake.reads = [.ok([]), .ok([event("p", day: "2026-09-29", startedAt: started)])]
        let model = make(fake, selected: "2026-09-30", focus: started)
        await model.load()
        await model.focus()
        #expect(fake.calls.count == 2)
        #expect(model.selected == "2026-09-29")
    }

    @Test func aPlayNeverFoundFallsBackToThePhonesDate() async {
        let started = ms("2026-10-20T16:00:00Z")
        let fake = FakePlayHistory()
        fake.reads = [.ok([])]
        let model = make(fake, selected: "2026-10-20", focus: started)
        await model.load()
        await model.focus()
        #expect(fake.calls.count == 1) // inside the window already read: it is not coming
        #expect(model.selected == "2026-10-20")
    }

    @Test func aPlayOlderThanFourHundredDaysOpensToday() async {
        let started = Self.now.addingTimeInterval(-401 * 86_400)
        let route = PlayPeriods.localDayString(started, calendar: Self.calendar)
        let fake = FakePlayHistory()
        let model = make(fake, selected: route, focus: Int64(started.timeIntervalSince1970 * 1000))
        #expect(model.selected == route)
        await model.load()
        await model.focus()
        #expect(model.selected == "2026-10-25")
        #expect(fake.calls.count == 1)
    }

    // MARK: Strip covers (P2)

    @Test func scrollingToAnOlderWindowRequestsThoseDaysCovers() async {
        let old = UUID(), new = UUID()
        let fake = FakePlayHistory()
        fake.reads = [.ok([event("n", day: "2026-10-20", release: new)]), .ok([event("o", day: "2026-10-01", release: old)])]
        let model = make(fake)
        await model.load()
        let strip = Set(model.strip.map(\.day))
        #expect(model.releaseIds(onDays: strip) == [new])
        await model.loadOlder()
        let older = Set(model.strip.map(\.day)).subtracting(strip)
        #expect(model.releaseIds(onDays: older) == [old])
        // The cover loader is asked for exactly those releases.
        let seen = Locked<Set<UUID>>([])
        let covers = HistoryCovers(cache: StatsCoverCache(loader: { id in seen.mutate { $0.insert(id) }; return nil }))
        await covers.load(model.releaseIds(onDays: older))
        #expect(seen.value == [old])
    }
}

private extension Int64 {
    var asDate: Date { Date(timeIntervalSince1970: Double(self) / 1000) }
}

private final class Locked<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: T
    init(_ value: T) { stored = value }
    var value: T { lock.withLock { stored } }
    func mutate(_ body: (inout T) -> Void) { lock.withLock { body(&stored) } }
}
