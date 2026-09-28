import Foundation

/// ISO 8601 date coding shared by every sync wire type. The API (see
/// `apps/api/src/shared/types.ts`) validates timestamps with
/// `z.string().datetime({ offset: true })`, which accepts fractional seconds
/// (`Date.toISOString()`'s own output always has them) but the example in
/// `spec/sync.md` doesn't — so decoding tries fractional seconds first, then
/// falls back to whole seconds. Encoding always emits fractional seconds.
enum SyncDateFormat {
    static let withFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static let wholeSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static func decode(_ string: String) -> Date? {
        withFractionalSeconds.date(from: string) ?? wholeSeconds.date(from: string)
    }

    static func encode(_ date: Date) -> String {
        withFractionalSeconds.string(from: date)
    }
}

extension JSONDecoder {
    /// A decoder configured for every sync wire type: ISO 8601 dates (see
    /// `SyncDateFormat`) via a custom strategy, since `Foundation`'s built-in
    /// `.iso8601` strategy can't flex between fractional and whole seconds.
    static var syncApi: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let string = try container.decode(String.self)
            guard let date = SyncDateFormat.decode(string) else {
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Expected an ISO 8601 date, got \(string)"
                )
            }
            return date
        }
        return decoder
    }
}

extension JSONEncoder {
    /// The encoder counterpart to `JSONDecoder.syncApi`.
    static var syncApi: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(SyncDateFormat.encode(date))
        }
        return encoder
    }
}

/// One track inside a `SyncRecord`, matching `spec/sync.md`'s `tracks[]`
/// shape and the API's `trackRecordSchema`. `file` is the name the track's
/// bytes are stored under in the sync service's object storage — fixed once
/// uploaded, independent of either platform's own on-disk file name.
struct SyncTrack: Codable, Hashable {
    var id: String
    var title: String
    var trackNumber: Int
    var file: String
    var bytes: Int
    var durationSec: Double?

    private enum CodingKeys: String, CodingKey {
        case id, title, trackNumber, file, bytes, durationSec
    }

    init(id: String, title: String, trackNumber: Int, file: String, bytes: Int, durationSec: Double? = nil) {
        self.id = id
        self.title = title
        self.trackNumber = trackNumber
        self.file = file
        self.bytes = bytes
        self.durationSec = durationSec
    }

    /// Swift's synthesized `Encodable` for an `Optional` property omits the
    /// JSON key entirely when the value is `nil` — but the API's
    /// `durationSec: z.number().nonnegative().nullable()` (see
    /// `apps/api/src/shared/types.ts`) requires the key to be *present*
    /// (`null` is fine; a missing key is a zod "Required" error). Confirmed
    /// live against the running API during this pass: a track with no
    /// duration 400'd every `PUT` for the release it belonged to until this
    /// was written explicitly. `container.encode` (not `encodeIfPresent`)
    /// on an `Optional` does write `null`, since `Optional` itself is
    /// `Encodable`.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(title, forKey: .title)
        try container.encode(trackNumber, forKey: .trackNumber)
        try container.encode(file, forKey: .file)
        try container.encode(bytes, forKey: .bytes)
        try container.encode(durationSec, forKey: .durationSec)
    }
}

/// The wire shape of a release, identical to `spec/sync.md`'s record: the
/// shared metadata model (`spec/metadata.md`) plus sync bookkeeping
/// (`origin`, `originDevice`, `deleted`) and, once round-tripped through the
/// server, its `version`. Kept independent of `Release`/`Track` (which model
/// the on-disk library) so wire format changes never ripple into domain
/// logic — `toSyncRecord`/`toRelease` are the only bridge.
struct SyncRecord: Codable, Hashable {
    var syncVersion: Int
    var id: String
    var kind: String
    var title: String
    var artist: String
    var year: String?
    var genre: String?
    var cover: String?
    /// Lowercase hex sha256 of the cover's bytes (`syncVersion` 2). `nil`
    /// both for "no cover" and for a v1 record that carries no key; either
    /// way there is no change signal and the receiver leaves its cover alone.
    var coverHash: String?
    var tracks: [SyncTrack]
    var origin: String
    var originDevice: String
    var createdAt: Date
    var updatedAt: Date
    var deleted: Bool
    /// Present on records the server has returned (GET /v1/releases); `nil`
    /// on a record this device is about to `PUT` for the first time.
    var version: Int?

    init(
        syncVersion: Int = 1,
        id: String,
        kind: String,
        title: String,
        artist: String,
        year: String? = nil,
        genre: String? = nil,
        cover: String? = nil,
        coverHash: String? = nil,
        tracks: [SyncTrack],
        origin: String,
        originDevice: String,
        createdAt: Date,
        updatedAt: Date,
        deleted: Bool = false,
        version: Int? = nil
    ) {
        self.syncVersion = syncVersion
        self.id = id
        self.kind = kind
        self.title = title
        self.artist = artist
        self.year = year
        self.genre = genre
        self.cover = cover
        self.coverHash = coverHash
        self.tracks = tracks
        self.origin = origin
        self.originDevice = originDevice
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deleted = deleted
        self.version = version
    }

