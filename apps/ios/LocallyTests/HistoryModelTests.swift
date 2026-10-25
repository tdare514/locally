import Foundation
import Testing
@testable import Locally

@MainActor
private final class FakePlayHistory: PlayHistoryReading {
    var reads: [PlayHistoryRead] = [.ok([])]
    private(set) var calls: [(from: Date, to: Date, force: Bool)] = []

    func events(from: Date, to: Date, force: Bool) async -> PlayHistoryRead {
        let index = calls.count
        calls.append((from, to, force))
        return reads[min(index, reads.count - 1)]
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

    private func make(_ fake: FakePlayHistory, selected: String? = nil) -> HistoryModel {
        HistoryModel(service: fake, releases: { [] }, now: Self.now, calendar: Self.calendar, selected: selected)
    }

    private func event(_ id: String, day: String) -> HistoryEvent {
        HistoryEvent(id: id, releaseId: UUID(), trackId: UUID(), source: "locally", startedAt: 1, day: day, listenedMs: 1,
                     device: HistoryDevice(name: "iPhone", platform: "ios", current: true))
    }

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
}
