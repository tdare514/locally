import Foundation

/// One track's plays, from a row of `GET /v1/plays/summary`: the chosen period (with
/// `lastPlayedDay`) or `allTime` (without). Ids are the server's lowercase UUID strings.
struct PlayCount: Equatable {
    var trackId: String
    var releaseId: String
    var plays: Int
    var lastPlayedDay: String?
}

/// The first three ranks get a gold, silver and bronze touch.
enum Medal: Equatable {
    case gold, silver, bronze
}

/// One row of a ranked list (port of the web's `StatItem`, `apps/web/src/lib/play-stats.ts`).
struct StatItem: Identifiable, Equatable {
    /// Stable across refreshes: a track id, a release id, or the normalised artist name.
    var id: String
    /// 1-based. Equal plays are still ordered, so ranks never repeat.
    var rank: Int
    var title: String
    var subtitle: String
    var plays: Int
    /// The latest day (`YYYY-MM-DD`) in the period with a play of it; nil when the counts carry no days (all time).
    var lastPlayedDay: String?
    /// The release to open: a track's own, or the album itself. nil for an artist.
    var releaseId: UUID?
    var trackId: UUID?
    var coverPath: String?
    var medal: Medal?
    /// Estimated listening time in seconds: plays x each track's length, summed for albums and artists. A track with no known length adds 0 (#367).
    var seconds: Double = 0
}

struct PlayStatsResult: Equatable {
    /// Every counted play in the library, each once. 0 means there is nothing to show.
    var total: Int
    var tracks: [StatItem]
    var albums: [StatItem]
    var artists: [StatItem]
}

/// Play-count rankings for the Stats page: the top tracks, albums and artists, from the library
/// plus the summary's counts. Pure. Each play is counted once.
enum PlayStats {
    /// How many of each list the web's sidebar shows.
    static let topCount = 3

    static func medalFor(rank: Int) -> Medal? {
        switch rank {
        case 1: return .gold
        case 2: return .silver
        case 3: return .bronze
        default: return nil
        }
    }

    /// "1 release", "6 releases".
    static func releaseCountLabel(_ count: Int) -> String {
        count == 1 ? "1 release" : "\(count) releases"
    }

    /// "Mira Valdane" and " mira valdane " are one artist.
    static func artistKey(_ name: String) -> String {
        name.precomposedStringWithCompatibilityMapping
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
    }

    private struct Row {
        var id: String
        var title: String
        var subtitle: String
        var plays: Int
        var coverPath: String?
        var releaseId: UUID?
        var trackId: UUID?
        var lastPlayedDay: String?
        var seconds: Double = 0
    }

    private struct ArtistTotals {
        var name: String
        var plays = 0
        /// Releases by this artist in the library, played or not.
        var releases = 0
        /// The most played release by this artist.
        var best: (plays: Int, release: Release)?
        /// The first played release with a cover, for when the best one has none.
        var coverFallback: String?
        var lastPlayedDay: String?
        var seconds: Double = 0
    }

    private static func laterDay(_ a: String?, _ b: String?) -> String? {
        guard let a else { return b }
        guard let b else { return a }
        return a > b ? a : b
    }

    private static func compareText(_ a: String, _ b: String) -> ComparisonResult {
        let result = a.compare(b, options: [.caseInsensitive, .diacriticInsensitive], range: nil, locale: Locale(identifier: "en"))
        if result != .orderedSame { return result }
        return a < b ? .orderedAscending : (a > b ? .orderedDescending : .orderedSame)
    }

    /// Most plays first. Equal plays go A to Z by title, then by id, so the order never flickers.
    private static func rank(_ rows: [Row], limit: Int) -> [StatItem] {
        let sorted = rows.filter { $0.plays > 0 }.sorted { a, b in
            if a.plays != b.plays { return a.plays > b.plays }
            let byTitle = compareText(a.title, b.title)
            if byTitle != .orderedSame { return byTitle == .orderedAscending }
            return compareText(a.id, b.id) == .orderedAscending
        }
        return sorted.prefix(max(0, limit)).enumerated().map { i, row in
            StatItem(
                id: row.id, rank: i + 1, title: row.title, subtitle: row.subtitle, plays: row.plays,
                lastPlayedDay: row.lastPlayedDay, releaseId: row.releaseId, trackId: row.trackId,
                coverPath: row.coverPath, medal: medalFor(rank: i + 1), seconds: row.seconds
            )
        }
    }

