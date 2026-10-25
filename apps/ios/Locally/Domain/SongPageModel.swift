import Foundation

/// A song's plays, read from the play stats: the all-time total, the day it was last played and the count in each
/// period that was read (#365). Pure.
struct SongPlays: Equatable, Sendable {
    struct Period: Equatable, Sendable {
        let kind: StatsPeriodKind
        let plays: Int
    }

    var total: Int
    /// `YYYY-MM-DD`, the latest day any of the ranged reads has a play of this song.
    var lastPlayedDay: String?
    /// The latest play's time in epoch milliseconds (#397) over the ranged reads; nil when the service sent none.
    var lastPlayedAt: Int64?
    /// Shortest period first; a period whose read failed is left out, never shown as zero.
    var byPeriod: [Period]

    /// The plays of one track: the all-time `total` (from the per-release plays read) and one ranged read per shorter
    /// period. A period whose read failed is left out. A track counts only under the release it was counted for; ids
    /// match case-insensitively. The last played day is the latest in the ranged reads, so it is nil when the
    /// 400-day buckets hold none (even with a positive total).
    static func make(trackID: UUID, releaseID: UUID, total: Int, reads: [StatsPeriodKind: PlaysSummary]) -> SongPlays {
        let track = trackID.uuidString.lowercased()
        let release = releaseID.uuidString.lowercased()
        func mine(_ counts: [PlayCount]) -> [PlayCount] {
            counts.filter { $0.trackId.lowercased() == track && $0.releaseId.lowercased() == release }
        }
        var periods: [Period] = []
        var lastDay: String?
        var lastAt: Int64?
        for kind in StatsPeriodKind.allCases where kind != .all {
            guard let summary = reads[kind] else { continue }
            let rows = mine(summary.tracks)
            periods.append(Period(kind: kind, plays: rows.map(\.plays).max() ?? 0))
            for day in rows.compactMap(\.lastPlayedDay) where day > (lastDay ?? "") { lastDay = day }
            for at in rows.compactMap(\.lastPlayedAt) where at > (lastAt ?? 0) { lastAt = at }
        }
        periods.append(Period(kind: .all, plays: total))
        return SongPlays(total: total, lastPlayedDay: lastDay, lastPlayedAt: lastAt, byPeriod: periods)
    }
}

/// Everything a song page shows, as plain values (#365): built from the release, the track, the plays and the
/// collections, so the page itself only lays it out. A missing length, size or genre is nil and the row is left out.
struct SongPageModel: Equatable, Sendable {
    struct Credit: Equatable, Sendable {
        let main: String
        let featuring: [String]
    }

    struct CollectionRef: Equatable, Sendable, Identifiable {
        let id: UUID
        let name: String
    }

    struct PeriodRow: Equatable, Sendable {
        let label: String
        let plays: Int
    }

    let releaseID: UUID
    let trackID: UUID
    let title: String
    let artist: String
    let featuring: [String]
    let album: String
    let trackNumber: Int
    let trackCount: Int
    /// Nil on a single-disc release.
    let discNumber: Int?
    let discCount: Int?
    let genre: String?
    let releasedText: String?
    let lengthText: String?
    /// Nil when the plays could not be read (signed out, offline): the Plays group is hidden.
    let playsTotal: Int?
    let lastPlayedText: String?
    /// The local `YYYY-MM-DD` of the last play, for the line that opens History on that day (#399).
    let lastPlayedDay: String?
    let periods: [PeriodRow]
    let collections: [CollectionRef]
    let fileName: String
    let formatName: String
    let sizeText: String?
    let isAdopted: Bool

    /// Only a song whose file is on this phone can be edited here (adopted songs are details only until #285/#332).
    /// Played never: the plays were read and the total is 0. An unknown date with a positive total is not this.
    var neverPlayed: Bool { playsTotal == 0 && lastPlayedText == nil }
    var canEdit: Bool { !isAdopted }
    var canPlay: Bool { !isAdopted }
    /// A song of the user's own can be shared; the file is not on the server for an adopted one.
    var canShare: Bool { !isAdopted }
    var location: String { isAdopted ? Copy.SongPage.onYourMac : Copy.SongPage.onThisPhone }
    var trackText: String { Copy.SongPage.ofTotal(trackNumber, trackCount) }
    var discText: String? {
        guard let discNumber, let discCount else { return nil }
        return Copy.SongPage.ofTotal(discNumber, discCount)
    }

