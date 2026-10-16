import Foundation
import Observation

enum StatsKind: String, CaseIterable {
    case tracks, albums, artists
}

enum StatsLayout: String {
    case list, grid
}

enum StatsSort: String {
    case plays, name, recent
}

/// What the Stats page shows (#204).
enum StatsPhase: Equatable {
    /// The first read, nothing to show yet.
    case loading
    case ready
    /// This period has no plays, but earlier ones do.
    case quiet
    /// Nothing has ever been counted.
    case noPlays
    case signedOut
    case failed
    case busy
}

/// The Stats page's state: the period and tab the reader chose (kept between launches, except how
/// far back they stepped), the read of the server summary, and the ranked lists built from it.
/// Port of the Mac's `use-stats`, with the phone's request budget kept by `PlayStatsReading`.
@MainActor
@Observable
final class StatsViewModel {
    static let periodKey = "stats.period"
    static let tabKey = "stats.tab"
    static let layoutKey = "stats.layout"
    static let sortKey = "stats.sort"

    private(set) var phase: StatsPhase = .loading
    /// True while a later read is under way: the page keeps its last content, dimmed.
    private(set) var isRefreshing = false
    private(set) var result: PlayStatsResult?
    private(set) var releases: [Release] = []
    private(set) var today: String
    private(set) var firstDay: Int

    private(set) var period: PeriodSelection
    /// The period the content on screen was read for (it trails `period` while a read is under way).
    private(set) var displayed: PeriodSelection
    private(set) var tab: StatsKind
    private(set) var layout: StatsLayout
    private(set) var sort: StatsSort

    @ObservationIgnored private let stats: PlayStatsReading
    @ObservationIgnored private let releasesProvider: () -> [Release]
    @ObservationIgnored private let calendar: Calendar
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var task: Task<Void, Never>?
    /// The plays across all time, for telling a quiet period from a library nobody has played.
    @ObservationIgnored private var allTimeTotal = 0

    init(
        stats: PlayStatsReading,
        releases: @escaping () -> [Release],
        calendar: Calendar = .current,
        now: @escaping () -> Date = Date.init,
        defaults: UserDefaults = .standard
    ) {
        self.stats = stats
        self.releasesProvider = releases
        self.calendar = calendar
        self.now = now
        self.defaults = defaults
        self.today = PlayPeriods.localDayString(now(), calendar: calendar)
        self.firstDay = PlayPeriods.isoFirstDay(fromAppleFirstWeekday: calendar.firstWeekday)
        let kind = defaults.string(forKey: Self.periodKey).flatMap(StatsPeriodKind.init(rawValue:)) ?? .week
        self.period = PeriodSelection(kind: kind, back: 0)
        self.displayed = PeriodSelection(kind: kind, back: 0)
        self.tab = defaults.string(forKey: Self.tabKey).flatMap(StatsKind.init(rawValue:)) ?? .tracks
        self.layout = defaults.string(forKey: Self.layoutKey).flatMap(StatsLayout.init(rawValue:)) ?? .list
        self.sort = defaults.string(forKey: Self.sortKey).flatMap(StatsSort.init(rawValue:)) ?? .plays
    }

    // MARK: - Choices

    func selectKind(_ kind: StatsPeriodKind) {
        period = PeriodSelection(kind: kind, back: 0)
        defaults.set(kind.rawValue, forKey: Self.periodKey)
        reload()
    }

    func stepBack() {
        guard canStepBack else { return }
        period.back += 1
        reload()
    }

    func stepForward() {
        guard canStepForward else { return }
        period.back -= 1
        reload()
    }

    func selectTab(_ next: StatsKind) {
        tab = next
        defaults.set(next.rawValue, forKey: Self.tabKey)
    }

    func selectLayout(_ next: StatsLayout) {
        layout = next
        defaults.set(next.rawValue, forKey: Self.layoutKey)
    }

    func selectSort(_ next: StatsSort) {
        sort = next
        defaults.set(next.rawValue, forKey: Self.sortKey)
    }

    var canStepBack: Bool { PlayPeriods.canStepBack(period, today: today, firstDay: firstDay) }
    var canStepForward: Bool { period.kind != .all && period.back > 0 }
    var showsStepper: Bool { period.kind != .all }
    /// The period and tab pickers show unless nothing has been counted or the reader is not signed in.
    var showsControls: Bool { phase != .noPlays && phase != .signedOut }
    var range: DayRange { PlayPeriods.selectionRange(period, today: today, firstDay: firstDay) }

    // MARK: - Content

