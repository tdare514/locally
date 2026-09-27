import Foundation

/// A single audio track within a `Release`, ordered by `trackNumber`.
/// Mirrors `spec/metadata.md`'s Track shape so the same data round-trips
/// with the Mac app's library index.
struct Track: Identifiable, Codable, Hashable {
    var id: UUID
    var title: String
    var trackNumber: Int
    /// Current file location. iOS keeps this name fixed once imported.
    var filePath: String
    /// The name the user originally imported (before renaming/layout).
    var originalName: String
    var durationSec: Double?

    init(
        id: UUID = UUID(),
        title: String,
        trackNumber: Int,
        filePath: String,
        originalName: String,
        durationSec: Double? = nil
    ) {
        self.id = id
        self.title = title
        self.trackNumber = trackNumber
        self.filePath = filePath
        self.originalName = originalName
        self.durationSec = durationSec
    }
}

/// Whether a `Release` is a single track or a multi-track album.
/// A single always has exactly one track.
enum ReleaseKind: String, Codable, CaseIterable {
    case single
    case album
}

/// A release (single or album) as tagged and placed into Spotify's Local
/// Files folder. Mirrors `spec/metadata.md`'s Release shape; kept as a
/// plain Codable struct (independent of SwiftData) so it is easy to test
/// and to share logic with `ReleaseLayout`.
struct Release: Identifiable, Codable, Hashable {
    var id: UUID
    var kind: ReleaseKind
    /// Album title; for a single this defaults to the track title.
    var title: String
    /// Album artist, and (unless a track overrides) the track artist.
    var artist: String
    /// Four-digit year, if known.
    var year: String?
    var genre: String?
    /// Path to `cover.jpg`/`cover.png` beside the tracks, if a cover was set.
    var coverPath: String?
    /// Folder the tracks live in (flat, inside Spotify's Local Files folder).
    var folderPath: String
    var tracks: [Track]
    var createdAt: Date
    var updatedAt: Date
    /// The `updatedAt` this release had the last time it was successfully
    /// pushed to the sync service, or `nil` if it has never been pushed.
    /// `SyncEngine` back-fills any release where this is `nil` after sign-in,
    /// and re-pushes one whenever `updatedAt` moves past it.
    var syncedUpdatedAt: Date?

    init(
        id: UUID = UUID(),
        kind: ReleaseKind,
        title: String,
        artist: String,
        year: String? = nil,
        genre: String? = nil,
        coverPath: String? = nil,
        folderPath: String,
        tracks: [Track],
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        syncedUpdatedAt: Date? = nil
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.artist = artist
        self.year = year
        self.genre = genre
        self.coverPath = coverPath
        self.folderPath = folderPath
        self.tracks = tracks
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.syncedUpdatedAt = syncedUpdatedAt
    }
}

/// One track's user-entered title within an `AlbumDraft`, matched to its
/// source file by position — the Nth `TrackDraft` in `AlbumDraft.tracks`
/// corresponds to the Nth URL in the `files` array passed alongside it to
/// `ReleaseCoordinator.importAlbum`.
struct TrackDraft: Identifiable, Hashable {
    var id: UUID = UUID()
    var title: String

    init(id: UUID = UUID(), title: String) {
        self.id = id
        self.title = title
    }
}

/// The album-level metadata and ordered track titles collected by
/// `AlbumBuilderView`, handed to `ReleaseCoordinator.importAlbum` alongside
/// the picked files in the same order as `tracks`.
struct AlbumDraft {
    var title: String
    var artist: String
    var year: String?
    var genre: String?
    var tracks: [TrackDraft]

    init(title: String, artist: String, year: String? = nil, genre: String? = nil, tracks: [TrackDraft]) {
        self.title = title
        self.artist = artist
        self.year = year
        self.genre = genre
        self.tracks = tracks
    }
}

/// Partial edits to an existing `Release`, applied in place by
/// `ReleaseCoordinator.updateRelease`. `nil` on `title`/`artist`/`year`/
/// `genre`/`cover` means "keep the current value"; for `year`/`genre`, an
/// empty string clears the field (there is no separate way to distinguish
/// "leave alone" from "set to empty" other than via `nil` vs `""`).
/// `trackTitles` maps a track's `id` to its new title — tracks whose id is
/// absent keep their current title. `trackOrder`, if given, is the full new
/// track order by id; any known track id missing from it is appended after,
/// so a caller can't accidentally drop a track by leaving it out.
struct ReleaseChanges {
    var title: String?
    var artist: String?
    var year: String?
    var genre: String?
    var cover: Data?
    var trackTitles: [UUID: String]
    var trackOrder: [UUID]?

    init(
        title: String? = nil,
        artist: String? = nil,
        year: String? = nil,
        genre: String? = nil,
        cover: Data? = nil,
        trackTitles: [UUID: String] = [:],
        trackOrder: [UUID]? = nil
    ) {
        self.title = title
        self.artist = artist
        self.year = year
        self.genre = genre
        self.cover = cover
        self.trackTitles = trackTitles
        self.trackOrder = trackOrder
    }
}

/// The user-editable tag fields for a single track, as collected by the
/// import UI and handed to a `TagWriter`. Kept separate from `Release`
/// because it describes one file's tags, not the library record.
struct TagSet: Codable, Hashable {
    var title: String
    var artist: String
    var albumArtist: String
    var album: String
    var trackNumber: Int
    var totalTracks: Int
    var year: String?
    var genre: String?

    init(
        title: String,
        artist: String,
        albumArtist: String? = nil,
        album: String,
        trackNumber: Int = 1,
        totalTracks: Int = 1,
        year: String? = nil,
        genre: String? = nil
    ) {
        self.title = title
        self.artist = artist
        self.albumArtist = albumArtist ?? artist
        self.album = album
        self.trackNumber = trackNumber
        self.totalTracks = totalTracks
        self.year = year
        self.genre = genre
    }
}
