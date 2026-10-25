import Foundation
import Testing
@testable import Locally

struct PlayHistoryTests {
    private static let release = UUID(uuidString: "00000000-0000-0000-0000-0000000000a1")!
    private static let track = UUID(uuidString: "00000000-0000-0000-0000-0000000000a2")!

    private static func library() -> [Release] {
        [Release(id: release, kind: .album, title: "Night Bus to Nowhere", artist: "Mira Valdane", coverPath: "/c.png", folderPath: "/f",
                 tracks: [Track(id: track, title: "Orange Streetlight", trackNumber: 1, filePath: "a.mp3", originalName: "a.mp3", durationSec: 200)])]
    }

    private static func event(_ id: String, at: Int64, day: String, ms: Int = 60_000, release: UUID = release, track: UUID = track,
                              source: String = "locally") -> HistoryEvent {
        HistoryEvent(id: id, releaseId: release, trackId: track, source: source, startedAt: at, day: day, listenedMs: ms,
                     device: HistoryDevice(name: "iPhone", platform: "ios", current: true))
    }

    private static func toronto() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Toronto")!
        return calendar
    }

    @Test func groupsByTheEventsLocalDayAcrossMidnightNewestFirst() {
        // 23:59 on the 24th and 00:01 on the 25th are a minute-and-a-bit apart but on two days.
        let events = [
            Self.event("a", at: 1_000, day: "2026-10-24"),
            Self.event("b", at: 1_120_000, day: "2026-10-25"),
            Self.event("c", at: 500, day: "2026-10-24"),
        ]
        let history = PlayHistory(events: events, releases: Self.library())
        #expect(history.days.map(\.day) == ["2026-10-25", "2026-10-24"])
        #expect(history.days[0].plays.map(\.id) == ["b"])
        #expect(history.days[1].plays.map(\.id) == ["a", "c"])
    }

    @Test func playsWithinADayAreNewestFirstAndTiesBreakOnId() {
        let events = [
            Self.event("m", at: 100, day: "2026-10-24"), Self.event("z", at: 300, day: "2026-10-24"),
            Self.event("b", at: 200, day: "2026-10-24"), Self.event("a", at: 200, day: "2026-10-24"),
        ]
        let day = PlayHistory(events: events, releases: Self.library()).days[0]
        #expect(day.plays.map(\.id) == ["z", "a", "b", "m"])
    }

    @Test func aRepeatedEventIdCountsOnce() {
        let events = [Self.event("a", at: 1, day: "2026-10-24"), Self.event("a", at: 1, day: "2026-10-24")]
        #expect(PlayHistory(events: events, releases: Self.library()).days[0].playCount == 1)
    }

    @Test func minutesAreTheSumOfListenedMsRoundedWithAMinimumOfOne() {
        let events = [
            Self.event("a", at: 3, day: "2026-10-24", ms: 200_000), Self.event("b", at: 2, day: "2026-10-24", ms: 31_000),
            Self.event("c", at: 1, day: "2026-10-24", ms: 164_000), Self.event("d", at: 9, day: "2026-10-23", ms: 5_000),
        ]
        let history = PlayHistory(events: events, releases: Self.library())
        #expect(history.day("2026-10-24")?.listenedMs == 395_000)
        #expect(history.day("2026-10-24")?.minutes == 7)
        #expect(history.day("2026-10-24")?.playCount == 3)
        #expect(history.day("2026-10-23")?.minutes == 1)
    }

    @Test func theStripHasFourteenDaysFromTodayBackIncludingEmptyOnes() {
        let events = [Self.event("a", at: 1, day: "2026-10-25"), Self.event("b", at: 1, day: "2026-10-20"), Self.event("old", at: 1, day: "2026-09-01")]
        let strip = PlayHistory(events: events, releases: Self.library()).strip(today: "2026-10-25", count: 14)
        #expect(strip.count == 14)
        #expect(strip.first?.day == "2026-10-25")
        #expect(strip.last?.day == "2026-10-12")
        #expect(strip.map(\.playCount) == [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0])
        #expect(strip[1].topReleaseId == nil)
        #expect(strip[1].minutes == 0)
    }

    @Test func theStripKeepsEveryCalendarDayAcrossDaylightSavingChanges() {
        let calendar = Self.toronto()
        // Clocks go back on 1 Nov 2026 (a 25-hour day) and forward on 8 Mar 2026 (a 23-hour day).
        for (today, spans) in [("2026-11-05", "2026-11-01"), ("2026-03-12", "2026-03-08")] {
            let strip = PlayHistory(events: [], releases: []).strip(today: today, count: 14)
            #expect(Set(strip.map(\.day)).count == 14)
            #expect(strip.map(\.day).contains(spans))
            let numbers = strip.map { calendar.component(.day, from: $0.date(calendar: calendar)) }
            let expected = strip.map { Int($0.day.suffix(2))! }
            #expect(numbers == expected)
            // Each next day is one calendar day later, whatever the hours between them.
            for (newer, older) in zip(strip, strip.dropFirst()) {
                #expect(calendar.dateComponents([.day], from: older.date(calendar: calendar), to: newer.date(calendar: calendar)).day == 1)
            }
        }
    }

    @Test func aPlayShortlyBeforeMidnightStaysOnItsOwnDayInAnotherTimeZone() {
        // The service says 24 Oct for a play made at 23:59 Toronto time, which is 25 Oct in UTC; History keeps 24 Oct.
        let at = Int64(ISO8601DateFormatter().date(from: "2026-10-25T03:59:00Z")!.timeIntervalSince1970 * 1000)
        let history = PlayHistory(events: [Self.event("a", at: at, day: "2026-10-24")], releases: Self.library())
        #expect(history.days.map(\.day) == ["2026-10-24"])
    }

    @Test func aPlayResolvesItsTrackAndReleaseFromTheLibrary() throws {
        let play = try #require(PlayHistory(events: [Self.event("a", at: 1, day: "2026-10-24", ms: 190_000)], releases: Self.library()).days.first?.plays.first)
        #expect(play.title == "Orange Streetlight")
        #expect(play.artist == "Mira Valdane")
        #expect(play.opensSong)
        #expect(play.isFullListen)
        #expect(play.lengthMs == 200_000)
    }

    @Test func aReleaseOnTheLibraryWithoutThatTrackKeepsTheReleaseTitleAndOpensNothing() throws {
        let other = UUID()
        let play = try #require(PlayHistory(events: [Self.event("a", at: 1, day: "2026-10-24", track: other)], releases: Self.library()).days.first?.plays.first)
        #expect(play.title == "Night Bus to Nowhere")
        #expect(!play.opensSong)
    }

    @Test func aReleaseNotInTheLibraryIsAnUnknownSongThatOpensNothing() throws {
        let play = try #require(PlayHistory(events: [Self.event("a", at: 1, day: "2026-10-24", release: UUID())], releases: Self.library()).days.first?.plays.first)
        #expect(play.title == nil)
        #expect(play.artist == nil)
        #expect(!play.opensSong)
        #expect(play.fraction < 1)
    }

    @Test func aDaysTopCoverIsTheNewestPlayWhoseReleaseIsOnThisPhone() {
        let unknown = UUID()
        let events = [Self.event("new", at: 9, day: "2026-10-24", release: unknown), Self.event("old", at: 1, day: "2026-10-24")]
        #expect(PlayHistory(events: events, releases: Self.library()).days[0].topReleaseId == Self.release)
    }

    @Test func aShortListenShowsLessOfTheDiscThanAFullOne() throws {
        let events = [Self.event("a", at: 2, day: "2026-10-24", ms: 30_000), Self.event("b", at: 1, day: "2026-10-24", ms: 200_000)]
        let plays = try #require(PlayHistory(events: events, releases: Self.library()).days.first?.plays)
        #expect(plays[0].fraction == 0.15)
        #expect(!plays[0].isFullListen)
        #expect(plays[1].fraction == 1)
    }
}