    var items: [StatItem] {
        guard let result else { return [] }
        switch tab {
        case .tracks: return result.tracks
        case .albums: return result.albums
        case .artists: return result.artists
        }
    }

    /// The list in the chosen order; rows keep their plays rank under any sort.
    var listed: [StatItem] { Self.sorted(items, by: sort) }

    var digest: String {
        switch phase {
        case .ready:
            return Copy.Stats.digestSentence(period, total: result?.total ?? 0, topTrack: result?.tracks.first?.title)
        case .quiet:
            return Copy.Stats.emptyPeriodLine(period)
        default:
            return ""
        }
    }

    static func sorted(_ items: [StatItem], by sort: StatsSort) -> [StatItem] {
        switch sort {
        case .plays:
            return items
        case .name:
            return items.sorted {
                let c = $0.title.compare($1.title, options: [.caseInsensitive, .diacriticInsensitive], range: nil, locale: Locale(identifier: "en"))
                return c == .orderedSame ? $0.rank < $1.rank : c == .orderedAscending
            }
        case .recent:
            return items.sorted { a, b in
                if a.lastPlayedDay == b.lastPlayedDay { return a.rank < b.rank }
                guard let x = a.lastPlayedDay else { return false }
                guard let y = b.lastPlayedDay else { return true }
                return x > y
            }
        }
    }

    // MARK: - Reading

    /// Starts a read for the new period and drops whatever was still under way.
    private func reload() {
        task?.cancel()
        task = Task { await read() }
    }

    /// Waits for the read the last choice started (tests).
    func waitUntilIdle() async {
        await task?.value
    }

    /// Reads the summary for the current period. `force` is a pull to refresh. The service decides
    /// whether its cache is fresh. A read superseded by a newer one is dropped.
    func read(force: Bool = false) async {
        generation += 1
        let mine = generation
        today = PlayPeriods.localDayString(now(), calendar: calendar)
        firstDay = PlayPeriods.isoFirstDay(fromAppleFirstWeekday: calendar.firstWeekday)
        let selection = period
        let range = PlayPeriods.selectionRange(selection, today: today, firstDay: firstDay)
        if phase != .loading { isRefreshing = true }
        let outcome = await stats.summary(from: range.from, to: range.to, force: force)
        guard mine == generation else { return }
        isRefreshing = false
        switch outcome {
        case .signedOut: finish(.signedOut)
        case .failed: finish(.failed)
        case .busy: finish(.busy)
        case .ok(let summary): apply(summary, for: selection)
        }
    }

    private func finish(_ next: StatsPhase) {
        phase = next
        result = nil
    }

    private func apply(_ summary: PlaysSummary, for selection: PeriodSelection) {
        let library = releasesProvider()
        releases = library
        displayed = selection
        let allTime = PlayStats.aggregate(releases: library, counts: summary.allTime, limit: 0).total
        allTimeTotal = allTime
        let counts: [PlayCount]
        if selection.kind == .all {
            counts = Self.withDays(summary.allTime, from: summary.tracks)
        } else {
            counts = summary.tracks
        }
        let ranked = PlayStats.aggregate(releases: library, counts: counts, limit: .max)
        result = ranked
        if ranked.total > 0 {
            phase = .ready
        } else {
            phase = allTime > 0 && selection.kind != .all ? .quiet : .noPlays
        }
    }

    /// All-time counts carry no days; the period's own rows (the longest range) do, so the last
    /// played day is taken from them, as the Mac does.
    static func withDays(_ allTime: [PlayCount], from tracks: [PlayCount]) -> [PlayCount] {
        var days: [String: String] = [:]
        for count in tracks {
            guard let day = count.lastPlayedDay, !day.isEmpty else { continue }
            days[count.releaseId.lowercased() + "/" + count.trackId.lowercased()] = day
        }
        return allTime.map { count in
            var copy = count
            copy.lastPlayedDay = days[count.releaseId.lowercased() + "/" + count.trackId.lowercased()]
            return copy
        }
    }

    // MARK: - Opening

    /// Tracks and albums open their release; an artist asks for the Library filtered to their name.
    func open(_ item: StatItem, openRelease: (Release) -> Void, requestLibrarySearch: (String) -> Void) {
        if let id = item.releaseId {
            if let release = releases.first(where: { $0.id == id }) { openRelease(release) }
        } else {
            requestLibrarySearch(item.title)
        }
    }

    /// The release that owns an item's cover (an artist's is its best release's).
    func coverOwner(of item: StatItem) -> UUID? {
        if let id = item.releaseId { return id }
        guard let path = item.coverPath else { return nil }
        return releases.first { $0.coverPath == path }?.id
    }
}