    private enum CodingKeys: String, CodingKey {
        case syncVersion, id, kind, title, artist, year, genre, cover, coverHash, tracks
        case origin, originDevice, createdAt, updatedAt, deleted, version
    }

    /// Same reasoning as `SyncTrack.encode(to:)`: `year`, `genre` and
    /// `cover` are all `.nullable()` (key required, `null` allowed) on the
    /// server, not `.optional()` (key may be absent), so the synthesized
    /// `encodeIfPresent` behaviour for `nil` would 400 the whole `PUT` with
    /// e.g. `"year: Required"`. `version` has no such requirement (the
    /// server doesn't expect it in a `PUT` body at all, and zod silently
    /// drops unrecognised keys), so it alone keeps the omit-when-nil
    /// behaviour via `encodeIfPresent`.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(syncVersion, forKey: .syncVersion)
        try container.encode(id, forKey: .id)
        try container.encode(kind, forKey: .kind)
        try container.encode(title, forKey: .title)
        try container.encode(artist, forKey: .artist)
        try container.encode(year, forKey: .year)
        try container.encode(genre, forKey: .genre)
        try container.encode(cover, forKey: .cover)
        try container.encode(coverHash, forKey: .coverHash)
        try container.encode(tracks, forKey: .tracks)
        try container.encode(origin, forKey: .origin)
        try container.encode(originDevice, forKey: .originDevice)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(deleted, forKey: .deleted)
        try container.encodeIfPresent(version, forKey: .version)
    }
}

// MARK: - Release <-> SyncRecord

extension Release {
    /// Builds the wire record this device would `PUT` for this release.
    /// `fileBytes` supplies each track's current file size (keyed by
    /// `Track.id`, since only the caller — with access to the Spotify
    /// folder — can `stat` the file); a track missing from it encodes as 0
    /// bytes rather than failing, so a push never blocks on a stat error.
    /// The cover, if any, is named `cover.<ext>` in the wire record — iOS
    /// stores covers separately from the tracks (`CoverStore`), unlike the
    /// Mac's `cover.jpg` beside the files, so the wire name is derived from
    /// the stored file's own extension rather than reused from `coverPath`.
    func toSyncRecord(origin: String, originDevice: String, fileBytes: [UUID: Int]) -> SyncRecord {
        SyncRecord(
            id: id.uuidString,
            kind: kind.rawValue,
            title: title,
            artist: artist,
            // The server validates a non-null year against `^\d{4}$` (see
            // `apps/api/src/shared/types.ts`), so an empty string — which
            // shouldn't occur from the app's own import/edit flows (both
            // normalize a blank year field to `nil`), but has been observed
            // on locally-seeded/legacy data — would 400 the whole push.
            // Sent as `nil` defensively rather than failing the release.
            year: year?.isEmpty == true ? nil : year,
            genre: genre,
            cover: coverPath.map { "cover." + (($0 as NSString).pathExtension.isEmpty ? "jpg" : ($0 as NSString).pathExtension) },
            tracks: tracks.map { track in
                SyncTrack(
                    id: track.id.uuidString,
                    title: track.title,
                    trackNumber: track.trackNumber,
                    file: (track.filePath as NSString).lastPathComponent,
                    bytes: fileBytes[track.id] ?? 0,
                    durationSec: track.durationSec
                )
            },
            origin: origin,
            originDevice: originDevice,
            createdAt: createdAt,
            updatedAt: updatedAt,
            deleted: false
        )
    }
}

extension SyncRecord {
    /// Rebuilds a domain `Release` from this record. `fileURLs` maps each
    /// `SyncTrack.file` name to where its bytes now live locally (e.g. a
    /// temp download directory, before `ReleaseCoordinator.importSynced`
    /// moves them into Spotify's folder) — a name missing from it falls back
    /// to the bare wire name, mostly so tests can round-trip a record
    /// without staging real files on disk.
    func toRelease(fileURLs: [String: URL] = [:]) -> Release {
        Release(
            id: UUID(uuidString: id) ?? UUID(),
            kind: ReleaseKind(rawValue: kind) ?? .single,
            title: title,
            artist: artist,
            year: year,
            genre: genre,
            coverPath: cover.map { fileURLs[$0]?.path ?? $0 },
            folderPath: fileURLs.values.first?.deletingLastPathComponent().path ?? "",
            tracks: tracks.map { track in
                Track(
                    id: UUID(uuidString: track.id) ?? UUID(),
                    title: track.title,
                    trackNumber: track.trackNumber,
                    filePath: fileURLs[track.file]?.path ?? track.file,
                    originalName: track.file,
                    durationSec: track.durationSec
                )
            },
            createdAt: createdAt,
            updatedAt: updatedAt,
            syncedUpdatedAt: updatedAt
        )
    }
}
