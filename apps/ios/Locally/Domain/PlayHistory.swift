import Foundation

// The History screen's model (#399, plan 368 "History"): the play events `GET /v1/plays/events` returns, grouped by
// the day the playing device says they happened on, each play resolved against the releases this phone holds.
// Pure: no networking, no clock (the caller passes today), so the tests fix every input.

/// The device a play was made on, as the service lists it (also a revoked one).
struct HistoryDevice: Equatable {
    var name: String
    var platform: String
    /// True for the requesting device.
    var current: Bool
}

/// One play event as the service returns it.
struct HistoryEvent: Equatable, Identifiable {
    var id: String
    var releaseId: UUID
    var trackId: UUID
    /// "locally" or "spotify".
    var source: String
    /// Epoch milliseconds.
    var startedAt: Int64
    /// The playing device's local `YYYY-MM-DD`.
    var day: String
    /// Audible milliseconds, 0 to 86,400,000.
    var listenedMs: Int
    var device: HistoryDevice

    var started: Date { Date(timeIntervalSince1970: Double(startedAt) / 1000) }
}

/// A play with its release and track found in the library (or not).
struct HistoryPlay: Identifiable, Equatable {
    /// The track length assumed when the library holds none, in milliseconds.
    static let assumedLengthMs = 200_000
    /// At least this much of the track heard counts as a full listen.
    static let fullListenFraction = 0.9

    let event: HistoryEvent
    /// The track's title; the release's title when only the release is known; nil when neither is on this phone.
    let title: String?
    let artist: String?
    /// The song page can open: the release and the track are both in the library.
    let opensSong: Bool
    let lengthMs: Int

    var id: String { event.id }
    var releaseId: UUID { event.releaseId }
    var trackId: UUID { event.trackId }
    var isSpotify: Bool { event.source == "spotify" }
    /// How much of the track was heard, 0 to 1.
    var fraction: Double { min(1, Double(event.listenedMs) / Double(max(1, lengthMs))) }
    var isFullListen: Bool { fraction >= Self.fullListenFraction }
}

/// One local day of plays, newest play first.
struct HistoryDay: Identifiable, Equatable {
    let day: String
    let plays: [HistoryPlay]
    /// The release of the newest play that has a cover to show, for the wash; nil when the day has no plays.
    let topReleaseId: UUID?

    var id: String { day }
    var playCount: Int { plays.count }
    var listenedMs: Int { plays.reduce(0) { $0 + $1.event.listenedMs } }
    /// Whole minutes heard, at least 1 for a day with plays.
    var minutes: Int { plays.isEmpty ? 0 : max(1, Int((Double(listenedMs) / 60_000).rounded())) }

    /// The day on the calendar at noon, so a daylight-saving change never moves it to a neighbouring day.
    func date(calendar: Calendar) -> Date { PlayHistory.date(of: day, calendar: calendar) }
}

struct PlayHistory: Equatable {
    /// Days that have plays, newest first.
    let days: [HistoryDay]

    /// - Parameters:
    ///   - events: any order; a repeated id counts once.
    ///   - releases: the library. A play whose release is in it keeps the release's title even when the track is gone.
    init(events: [HistoryEvent], releases: [Release]) {
        let byRelease = Dictionary(releases.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var seen = Set<String>()
        let unique = events.filter { seen.insert($0.id).inserted }
        let grouped = Dictionary(grouping: unique, by: \.day)
        days = grouped.map { day, events in
            let plays = events
                .sorted { ($0.startedAt, $1.id) > ($1.startedAt, $0.id) }
                .map { Self.play($0, release: byRelease[$0.releaseId]) }
            let top = plays.first { byRelease[$0.releaseId] != nil }?.releaseId ?? plays.first?.releaseId
            return HistoryDay(day: day, plays: plays, topReleaseId: top)
        }
        .sorted { $0.day > $1.day }
    }

    private static func play(_ event: HistoryEvent, release: Release?) -> HistoryPlay {
        guard let release else {
            return HistoryPlay(event: event, title: nil, artist: nil, opensSong: false, lengthMs: HistoryPlay.assumedLengthMs)
        }
        guard let track = release.tracks.first(where: { $0.id == event.trackId }) else {
            return HistoryPlay(event: event, title: release.title, artist: release.artist, opensSong: false, lengthMs: HistoryPlay.assumedLengthMs)
        }
        let length = track.durationSec.map { Int($0 * 1000) } ?? HistoryPlay.assumedLengthMs
        return HistoryPlay(event: event, title: track.title, artist: ArtistCatalog.credit(of: track, in: release).main,
                           opensSong: true, lengthMs: length > 0 ? length : HistoryPlay.assumedLengthMs)
    }

    /// The day with plays, or nil.
    func day(_ day: String) -> HistoryDay? { days.first { $0.day == day } }

    /// `count` consecutive days from `today` back, newest first, with an empty `HistoryDay` for each day without plays.
    /// Counted on the calendar's days as strings, so a 23 or 25 hour day neither repeats nor skips a day.
    func strip(today: String, count: Int) -> [HistoryDay] {
        let byDay = Dictionary(days.map { ($0.day, $0) }, uniquingKeysWith: { first, _ in first })
        return (0..<max(0, count)).map { back in
            let day = PlayPeriods.addDays(today, -back)
            return byDay[day] ?? HistoryDay(day: day, plays: [], topReleaseId: nil)
        }
    }

    /// `YYYY-MM-DD` at noon on the calendar.
    static func date(of day: String, calendar: Calendar) -> Date {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return Date(timeIntervalSince1970: 0) }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        components.hour = 12
        return calendar.date(from: components) ?? Date(timeIntervalSince1970: 0)
    }
}
