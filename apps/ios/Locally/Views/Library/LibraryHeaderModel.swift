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
/// Library and then Stats is one request. Never forced, never polled, and the *attempts* are throttled, whatever they
/// came to (the service answers a failed refresh with its stale cache as `.ok`, so an outcome says nothing about
/// whether a request was spent): the Library, which reloads on every appear, import and sync pull, asks only for a
/// first read, a new week, another account, or once `SyncPlayStatsService.freshSeconds` have passed since the last ask.
/// In between it re-ranks the last summary over the releases it is given, so a deleted release leaves the cards
/// without a request.
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

    /// The last ask of the service: when, for which days and for which account. Recorded before the service is awaited.
    private struct Ask {
        var at: Date
        var range: DayRange
        var account: String?
    }

    @ObservationIgnored private var lastAsk: Ask?
    /// The last `.ok` summary, re-ranked while no new ask is due. Dropped by anything else the service answers.
    @ObservationIgnored private var kept: PlaysSummary?
    /// The releases of the latest `read`, so a read that finishes after a newer one ranks over the newer library.
    @ObservationIgnored private var latestReleases: [Release] = []
    /// Who is signed in, as a key that can be compared: the device id, nil when signed out. Never the token itself.
    @ObservationIgnored private let account: () -> String?

    init(
        stats: PlayStatsReading, account: @escaping () -> String?, calendar: Calendar = .current,
        now: @escaping () -> Date = Date.init
    ) {
        self.stats = stats
        self.account = account
        self.calendar = calendar
        self.now = now
    }

    /// The days "This week" covers: the same call the Stats model makes for its week (see `StatsViewModel.read`).
    static func weekRange(today: String, firstDay: Int) -> DayRange {
        PlayPeriods.selectionRange(PeriodSelection(kind: .week, back: 0), today: today, firstDay: firstDay)
    }

    /// Builds the cards over `releases` from this week's summary, asking the service only when an ask is due (see the
    /// type's note); otherwise from the summary kept from the last ask.
    func read(releases: [Release]) async {
        latestReleases = releases
        let current = now()
        let today = PlayPeriods.localDayString(current, calendar: calendar)
        let firstDay = PlayPeriods.isoFirstDay(fromAppleFirstWeekday: calendar.firstWeekday)
        let range = Self.weekRange(today: today, firstDay: firstDay)
        let who = account()
        if let ask = lastAsk, ask.range == range, ask.account == who,
           current.timeIntervalSince(ask.at) < SyncPlayStatsService.freshSeconds {
            // Inside the window: no request. A read still under way will rank over `latestReleases` when it ends.
            if let kept { phase = Self.week(from: kept, releases: releases).map(Phase.week) ?? .hidden }
            return
        }
        lastAsk = Ask(at: current, range: range, account: who)
        generation += 1
        let mine = generation
        let outcome = await stats.summary(from: range.from, to: range.to, force: false)
        guard mine == generation else { return }
        switch outcome {
        case .ok(let summary):
            kept = summary
            phase = Self.week(from: summary, releases: latestReleases).map(Phase.week) ?? .hidden
        case .signedOut, .failed, .busy:
            kept = nil
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
