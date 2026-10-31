import Foundation
import Observation

/// What the Library's three cards show (#446): this week's plays, its most played track and its top artist.
struct LibraryWeek: Equatable {
    /// Every counted play this week.
    var total: Int
    /// How many different tracks those plays were of.
    var trackCount: Int
    var topTrack: StatItem
    var topArtist: StatItem
    /// The artist page's key for `topArtist` (an "A feat. B" release counts for A, as on the Stats page).
    var artistKey: String
}

/// The Library header's cards. They read the play summary for the same week the Stats tab opens on, through the
/// same `PlayStatsReading`, so the service's 5-minute cache and shared in-flight request serve both: opening the
/// Library and then Stats is one request. Never forced, never polled: the Library asks when it loads.
@MainActor
@Observable
final class LibraryHeaderModel {
    enum Phase: Equatable {
        /// The first read is under way.
        case loading
        case week(LibraryWeek)
        /// Nothing to show: no plays this week, signed out, offline or out of budget. The Library says nothing.
        case hidden
    }

    private(set) var phase: Phase = .loading

    @ObservationIgnored private let stats: PlayStatsReading
    @ObservationIgnored private let calendar: Calendar
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var generation = 0
    /// When a read last ended with nothing to show for a reason other than being signed out: no new request until
    /// the cache window has passed, so a Library that keeps appearing can't spend the phone's request budget.
    @ObservationIgnored private var lastEmptyAt: Date?

    init(stats: PlayStatsReading, calendar: Calendar = .current, now: @escaping () -> Date = Date.init) {
        self.stats = stats
        self.calendar = calendar
        self.now = now
    }

    /// The days "This week" covers: the same call the Stats model makes for its week (see `StatsViewModel.read`).
    static func weekRange(today: String, firstDay: Int) -> DayRange {
        PlayPeriods.selectionRange(PeriodSelection(kind: .week, back: 0), today: today, firstDay: firstDay)
    }

    /// Reads this week's summary and builds the cards from it over `releases`.
    func read(releases: [Release]) async {
        let current = now()
        if let lastEmptyAt, current.timeIntervalSince(lastEmptyAt) < SyncPlayStatsService.freshSeconds { return }
        generation += 1
        let mine = generation
        let today = PlayPeriods.localDayString(current, calendar: calendar)
        let firstDay = PlayPeriods.isoFirstDay(fromAppleFirstWeekday: calendar.firstWeekday)
        let range = Self.weekRange(today: today, firstDay: firstDay)
        let outcome = await stats.summary(from: range.from, to: range.to, force: false)
        guard mine == generation else { return }
        switch outcome {
        case .ok(let summary):
            lastEmptyAt = nil
            phase = Self.week(from: summary, releases: releases).map(Phase.week) ?? .hidden
        case .signedOut:
            lastEmptyAt = nil
            phase = .hidden
        case .failed, .busy:
            lastEmptyAt = now()
            phase = .hidden
        }
    }

    /// The cards for a week's summary, or nil when no play of a track still in the library was counted.
    static func week(from summary: PlaysSummary, releases: [Release]) -> LibraryWeek? {
        // The same ranking the Stats page makes for a week: `StatsViewModel.apply` with the period's own counts.
        // Only tracks still in the library count, each once, so `tracks.count` is the number played this week.
        let ranked = PlayStats.aggregate(releases: releases, counts: summary.tracks, limit: .max)
        guard ranked.total > 0, let track = ranked.tracks.first, let artist = ranked.artists.first else { return nil }
        return LibraryWeek(
            total: ranked.total, trackCount: ranked.tracks.count,
            topTrack: track, topArtist: artist,
            artistKey: ArtistNames.artistKey(ArtistNames.splitArtistFeaturing(artist.title).artist)
        )
    }
}
