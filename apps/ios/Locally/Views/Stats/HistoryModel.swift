import Foundation
import Observation

/// The History screen's state (#399): reads the play events in windows of 14 days, newest first, and groups them with
/// `PlayHistory`. The first read is the last 14 days; scrolling the day strip to its oldest day reads the 14 before
/// that, back to 400 days (the server keeps no more). The service caches and budgets; this keeps what was shown.
/// A window the service could not finish (capped at 10 pages, or a failure part-way) is kept with its cursor and
/// continued before any older window is read. A change of session (sign-in, sign-out, another account) drops every
/// window, and a read that started under the old session is dropped when it lands.
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
    private let focusStartedAt: Int64?
    private var windows: [Int: [HistoryEvent]] = [:]
    /// Windows the service did not finish, with the cursor to continue each from.
    private var cursors: [Int: String] = [:]
    /// The session the windows belong to, and a counter that changes whenever they are dropped.
    private var session: String
    private var epoch = 0
    /// Counts events stored, so a loop can tell whether a read made progress.
    private var applied = 0

    /// - Parameters:
    ///   - selected: the day to open on; today when nil or in the future.
    ///   - focusStartedAt: the start (epoch ms) of the play the screen was opened for. `focus()` selects the stored day
    ///     of the loaded event with that start; `selected` is only the fallback.
    init(service: PlayHistoryReading, releases: @escaping () -> [Release], now: Date = Date(), calendar: Calendar = .current, selected: String? = nil, focusStartedAt: Int64? = nil) {
        self.service = service
        self.releases = releases
        self.calendar = calendar
        self.focusStartedAt = focusStartedAt
        session = service.session
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
    /// More to read: an unfinished window to continue, or an older window.
    var canLoadOlder: Bool {
        phase == .ready && !isLoadingOlder && windowsRead >= 1
            && (!cursors.isEmpty || (windowsRead < Self.maxWindows && stripCount < Self.maxDays))
    }
    /// No play in any window read so far.
    var isEmpty: Bool { phase == .ready && history.days.isEmpty }
    /// Windows the service did not finish (their index), for tests and the view.
    var incompleteWindows: [Int] { cursors.keys.sorted() }

    /// The releases played on `days`, for loading their covers as the strip shows them.
    func releaseIds(onDays days: Set<String>, discs: Int = .max) -> Set<UUID> {
        var ids = Set<UUID>()
        for day in history.days where days.contains(day.day) { day.plays.prefix(discs).forEach { ids.insert($0.releaseId) } }
        return ids
    }

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

    /// Drops every window when the session is not the one they were read under.
    private func syncSession() {
        let current = service.session
        guard current != session else { return }
        session = current
        epoch += 1
        windows = [:]
        cursors = [:]
        windowsRead = 0
        phase = .loading
        notice = .none
        history = PlayHistory(events: [], releases: [])
    }

    /// Whether a read started under `token` may still land.
    private func stillCurrent(_ token: Int) -> Bool {
        syncSession()
        return token == epoch
    }

    /// Reads the newest window again (`force` skips the cache) and keeps the older windows already read. A newest
    /// window the service did not finish is continued from its cursor instead.
    func load(force: Bool = false) async {
        syncSession()
        let token = epoch
        let (from, to) = bounds(0)
        if let cursor = cursors[0] {
            let read = await service.events(from: from, to: to, force: force, cursor: cursor)
            guard stillCurrent(token) else { return await restart(force: force) }
            apply(read, window: 0, continuing: true)
        } else {
            let read = await service.events(from: from, to: to, force: force, cursor: nil)
            guard stillCurrent(token) else { return await restart(force: force) }
            apply(read, window: 0, continuing: false)
        }
    }

    /// A read finished after the session changed and was dropped: nothing else is reading for the new session, so read
    /// it now (window 0, then the focus). Each restart follows one session change; a signed-out session ends in
    /// `.signedOut` from the service's answer.
    private func restart(force: Bool) async {
        await load(force: force)
        if focusStartedAt != nil, phase == .ready { await focus() }
    }

    /// Continues the oldest unfinished window from its cursor, else reads the 14 days before the oldest read; does
    /// nothing at 400 days.
    func loadOlder() async {
        guard canLoadOlder else { return }
        isLoadingOlder = true
        defer { isLoadingOlder = false }
        let token = epoch
        if let index = cursors.keys.min(), let cursor = cursors[index] {
            let (from, to) = bounds(index)
            let read = await service.events(from: from, to: to, force: false, cursor: cursor)
            guard stillCurrent(token) else { return await restart(force: false) }
            apply(read, window: index, continuing: true)
            return
        }
        let index = windowsRead
        let (from, to) = bounds(index)
        let read = await service.events(from: from, to: to, force: false, cursor: nil)
        guard stillCurrent(token) else { return await restart(force: false) }
        apply(read, window: index, continuing: false)
    }

    /// Reads older windows until `day` is in the strip (a day from the song page can be weeks back).
    func reveal(_ day: String) async {
        while phase == .ready, day < PlayPeriods.addDays(today, -(stripCount - 1)), windowsRead < Self.maxWindows || !cursors.isEmpty {
            let before = applied
            await loadOlder()
            if applied == before { break }
        }
    }

    /// Selects the day of the loaded event that started at the focus time, reading older windows until it is found
    /// or 400 days are reached. A play older than 400 days opens Today; one never found falls back to `selected`.
    func focus() async {
        guard let at = focusStartedAt else {
            await reveal(selected)
            return
        }
        if Date(timeIntervalSince1970: Double(at) / 1000) < bounds(Self.maxWindows - 1).0 {
            selected = today
            return
        }
        while phase == .ready {
            if let found = windows.values.joined().first(where: { $0.startedAt == at }) {
                selected = found.day
                break
            }
            // Inside a window already read and still absent (all of it read): it is not coming.
            if windowsRead >= 1, cursors.isEmpty, Date(timeIntervalSince1970: Double(at) / 1000) >= bounds(windowsRead - 1).0 { break }
            guard windowsRead < Self.maxWindows || !cursors.isEmpty else { break }
            let before = applied
            await loadOlder()
            if applied == before { break }
        }
        await reveal(selected)
    }

    private func apply(_ read: PlayHistoryRead, window index: Int, continuing: Bool) {
        switch read {
        case .ok(let events):
            store(events, window: index, continuing: continuing)
            cursors[index] = nil
            notice = .none
        case .stale(let events, let busy):
            store(events, window: index, continuing: continuing)
            cursors[index] = nil
            notice = busy ? .busy : .offline
        case .partial(let events, let cursor, let busy):
            store(events, window: index, continuing: continuing)
            cursors[index] = cursor
            notice = busy.map { $0 ? .busy : .offline } ?? .none
        case .signedOut:
            windows = [:]
            cursors = [:]
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

    private func store(_ events: [HistoryEvent], window index: Int, continuing: Bool) {
        if continuing {
            let have = Set((windows[index] ?? []).map(\.id))
            windows[index, default: []] += events.filter { !have.contains($0.id) }
        } else {
            windows[index] = events
        }
        windowsRead = max(windowsRead, index + 1)
        phase = .ready
        applied += 1
        rebuild()
    }

    /// Groups again against the library as it is now.
    func rebuild() {
        history = PlayHistory(events: windows.values.flatMap { $0 }, releases: releases())
    }
}
