import Foundation
import Observation

/// The History screen's state (#399): reads the play events in windows of 14 days, newest first, and groups them with
/// `PlayHistory`. The first read is the last 14 days; scrolling the day strip to its oldest day reads the 14 before
/// that, back to 400 days (the server keeps no more). The service caches and budgets; this keeps what was shown.
@MainActor
@Observable
final class HistoryModel {
    enum Phase: Equatable {
        case loading
        case ready
        case signedOut
        /// Nothing could be read and there is nothing to show (`notice` says why).
        case failed
    }

    /// Why what is shown may be out of date.
    enum Notice: Equatable {
        case none
        /// The last answer is kept: a read could not be made.
        case offline
        /// The request budget or a 429 stopped a read: "Try again in a few minutes".
        case busy
    }

    static let windowDays = 14
    static let maxDays = 400

    private(set) var phase: Phase = .loading
    private(set) var notice: Notice = .none
    private(set) var history: PlayHistory
    private(set) var isLoadingOlder = false
    /// How many 14-day windows have been read (the first is the newest).
    private(set) var windowsRead = 0
    /// The day the page shows, `YYYY-MM-DD`.
    var selected: String

    let today: String
    private let service: PlayHistoryReading
    private let releases: () -> [Release]
    private let calendar: Calendar
    private var windows: [Int: [HistoryEvent]] = [:]

    /// - Parameter selected: the day to open on; today when nil or in the future.
    init(service: PlayHistoryReading, releases: @escaping () -> [Release], now: Date = Date(), calendar: Calendar = .current, selected: String? = nil) {
        self.service = service
        self.releases = releases
        self.calendar = calendar
        today = PlayPeriods.localDayString(now, calendar: calendar)
        history = PlayHistory(events: [], releases: [])
        self.selected = selected.flatMap { $0 <= PlayPeriods.localDayString(now, calendar: calendar) ? $0 : nil }
            ?? PlayPeriods.localDayString(now, calendar: calendar)
    }

    /// The most windows that can be read: 400 days in 14-day steps.
    static var maxWindows: Int { (maxDays + windowDays - 1) / windowDays }

    var stripCount: Int { min(Self.maxDays, max(1, windowsRead) * Self.windowDays) }
    var strip: [HistoryDay] { history.strip(today: today, count: stripCount) }
    var selectedDay: HistoryDay { history.day(selected) ?? HistoryDay(day: selected, plays: [], topReleaseId: nil) }
    var canLoadOlder: Bool { phase == .ready && !isLoadingOlder && windowsRead >= 1 && windowsRead < Self.maxWindows && stripCount < Self.maxDays }
    /// No play in any window read so far.
    var isEmpty: Bool { phase == .ready && history.days.isEmpty }

    /// The first day and the day after the last of window `index`, as local days.
    func window(_ index: Int) -> (from: String, to: String) {
        let from = max(PlayPeriods.addDays(today, -(Self.windowDays - 1) - index * Self.windowDays), PlayPeriods.addDays(today, -(Self.maxDays - 1)))
        return (from, PlayPeriods.addDays(today, 1 - index * Self.windowDays))
    }

    private func bounds(_ index: Int) -> (Date, Date) {
        let range = window(index)
        return (calendar.startOfDay(for: PlayHistory.date(of: range.from, calendar: calendar)),
                calendar.startOfDay(for: PlayHistory.date(of: range.to, calendar: calendar)))
    }

    /// Reads the newest window again (`force` skips the cache) and keeps the older windows already read.
    func load(force: Bool = false) async {
        let (from, to) = bounds(0)
        apply(await service.events(from: from, to: to, force: force), window: 0)
    }

    /// Reads the 14 days before the oldest read; does nothing at 400 days.
    func loadOlder() async {
        guard canLoadOlder else { return }
        isLoadingOlder = true
        defer { isLoadingOlder = false }
        let index = windowsRead
        let (from, to) = bounds(index)
        apply(await service.events(from: from, to: to, force: false), window: index)
    }

    /// Reads older windows until `day` is in the strip (a day from the song page can be weeks back).
    func reveal(_ day: String) async {
        while phase == .ready, day < PlayPeriods.addDays(today, -(stripCount - 1)), windowsRead < Self.maxWindows {
            let before = windowsRead
            await loadOlder()
            if windowsRead == before { break }
        }
    }

    private func apply(_ read: PlayHistoryRead, window index: Int) {
        switch read {
        case .ok(let events):
            store(events, window: index)
            notice = .none
        case .stale(let events, let busy):
            store(events, window: index)
            notice = busy ? .busy : .offline
        case .signedOut:
            windows = [:]
            windowsRead = 0
            phase = .signedOut
            notice = .none
            history = PlayHistory(events: [], releases: [])
        case .failed, .busy:
            let busy = read == .busy
            notice = busy ? .busy : .offline
            // A first read that failed has nothing to show; a later one leaves the screen as it was.
            if windowsRead == 0 { phase = .failed }
        }
    }

    private func store(_ events: [HistoryEvent], window index: Int) {
        windows[index] = events
        windowsRead = max(windowsRead, index + 1)
        phase = .ready
        rebuild()
    }

    /// Groups again against the library as it is now.
    func rebuild() {
        history = PlayHistory(events: windows.values.flatMap { $0 }, releases: releases())
    }
}
