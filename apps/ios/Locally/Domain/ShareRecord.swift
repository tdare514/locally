import Foundation

// Wire types for sharing (#146, #183), copied from `spec/sync.md` "Shares (#146)" and
// `apps/api/src/shared/types.ts`. JSON is camelCase; times are ISO 8601 strings, decoded to `Date`
// by `JSONDecoder.syncApi`. The spec calls the snapshot `Snapshot`; `types.ts` calls it
// `ShareSnapshot`, which is the name used here.

/// One track of a share's snapshot. `discNumber` and `durationSec` are omitted when absent.
struct ShareSnapshotTrack: Codable, Hashable {
    var id: String
    var title: String
    var trackNumber: Int
    var discNumber: Int?
    var file: String
    var bytes: Int
    var durationSec: Double?
}

/// The release record's own fields at share time; `tracks` holds only the shared ones. A recipient
/// imports from this, not from the live release.
struct ShareSnapshot: Codable, Hashable {
    var kind: String
    var title: String
    var artist: String
    var year: String?
    /// `YYYY-MM` or `YYYY-MM-DD`; omitted when the record has none.
    var releaseDate: String?
    var genre: String?
    var cover: String?
    var coverHash: String?
    var tracks: [ShareSnapshotTrack]

    init(
        kind: String, title: String, artist: String, year: String? = nil, releaseDate: String? = nil,
        genre: String? = nil, cover: String? = nil, coverHash: String? = nil, tracks: [ShareSnapshotTrack]
    ) {
        self.kind = kind
        self.title = title
        self.artist = artist
        self.year = year
        self.releaseDate = releaseDate
        self.genre = genre
        self.cover = cover
        self.coverHash = coverHash
        self.tracks = tracks
    }

    private enum CodingKeys: String, CodingKey {
        case kind, title, artist, year, releaseDate, genre, cover, coverHash, tracks
    }

    /// Refuses a snapshot that names a file this app would not use (`SyncFileName`), as
    /// `SyncRecord.init(from:)` does, so a share page can skip the one share and keep the rest.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        kind = try container.decode(String.self, forKey: .kind)
        title = try container.decode(String.self, forKey: .title)
        artist = try container.decode(String.self, forKey: .artist)
        year = try container.decodeIfPresent(String.self, forKey: .year)
        // A non-string reads as absent: a bad date is never a reason to refuse the share.
        releaseDate = (try? container.decodeIfPresent(String.self, forKey: .releaseDate)) ?? nil
        genre = try container.decodeIfPresent(String.self, forKey: .genre)
        cover = try container.decodeIfPresent(String.self, forKey: .cover)
        coverHash = try container.decodeIfPresent(String.self, forKey: .coverHash)
        tracks = try container.decode([ShareSnapshotTrack].self, forKey: .tracks)
        for (index, track) in tracks.enumerated() where !SyncFileName.hasSupportedExtension(track.file) {
            throw SyncRecordRejected(field: "tracks[\(index)].file", name: track.file)
        }
        if let cover, !SyncFileName.hasSupportedExtension(cover) {
            throw SyncRecordRejected(field: "cover", name: cover)
        }
    }

    /// The date this snapshot carries, as for a sync record: `releaseDate` when it is real and agrees
    /// with `year`, else the year alone.
    var date: ReleaseDate? { ReleaseDate.stored(year: year, releaseDate: releaseDate) }
}

enum ShareVisibility: String, Codable, Hashable {
    case `private`
    case `public`
}

struct ShareRecipient: Codable, Hashable {
    var email: String
    var claimedAt: Date?
}

/// A share the caller made (`GET /v1/shares?role=sent`); revoked and expired ones are included.
struct SentShare: Codable, Hashable, Identifiable {
    var id: String
    var releaseId: String
    var trackIds: [String]?
    var visibility: ShareVisibility
    var allowReshare: Bool
    var expiresAt: Date?
    var revokedAt: Date?
    var createdAt: Date
    var snapshot: ShareSnapshot
    var recipients: [ShareRecipient]
    var hasLink: Bool
    var parentShareId: String?
    var downloads: Int

    func isExpired(at now: Date) -> Bool { expiresAt.map { $0 <= now } ?? false }
    func isLive(at now: Date) -> Bool { revokedAt == nil && !isExpired(at: now) }
}

struct ShareSender: Codable, Hashable {
    var email: String
}

/// A share sent to the caller (`GET /v1/shares?role=received`).
struct ReceivedShare: Codable, Hashable, Identifiable {
    var id: String
    var from: ShareSender
    var trackIds: [String]?
    var allowReshare: Bool
    var canReshare: Bool
    var expiresAt: Date?
    var createdAt: Date
    var claimedAt: Date?
    var snapshot: ShareSnapshot
}

/// One element of a decoded shares page: `nil` when the snapshot named a file this app refuses, so
/// one bad share does not fail the page. Any other decoding error still fails it.
struct SharePageElement<Share: Decodable>: Decodable {
    let share: Share?

    init(from decoder: Decoder) throws {
        do {
            share = try Share(from: decoder)
        } catch is SyncRecordRejected {
            share = nil
        }
    }
}

/// `GET /v1/shares`'s reply: `{ shares, nextCursor }`.
struct SharesPage<Share: Decodable>: Decodable {
    var shares: [Share]
    var nextCursor: String?

    private enum CodingKeys: String, CodingKey { case shares, nextCursor }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        shares = try container.decode([SharePageElement<Share>].self, forKey: .shares).compactMap(\.share)
        nextCursor = try container.decodeIfPresent(String.self, forKey: .nextCursor)
    }
}

/// Body of `POST /v1/shares`.
struct ShareCreateRequest: Equatable {
    var releaseId: String
    /// `nil` shares the whole release.
    var trackIds: [String]?
    var recipients: [String]
    var visibility: ShareVisibility
    var allowReshare: Bool
    /// `nil`, 7 or 30.
    var expiresInDays: Int?

    var json: [String: Any] {
        var body: [String: Any] = [
            "releaseId": releaseId,
            "recipients": recipients,
            "visibility": visibility.rawValue,
            "allowReshare": allowReshare,
            "expiresInDays": expiresInDays.map { $0 as Any } ?? NSNull(),
        ]
        if let trackIds { body["trackIds"] = trackIds }
        return body
    }
}

/// `POST /v1/shares`'s reply. `share` is `nil` (a 200) when a private share reached nobody; `link`
/// is the full URL, returned only here and only for a public share.
struct ShareCreateResult: Decodable, Equatable {
    var share: SentShare?
    var notOnLocally: [String]
    var link: String?
}