    private static func coverOf(_ release: Release) -> String? {
        guard let path = release.coverPath, !path.isEmpty else { return nil }
        return path
    }

    /// The top `limit` tracks, albums (releases, singles included) and artists by plays. Only
    /// tracks still in the library count, so a count left behind for a removed track is ignored,
    /// and a track only counts under the release it was counted for. Ids match case-insensitively.
    /// Ties: A to Z by title, then by id. An artist with a blank name is left out of the artist list.
    static func aggregate(releases: [Release], counts: [PlayCount], limit: Int = topCount) -> PlayStatsResult {
        var trackRows: [Row] = []
        var albumRows: [Row] = []
        var artists: [String: ArtistTotals] = [:]
        var artistOrder: [String] = []
        var total = 0

        var countsByRelease: [String: [String: PlayCount]] = [:]
        for count in counts {
            countsByRelease[count.releaseId.lowercased(), default: [:]][count.trackId.lowercased()] = count
        }

        for release in releases {
            let key = artistKey(release.artist)
            if key != "" && artists[key] == nil {
                artists[key] = ArtistTotals(name: release.artist.trimmingCharacters(in: .whitespacesAndNewlines))
                artistOrder.append(key)
            }
            artists[key]?.releases += 1
        }

        for release in releases {
            let releaseKey = release.id.uuidString.lowercased()
            let counted = countsByRelease[releaseKey]
            let cover = coverOf(release)
            var releasePlays = 0
            var releaseLast: String?
            var releaseSeconds = 0.0
            for track in release.tracks {
                let trackKey = track.id.uuidString.lowercased()
                let entry = counted?[trackKey]
                let plays = entry?.plays ?? 0
                if plays <= 0 { continue }
                releasePlays += plays
                let seconds = Double(plays) * max(0, track.durationSec ?? 0)
                releaseSeconds += seconds
                let lastPlayedDay = (entry?.lastPlayedDay).flatMap { $0.isEmpty ? nil : $0 }
                releaseLast = laterDay(releaseLast, lastPlayedDay)
                trackRows.append(Row(
                    id: trackKey,
                    title: track.title.isEmpty ? release.title : track.title,
                    subtitle: release.artist, plays: plays, coverPath: cover,
                    releaseId: release.id, trackId: track.id, lastPlayedDay: lastPlayedDay, seconds: seconds
                ))
            }
            if releasePlays == 0 { continue }

            total += releasePlays
            albumRows.append(Row(
                id: releaseKey,
                title: release.title.isEmpty ? release.artist : release.title,
                subtitle: release.artist, plays: releasePlays, coverPath: cover,
                releaseId: release.id, trackId: nil, lastPlayedDay: releaseLast, seconds: releaseSeconds
            ))

            let key = artistKey(release.artist)
            if var artist = artists[key] {
                artist.plays += releasePlays
                artist.seconds += releaseSeconds
                artist.lastPlayedDay = laterDay(artist.lastPlayedDay, releaseLast)
                if artist.best == nil || releasePlays > artist.best!.plays {
                    artist.best = (releasePlays, release)
                }
                if artist.coverFallback == nil, let cover { artist.coverFallback = cover }
                artists[key] = artist
            }
        }

        let artistRows: [Row] = artistOrder.compactMap { key in
            guard let a = artists[key] else { return nil }
            let genre = a.best?.release.genre ?? ""
            return Row(
                id: key, title: a.name,
                subtitle: genre.isEmpty ? releaseCountLabel(a.releases) : genre,
                plays: a.plays,
                coverPath: a.best.flatMap { coverOf($0.release) } ?? a.coverFallback,
                releaseId: nil, trackId: nil, lastPlayedDay: a.lastPlayedDay, seconds: a.seconds
            )
        }

        return PlayStatsResult(
            total: total,
            tracks: rank(trackRows, limit: limit),
            albums: rank(albumRows, limit: limit),
            artists: rank(artistRows, limit: limit)
        )
    }
}
