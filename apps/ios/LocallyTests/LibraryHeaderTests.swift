import Foundation
import Testing
@testable import Locally

private func sampleUUID(_ n: Int) -> UUID { UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))! }
private func sampleLower(_ n: Int) -> String { sampleUUID(n).uuidString.lowercased() }

/// A release with one track per entry of `trackIDs`, ids made from small numbers so a count can name them.
private func sampleRelease(
    _ n: Int, _ title: String, artist: String, kind: ReleaseKind = .single, genre: String? = nil, trackIDs: [Int]? = nil
) -> Release {
    let ids = trackIDs ?? [n * 10 + 1]
    return Release(
        id: sampleUUID(n), kind: kind, title: title, artist: artist, genre: genre, coverPath: "/c/\(n)", folderPath: "/lib/\(n)",
        tracks: ids.map { Track(id: sampleUUID($0), title: "\(title) \($0)", trackNumber: 1, filePath: "t\($0).mp3", originalName: "t\($0).mp3", durationSec: 180) }
    )
}

/// Thursday 15 October 2026, noon UTC; weeks start on Monday, so "this week" is 12 to 15 October.
private let thursday = Date(timeIntervalSince1970: 1_792_065_600)

private var utcMonday: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    calendar.firstWeekday = 2
    return calendar
}

@MainActor
struct LibraryHeaderTests {
    private func count(_ release: Int, _ track: Int, _ plays: Int, day: String?) -> PlayCount {
        PlayCount(trackId: sampleLower(track), releaseId: sampleLower(release), plays: plays, lastPlayedDay: day)
    }

    private let library: [Release] = [
        sampleRelease(1, "Night Bus", artist: "Okoro"),
        sampleRelease(2, "Lanterns", artist: "Quiet Orchard"),
        sampleRelease(3, "Low Tide", artist: "Okoro", kind: .album, trackIDs: [31, 32]),
    ]

    private func make(_ result: PlayStatsRead, clock: TestClock = TestClock()) -> (model: LibraryHeaderModel, stats: FakePlayStats, clock: TestClock) {
        clock.date = thursday
        let stats = FakePlayStats(result: result)
        return (LibraryHeaderModel(stats: stats, calendar: utcMonday, now: { clock.date }), stats, clock)
    }

    private func week(_ tracks: [PlayCount], allTime: [PlayCount] = []) -> PlayStatsRead {
        .ok(PlaysSummary(tracks: tracks, allTime: allTime))
    }

    // MARK: What the cards show

    @Test func theCardsStartAsPlaceholdersAndNoPlaysHidesThem() async {
        let m = make(week([], allTime: [count(1, 11, 9, day: nil)]))
        #expect(m.model.phase == .loading)
        await m.model.read(releases: library)
        #expect(m.model.phase == .hidden)
    }

    @Test func playsGiveTheTotalTheTopTrackAndTheTopArtist() async {
        let m = make(week([
            count(1, 11, 5, day: "2026-10-14"),
            count(2, 21, 2, day: "2026-10-15"),
            count(3, 31, 4, day: "2026-10-13"),
            count(3, 32, 3, day: "2026-10-12"),
        ]))
        await m.model.read(releases: library)
        guard case .week(let week) = m.model.phase else { Issue.record("expected the week, got \(m.model.phase)"); return }
        #expect(week.total == 14)
        #expect(week.topTrack.title == "Night Bus 11")
        #expect(week.topTrack.plays == 5)
        #expect(week.topTrack.releaseId == sampleUUID(1))
        // Okoro: 5 on the single and 4 + 3 on the album.
        #expect(week.topArtist.title == "Okoro")
        #expect(week.topArtist.plays == 12)
        #expect(week.artistKey == "okoro")
        // Four different tracks: Night Bus 11, Lanterns 21 and the album's two.
        #expect(week.trackCount == 4)
    }

    @Test func aTrackWithNoPlaysIsNotInTheTrackCount() async {
        let m = make(week([
            count(1, 11, 5, day: "2026-10-14"),
            count(3, 31, 4, day: "2026-10-13"),
            count(3, 32, 0, day: "2026-10-12"),
        ]))
        await m.model.read(releases: library)
        guard case .week(let week) = m.model.phase else { Issue.record("expected the week"); return }
        #expect(week.trackCount == 2)
        #expect(week.total == 9)
    }

