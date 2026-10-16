import Foundation
import Testing
@testable import Locally

@MainActor
struct StatsViewModelTests {
    private func u(_ n: Int) -> UUID { UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))! }
    private func s(_ n: Int) -> String { u(n).uuidString.lowercased() }

    private func track(_ n: Int, _ title: String) -> Track {
        Track(id: u(n), title: title, trackNumber: 1, filePath: "t\(n).mp3", originalName: "t\(n).mp3", durationSec: 180)
    }

    private var releases: [Release] {
        [
            Release(id: u(1), kind: .single, title: "Night Bus", artist: "Okoro", coverPath: "/c/1", folderPath: "/lib/1", tracks: [track(11, "Night Bus")]),
            Release(id: u(2), kind: .single, title: "Lanterns", artist: "Quiet Orchard", coverPath: "/c/2", folderPath: "/lib/2", tracks: [track(12, "Lanterns")]),
        ]
    }

    private func count(_ release: Int, _ track: Int, _ plays: Int, day: String? = nil) -> PlayCount {
        PlayCount(trackId: s(track), releaseId: s(release), plays: plays, lastPlayedDay: day)
    }

    private var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        c.firstWeekday = 2
        return c
    }

    /// Thursday 15 October 2026, noon UTC.
    private let now = Date(timeIntervalSince1970: 1_792_065_600)

    private func make(
        _ result: PlayStatsRead, library: [Release]? = nil, suite: String = UUID().uuidString
    ) -> (model: StatsViewModel, stats: FakePlayStats, defaults: UserDefaults, suite: String) {
        let stats = FakePlayStats(result: result)
        let defaults = UserDefaults(suiteName: suite)!
        let list = library ?? releases
        let model = StatsViewModel(stats: stats, releases: { list }, calendar: calendar, now: { now }, defaults: defaults)
        return (model, stats, defaults, suite)
    }

    private func summary(tracks: [PlayCount], allTime: [PlayCount]) -> PlayStatsRead {
        .ok(PlaysSummary(tracks: tracks, allTime: allTime))
    }

    // MARK: States

    @Test func startsLoadingThenReady() async {
        let m = make(summary(tracks: [count(1, 11, 5, day: "2026-10-14")], allTime: [count(1, 11, 9)]))
        #expect(m.model.phase == .loading)
        await m.model.read()
        #expect(m.model.phase == .ready)
        #expect(m.model.items.map(\.title) == ["Night Bus"])
        #expect(m.model.digest == "You played your tracks 5 times this week, mostly Night Bus.")
        #expect(m.model.isRefreshing == false)
    }

    @Test func aQuietPeriodWithEarlierPlaysIsQuiet() async {
        let m = make(summary(tracks: [], allTime: [count(1, 11, 9)]))
        await m.model.read()
        #expect(m.model.phase == .quiet)
        #expect(m.model.digest == Copy.Stats.emptyPeriodLine(PeriodSelection(kind: .week, back: 0)))
    }

    @Test func noPlaysAnywhereIsNoPlays() async {
        let m = make(summary(tracks: [], allTime: []))
        await m.model.read()
        #expect(m.model.phase == .noPlays)
        #expect(m.model.showsControls == false)
    }

    @Test func signedOutFailedAndBusyArePassedThrough() async {
        for (read, phase) in [(PlayStatsRead.signedOut, StatsPhase.signedOut), (.failed, .failed), (.busy, .busy)] {
            let m = make(read)
            await m.model.read()
            #expect(m.model.phase == phase)
            #expect(m.model.items.isEmpty)
        }
    }

    @Test func aLaterReadKeepsTheContentAndDimsItUntilItLands() async {
        let m = make(summary(tracks: [count(1, 11, 5)], allTime: [count(1, 11, 9)]))
        await m.model.read()
        m.stats.result = .failed
        let read = Task { await m.model.read() }
        await read.value
        #expect(m.model.phase == .failed)
        #expect(m.model.isRefreshing == false)
    }

    // MARK: Ranking

    @Test func allTimeRanksAllTimeCountsWithLastPlayedDaysFromTracks() async {
        let m = make(summary(
            tracks: [count(1, 11, 1, day: "2026-10-12")],
            allTime: [count(1, 11, 40), count(2, 12, 60)]
        ))
        m.model.selectKind(.all)
        await m.model.waitUntilIdle()
        #expect(m.model.phase == .ready)
        #expect(m.model.items.map(\.title) == ["Lanterns", "Night Bus"])
        #expect(m.model.items.map(\.plays) == [60, 40])
        #expect(m.model.items.map(\.lastPlayedDay) == [nil, "2026-10-12"])
        let range = PlayPeriods.selectionRange(PeriodSelection(kind: .all, back: 0), today: "2026-10-15", firstDay: 1)
        #expect(m.stats.calls.last?.from == range.from && m.stats.calls.last?.to == range.to)
    }

    @Test func otherPeriodsRankTheTracksCounts() async {
        let m = make(summary(tracks: [count(1, 11, 2)], allTime: [count(1, 11, 40), count(2, 12, 60)]))
        await m.model.read()
        #expect(m.model.items.map(\.plays) == [2])
        #expect(m.stats.calls.last?.from == "2026-10-12" && m.stats.calls.last?.to == "2026-10-15") // Monday to today
    }

    @Test func sortsKeepTheirRank() {
        let a = StatItem(id: "a", rank: 1, title: "Zed", subtitle: "", plays: 9, lastPlayedDay: "2026-10-01")
        let b = StatItem(id: "b", rank: 2, title: "Amp", subtitle: "", plays: 5, lastPlayedDay: "2026-10-09")
        let c = StatItem(id: "c", rank: 3, title: "Mid", subtitle: "", plays: 2, lastPlayedDay: nil)
        #expect(StatsViewModel.sorted([a, b, c], by: .plays).map(\.id) == ["a", "b", "c"])
        #expect(StatsViewModel.sorted([a, b, c], by: .name).map(\.id) == ["b", "c", "a"])
        #expect(StatsViewModel.sorted([a, b, c], by: .recent).map(\.id) == ["b", "a", "c"])
    }

    // MARK: Stepping

    @Test func stepBoundsAndChoosingAPeriodResetsBack() async {
        let m = make(summary(tracks: [count(1, 11, 2)], allTime: [count(1, 11, 2)]))
        #expect(m.model.canStepForward == false)
        #expect(m.model.canStepBack)
        m.model.stepBack()
        m.model.stepBack()
        await m.model.waitUntilIdle()
        #expect(m.model.period == PeriodSelection(kind: .week, back: 2))
        #expect(m.model.canStepForward)
        m.model.stepForward()
        #expect(m.model.period.back == 1)
        m.model.selectKind(.month)
        #expect(m.model.period == PeriodSelection(kind: .month, back: 0))
        m.model.selectKind(.all)
        #expect(m.model.canStepBack == false && m.model.canStepForward == false && m.model.showsStepper == false)
        m.model.stepBack()
        #expect(m.model.period.back == 0)
    }

    @Test func backStopsWhereTheServerKeepsNothing() {
        let m = make(.failed)
        var steps = 0
        while m.model.canStepBack && steps < 200 { m.model.stepBack(); steps += 1 }
        #expect(steps > 50 && steps < 60) // about 400 days of weeks
        #expect(m.model.canStepBack == false)
    }

    // MARK: Preferences

    @Test func choicesPersistExceptHowFarBack() async {
        let m = make(.failed)
        m.model.selectKind(.month)
        m.model.stepBack()
        m.model.selectTab(.albums)
        m.model.selectLayout(.grid)
        m.model.selectSort(.recent)
        await m.model.waitUntilIdle()
        let again = StatsViewModel(stats: m.stats, releases: { [] }, calendar: calendar, now: { now }, defaults: m.defaults)
        #expect(again.period == PeriodSelection(kind: .month, back: 0))
        #expect(again.tab == .albums)
        #expect(again.layout == .grid)
        #expect(again.sort == .recent)
    }

    @Test func defaultsAreThisWeekTracksList() {
        let m = make(.failed)
        #expect(m.model.period == PeriodSelection(kind: .week, back: 0))
        #expect(m.model.tab == .tracks && m.model.layout == .list && m.model.sort == .plays)
    }

    // MARK: Opening

    @Test func anArtistAsksForALibrarySearchAndAReleaseOpens() async {
        let m = make(summary(tracks: [count(1, 11, 5), count(2, 12, 3)], allTime: [count(1, 11, 5), count(2, 12, 3)]))
        await m.model.read()
        m.model.selectTab(.artists)
        var searched: String?
        var opened: Release?
        let artist = m.model.items[0]
        m.model.open(artist, openRelease: { opened = $0 }, requestLibrarySearch: { searched = $0 })
        #expect(searched == "Okoro")
        #expect(opened == nil)

        m.model.selectTab(.tracks)
        m.model.open(m.model.items[1], openRelease: { opened = $0 }, requestLibrarySearch: { searched = $0 })
        #expect(opened?.id == u(2))
        #expect(m.model.coverOwner(of: artist) == u(1))
    }
}