    /// Nil when the release has no such track.
    /// - Parameters:
    ///   - readLength: a length read from the file, for a track that stores none.
    ///   - fileSize: the file's size in bytes, once read.
    ///   - today: the local day, `YYYY-MM-DD`, that "last played" counts from.
    init?(release: Release, trackID: UUID, plays: SongPlays? = nil, collections: [MusicCollection] = [],
          readLength: Double? = nil, fileSize: Int64? = nil, today: String = "", locale: Locale = .current,
          now: Date = Date(), calendar: Calendar = .current) {
        guard let track = release.tracks.first(where: { $0.id == trackID }) else { return nil }
        let credit = ArtistCatalog.credit(of: track, in: release)
        releaseID = release.id
        self.trackID = trackID
        title = ArtistCatalog.plainTitle(track)
        artist = credit.main
        featuring = credit.featuring
        album = release.kind == .single ? ArtistNames.splitFeaturing(release.title).title : release.title
        trackNumber = track.trackNumber
        trackCount = release.tracks.count
        let discs = release.tracks.compactMap(\.discNumber)
        discNumber = track.discNumber
        discCount = track.discNumber == nil ? nil : discs.max()
        genre = release.genre.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
        releasedText = release.date?.formatted(locale: locale)
        lengthText = TrackLength.format(track.durationSec ?? readLength)
        playsTotal = plays?.total
        if let at = plays?.lastPlayedAt {
            lastPlayedText = Copy.Stats.lastPlayedAtLabel(at, now: now, calendar: calendar, locale: locale, lowercaseDay: true)
        } else {
            lastPlayedText = plays?.lastPlayedDay.flatMap { Self.lastPlayed($0, today: today, locale: locale) }
        }
        lastPlayedDay = plays?.lastPlayedAt.map { PlayPeriods.localDayString(Date(timeIntervalSince1970: Double($0) / 1000), calendar: calendar) }
            ?? plays?.lastPlayedDay
        periods = (plays?.byPeriod ?? []).map { PeriodRow(label: Self.label(of: $0.kind), plays: $0.plays) }
        self.collections = MusicCollection.containing(releaseId: release.id, trackId: trackID, in: collections)
            .map { CollectionRef(id: $0.id, name: $0.name) }
        let storedName = track.originalName.isEmpty ? URL(fileURLWithPath: track.filePath).lastPathComponent : track.originalName
        fileName = storedName
        let ext = Self.pathExtension(track.filePath).isEmpty ? Self.pathExtension(track.originalName) : Self.pathExtension(track.filePath)
        formatName = Self.formatName(forExtension: ext)
        isAdopted = release.isAdopted
        sizeText = release.isAdopted ? Copy.SongPage.sizeUnknown : fileSize.map(Self.sizeText(bytes:))
    }

    // MARK: Text

    private static func label(of kind: StatsPeriodKind) -> String {
        switch kind {
        case .today: Copy.SongPage.today
        case .week: Copy.SongPage.thisWeek
        case .month: Copy.SongPage.thisMonth
        case .year: Copy.SongPage.thisYear
        case .all: Copy.SongPage.allTime
        }
    }

    /// "today", "yesterday", "3 days ago" up to a week, then the date; nil when `day` is not a date.
    static func lastPlayed(_ day: String, today: String, locale: Locale = .current) -> String? {
        guard let date = ReleaseDate.fromTag(day), date.day != nil else { return nil }
        if !today.isEmpty {
            for ago in 0...6 where PlayPeriods.addDays(day, ago) == today {
                switch ago {
                case 0: return Copy.SongPage.playedToday
                case 1: return Copy.SongPage.playedYesterday
                default: return Copy.SongPage.playedDaysAgo(ago)
                }
            }
        }
        return date.formatted(locale: locale)
    }

    private static func pathExtension(_ path: String) -> String {
        URL(fileURLWithPath: path).pathExtension.lowercased()
    }

    /// "AAC (m4a)" from an extension; one this table does not know reads as its upper-case letters.
    static func formatName(forExtension ext: String) -> String {
        switch ext.lowercased() {
        case "m4a": "AAC (m4a)"
        case "mp3": "MP3"
        case "flac": "FLAC"
        case "wav": "WAV"
        case "aif", "aiff": "AIFF"
        case "ogg": "Ogg Vorbis"
        case "opus": "Opus"
        case "": "Unknown"
        default: ext.uppercased()
        }
    }

    /// "8.4 MB": decimal units, one decimal from a megabyte, whole kilobytes below it. Fixed digits, whatever the locale.
    static func sizeText(bytes: Int64) -> String {
        let value = Double(max(0, bytes))
        if value >= 1_000_000_000 { return String(format: "%.1f GB", value / 1_000_000_000) }
        if value >= 999_500 { return String(format: "%.1f MB", value / 1_000_000) }
        if value >= 1_000 { return String(format: "%.0f KB", value / 1_000) }
        return bytes == 1 ? "1 byte" : "\(max(0, bytes)) bytes"
    }
}

/// What a tap on the song's sleeve does (#365): nothing when this phone does not hold the song; otherwise start it
/// from here, pause it or resume it. Pure, like `CollectionSleeveAction`.
enum SongSleeveAction: Equatable {
    case inert, start, pause, resume

    static func resolve(canPlay: Bool, isCurrent: Bool, isPlaying: Bool) -> SongSleeveAction {
        guard canPlay else { return .inert }
        guard isCurrent else { return .start }
        return isPlaying ? .pause : .resume
    }

    /// "Play Paper Moon" / "Pause Paper Moon" / "Resume Paper Moon"; when it cannot play, why.
    func label(title: String) -> String {
        switch self {
        case .start: Copy.SongPage.playLabel(title)
        case .pause: Copy.SongPage.pauseLabel(title)
        case .resume: Copy.SongPage.resumeLabel(title)
        case .inert: Copy.SongPage.onlyOnMac(title)
        }
    }

    var hint: String {
        switch self {
        case .start: Copy.SongPage.playHint
        case .pause: Copy.SongPage.pauseHint
        case .resume: Copy.SongPage.resumeHint
        case .inert: ""
        }
    }
}