    @Test func theFirstCardSaysHowManyTracksAndReadsOutLoudWithThem() {
        #expect(Copy.Library.acrossTracks(31) == "across 31 tracks")
        #expect(Copy.Library.acrossTracks(1) == "across 1 track")
        #expect(Copy.Library.thisWeekLabel(plays: 246, tracks: 31) == "This week, 246 plays across 31 tracks")
        #expect(Copy.Library.thisWeekLabel(plays: 1, tracks: 1) == "This week, 1 play across 1 track")
    }

    @Test func aCountForATrackNoLongerInTheLibraryIsLeftOut() async {
        let m = make(week([count(1, 11, 5, day: "2026-10-14"), count(9, 91, 40, day: "2026-10-14")]))
        await m.model.read(releases: library)
        guard case .week(let week) = m.model.phase else { Issue.record("expected the week"); return }
        #expect(week.total == 5)
        #expect(week.trackCount == 1)
    }

    @Test func aLibraryWithNoneOfTheCountedTracksHidesTheCards() async {
        let m = make(week([count(9, 91, 40, day: "2026-10-14")]))
        await m.model.read(releases: library)
        #expect(m.model.phase == .hidden)
    }

    @Test(arguments: [PlayStatsRead.signedOut, .failed, .busy])
    func signedOutOfflineOrOutOfBudgetShowsNoCardsAndNoError(_ result: PlayStatsRead) async {
        let m = make(result)
        await m.model.read(releases: library)
        #expect(m.model.phase == .hidden)
    }

    // MARK: Request budget

    @Test func theLibraryNeverForcesARead() async {
        let m = make(week([count(1, 11, 5, day: "2026-10-14")]))
        await m.model.read(releases: library)
        await m.model.read(releases: library)
        #expect(m.stats.calls.count == 2)
        #expect(m.stats.calls.allSatisfy { !$0.force })
    }

    @Test func aFailedReadIsNotAskedAgainInsideTheCacheWindow() async {
        let m = make(.failed)
        await m.model.read(releases: library)
        await m.model.read(releases: library)
        #expect(m.stats.calls.count == 1)
        m.clock.advance(SyncPlayStatsService.freshSeconds + 1)
        await m.model.read(releases: library)
        #expect(m.stats.calls.count == 2)
    }

    @Test func signedOutIsAskedEveryTimeBecauseItCostsNoRequest() async {
        let m = make(.signedOut)
        await m.model.read(releases: library)
        await m.model.read(releases: library)
        #expect(m.stats.calls.count == 2)
    }

    @Test func theLibraryAsksForTheSameDaysTheStatsTabAsksFor() async {
        let m = make(week([count(1, 11, 5, day: "2026-10-14")]))
        await m.model.read(releases: library)
        let stats = StatsViewModel(
            stats: FakePlayStats(), releases: { [] }, calendar: utcMonday, now: { thursday },
            defaults: UserDefaults(suiteName: UUID().uuidString)!
        )
        #expect(stats.period == PeriodSelection(kind: .week, back: 0))
        #expect(m.stats.calls.first?.from == stats.range.from)
        #expect(m.stats.calls.first?.to == stats.range.to)
        #expect(stats.range == DayRange(from: "2026-10-12", to: "2026-10-15"))
    }

    /// The real service over a counting API: what the Library asks, the Stats tab's week is served from.
    private struct Real {
        let service: SyncPlayStatsService
        let api: FakeSyncApi
        let clock: TestClock
        let defaults: UserDefaults
    }

    private func real() -> Real {
        let api = FakeSyncApi()
        api.playsSummaryScript = [.success(SyncPlaysSummaryPage(
            tracks: [SyncPeriodPlays(trackId: sampleLower(11), releaseId: sampleLower(1), plays: 5, lastPlayedDay: "2026-10-14")],
            allTime: [SyncAllTimePlays(trackId: sampleLower(11), releaseId: sampleLower(1), plays: 50)],
            nextCursor: nil
        ))]
        let account = InMemorySyncAccountStore()
        account.save(email: "a@example.com", deviceToken: "token", deviceId: "device-1")
        let clock = TestClock()
        clock.date = thursday
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        return Real(service: SyncPlayStatsService(api: api, account: account, now: { clock.date }, defaults: defaults), api: api, clock: clock, defaults: defaults)
    }

    private func statsModel(_ r: Real) -> StatsViewModel {
        StatsViewModel(
            stats: r.service, releases: { self.library }, calendar: utcMonday, now: { r.clock.date },
            defaults: UserDefaults(suiteName: UUID().uuidString)!
        )
    }

    @Test func openingTheLibraryThenStatsInsideTheCacheWindowIsOneRequest() async {
        let r = real()
        let header = LibraryHeaderModel(stats: r.service, calendar: utcMonday, now: { r.clock.date })
        await header.read(releases: library)
        let stats = statsModel(r)
        await stats.read()
        #expect(r.api.playsSummaryCalls.count == 1)
        #expect(r.api.playsSummaryCalls.first?.from == "2026-10-12")
        #expect(r.api.playsSummaryCalls.first?.to == "2026-10-15")
        #expect(stats.phase == .ready)
        guard case .week(let week) = header.phase else { Issue.record("expected the week, got \(header.phase)"); return }
        #expect(week.total == stats.result?.total)
    }

    @Test func openingStatsThenTheLibraryIsOneRequestToo() async {
        let r = real()
        await statsModel(r).read()
        let header = LibraryHeaderModel(stats: r.service, calendar: utcMonday, now: { r.clock.date })
        await header.read(releases: library)
        #expect(r.api.playsSummaryCalls.count == 1)
        #expect(header.phase != .hidden)
    }

    @Test func aLibraryAndAStatsReadAtTheSameTimeShareTheRequestInFlight() async {
        let r = real()
        let latch = Latch()
        r.api.playsSummaryGate = { await latch.wait() }
        let header = LibraryHeaderModel(stats: r.service, calendar: utcMonday, now: { r.clock.date })
        let stats = statsModel(r)
        let first = Task { await header.read(releases: self.library) }
        let second = Task { await stats.read() }
        for _ in 0..<2000 where r.service.sharedJoins < 1 { try? await Task.sleep(nanoseconds: 2_000_000) }
        #expect(r.service.sharedJoins == 1)
        latch.release()
        await first.value
        await second.value
        #expect(r.api.playsSummaryCalls.count == 1)
    }

    @Test func afterTheCacheWindowTheNextOpenAsksAgain() async {
        let r = real()
        let header = LibraryHeaderModel(stats: r.service, calendar: utcMonday, now: { r.clock.date })
        await header.read(releases: library)
        r.clock.advance(SyncPlayStatsService.freshSeconds + 1)
        await header.read(releases: library)
        #expect(r.api.playsSummaryCalls.count == 2)
    }
}

/// "This week" on the Library opens the Stats tab on the week, whether or not the Stats page already exists (#446).
@MainActor
struct StatsRequestedPeriodTests {
    private func models(period: StatsPeriodKind? = nil) -> (defaults: UserDefaults, stats: FakePlayStats) {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        if let period { defaults.set(period.rawValue, forKey: StatsViewModel.periodKey) }
        return (defaults, FakePlayStats())
    }

    private func make(_ m: (defaults: UserDefaults, stats: FakePlayStats)) -> StatsViewModel {
        StatsViewModel(stats: m.stats, releases: { [] }, calendar: utcMonday, now: { thursday }, defaults: m.defaults)
    }

    @Test func aPageMadeAfterTheRequestOpensOnTheWeek() {
        let m = models(period: .month)
        StatsViewModel.requestPeriod(.week, in: m.defaults)
        let model = make(m)
        #expect(model.period == PeriodSelection(kind: .week, back: 0))
        #expect(model.displayed == model.period)
        #expect(m.defaults.string(forKey: StatsViewModel.requestedPeriodKey) == nil)
        #expect(m.defaults.string(forKey: StatsViewModel.periodKey) == "week")
    }

    @Test func aPageThatAlreadyExistsFollowsTheRequestOnItsNextRead() async {
        let m = models(period: .month)
        let model = make(m)
        await model.read()
        #expect(model.period.kind == .month)
        StatsViewModel.requestPeriod(.week, in: m.defaults)
        await model.read()
        #expect(model.period == PeriodSelection(kind: .week, back: 0))
        #expect(m.stats.calls.last?.from == "2026-10-12")
        #expect(m.stats.calls.last?.to == "2026-10-15")
        #expect(m.defaults.string(forKey: StatsViewModel.requestedPeriodKey) == nil)
    }

    @Test func aWeekSteppedBackComesBackToThisWeek() async {
        let m = models(period: .week)
        let model = make(m)
        await model.read()
        model.stepBack()
        await model.waitUntilIdle()
        #expect(model.period.back == 1)
        StatsViewModel.requestPeriod(.week, in: m.defaults)
        await model.read()
        #expect(model.period == PeriodSelection(kind: .week, back: 0))
    }

    @Test func noRequestLeavesTheChosenPeriodAlone() async {
        let m = models(period: .year)
        let model = make(m)
        await model.read()
        #expect(model.period.kind == .year)
    }
}

struct LibraryFilterTests {
    private let library: [Release] = [
        sampleRelease(1, "Night Bus", artist: "Okoro", kind: .single, genre: "Ambient"),
        sampleRelease(2, "Lanterns", artist: "Quiet Orchard", kind: .single, genre: "Dream pop"),
        sampleRelease(3, "Low Tide", artist: "Okoro", kind: .album, genre: "ambient"),
        sampleRelease(4, "Slow Fires", artist: "Juniper Hale", kind: .album, genre: nil),
        sampleRelease(5, "Kitchen Radio", artist: "Mira Valdane", kind: .single, genre: "  "),
    ]

    private func titles(_ filter: LibraryFilter) -> [String] { filter.apply(library).map(\.title) }

    @Test func theDefaultShowsEverything() {
        #expect(LibraryFilter.default == .all)
        #expect(LibraryFilter.all.isDefault)
        #expect(titles(.all).count == 5)
    }

    @Test func singlesAndAlbumsNarrowTheList() {
        #expect(titles(.singles) == ["Night Bus", "Lanterns", "Kitchen Radio"])
        #expect(titles(.albums) == ["Low Tide", "Slow Fires"])
    }

    @Test func aGenreNarrowsTheListIgnoringCaseAndSpacing() {
        #expect(titles(.genre("Ambient")) == ["Night Bus", "Low Tide"])
        #expect(titles(.genre("dream pop")) == ["Lanterns"])
    }

    @Test func theChoicesAreTheThreeKindsThenEachGenreOnceAToZ() {
        #expect(LibraryFilter.options(for: library) == [.all, .singles, .albums, .genre("Ambient"), .genre("Dream pop")])
        #expect(LibraryFilter.options(for: []) == [.all, .singles, .albums])
    }

    @Test func aGenreNoReleaseHasAnyMoreCountsAsAll() {
        let options = LibraryFilter.options(for: library)
        #expect(LibraryFilter.genre("Jazz").resolved(among: options) == .all)
        #expect(LibraryFilter.genre("AMBIENT").resolved(among: options) == .genre("AMBIENT"))
        #expect(LibraryFilter.singles.resolved(among: options) == .singles)
    }

    @Test func theStoredValueRoundTripsAndAnythingUnknownIsAll() {
        for filter in [LibraryFilter.all, .singles, .albums, .genre("Hip:hop")] {
            #expect(LibraryFilter(rawValue: filter.rawValue) == filter)
        }
        #expect(LibraryFilter(rawValue: "") == .all)
        #expect(LibraryFilter(rawValue: "bogus") == .all)
        #expect(LibraryFilter(rawValue: "genre:") == .all)
    }

    @Test func aSearchResultNamesItsKind() {
        #expect(Copy.Library.resultSubtitle(artist: "Okoro", kind: .single) == "Okoro \u{00B7} Single")
        #expect(Copy.Library.resultSubtitle(artist: "Okoro", kind: .album) == "Okoro \u{00B7} Album")
        #expect(Copy.Library.matchCount(1) == "1 match")
        #expect(Copy.Library.matchCount(3) == "3 matches")
    }
}
