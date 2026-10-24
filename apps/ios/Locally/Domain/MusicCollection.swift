import Foundation

/// A JSON value, kept so a collection item of a kind this build doesn't know survives a pull and a
/// re-push unchanged (`spec/sync.md`, "Collections (#339)": forward compatibility).
enum JSONValue: Codable, Hashable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}

/// One entry in a collection, in the owner's order. `release` plays all of that release's tracks and
/// `track` that one track. Both known kinds are strict, as the API is: a missing or extra key or a bad
/// UUID fails decoding, so a client never writes a malformed one. Any other `kind` is `unknown` and is
/// re-encoded as it came; it is never shown.
enum CollectionItem: Hashable, Codable {
    case release(UUID)
    case track(releaseId: UUID, trackId: UUID)
    case unknown(JSONValue)

    init(from decoder: Decoder) throws {
        let value = try JSONValue(from: decoder)
        func bad(_ why: String) -> DecodingError {
            .dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: why))
        }
        guard case .object(let object) = value, case .string(let kind)? = object["kind"] else {
            throw bad("A collection item needs a string kind.")
        }
        func uuid(_ key: String) -> UUID? {
            if case .string(let text)? = object[key] { return UUID(uuidString: text) }
            return nil
        }
        switch kind {
        case "release":
            guard Set(object.keys) == ["kind", "releaseId"], let releaseId = uuid("releaseId") else {
                throw bad("A malformed release item.")
            }
            self = .release(releaseId)
        case "track":
            guard Set(object.keys) == ["kind", "releaseId", "trackId"], let releaseId = uuid("releaseId"), let trackId = uuid("trackId") else {
                throw bad("A malformed track item.")
            }
            self = .track(releaseId: releaseId, trackId: trackId)
        default:
            self = .unknown(value)
        }
    }

    func encode(to encoder: Encoder) throws {
        switch self {
        case .release(let releaseId):
            try JSONValue.object(["kind": .string("release"), "releaseId": .string(releaseId.uuidString.lowercased())]).encode(to: encoder)
        case .track(let releaseId, let trackId):
            try JSONValue.object([
                "kind": .string("track"),
                "releaseId": .string(releaseId.uuidString.lowercased()),
                "trackId": .string(trackId.uuidString.lowercased()),
            ]).encode(to: encoder)
        case .unknown(let value):
            try value.encode(to: encoder)
        }
    }

    /// The release this item names, for the kinds this build knows.
    var releaseId: UUID? {
        switch self {
        case .release(let id): id
        case .track(let id, _): id
        case .unknown: nil
        }
    }
}

/// A named mixtape of releases and tracks (`docs/plans/339-collections.md`). The cover is not stored.
/// (Named so it can't shadow Swift's `Collection` protocol.)
struct MusicCollection: Identifiable, Hashable {
    static let maxItems = 1000
    static let nameLimit = 100

    var id: UUID
    var name: String
    var items: [CollectionItem]
    var origin: String
    var originDevice: String
    var createdAt: Date
    var updatedAt: Date

    /// `raw` trimmed, or `nil` when it is empty, over 100 characters, or holds a control character.
    static func validName(_ raw: String) -> String? {
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= nameLimit else { return nil }
        guard !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return nil }
        return name
    }
}

/// A collection on the wire (`spec/sync.md`): the record, plus `version` and `serverUpdatedAt` on a pull.
/// Decoding is strict about the known item kinds, so `SyncCollectionPageElement` drops a record whose
/// known item is malformed rather than failing the page.
struct SyncCollection: Codable, Equatable {
    var syncVersion = 1
    var id: String
    var name: String
    var items: [CollectionItem]
    var origin: String
    var originDevice: String
    var createdAt: Date
    var updatedAt: Date
    var deleted: Bool
    var version: Int?
    var serverUpdatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case syncVersion, id, name, items, origin, originDevice, createdAt, updatedAt, deleted, version, serverUpdatedAt
    }

    init(id: String, name: String, items: [CollectionItem], origin: String, originDevice: String, createdAt: Date, updatedAt: Date, deleted: Bool = false, version: Int? = nil, serverUpdatedAt: Date? = nil) {
        self.id = id
        self.name = name
        self.items = items
        self.origin = origin
        self.originDevice = originDevice
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deleted = deleted
        self.version = version
        self.serverUpdatedAt = serverUpdatedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        syncVersion = try c.decode(Int.self, forKey: .syncVersion)
        let rawId = try c.decode(String.self, forKey: .id)
        guard UUID(uuidString: rawId) != nil else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "Expected a UUID.")
        }
        id = rawId
        name = try c.decode(String.self, forKey: .name)
        items = try c.decode([CollectionItem].self, forKey: .items)
        origin = try c.decode(String.self, forKey: .origin)
        originDevice = try c.decode(String.self, forKey: .originDevice)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        updatedAt = try c.decode(Date.self, forKey: .updatedAt)
        deleted = try c.decode(Bool.self, forKey: .deleted)
        version = try c.decodeIfPresent(Int.self, forKey: .version)
        serverUpdatedAt = try c.decodeIfPresent(Date.self, forKey: .serverUpdatedAt)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(1, forKey: .syncVersion)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encode(items, forKey: .items)
        try c.encode(origin, forKey: .origin)
        try c.encode(originDevice, forKey: .originDevice)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encode(updatedAt, forKey: .updatedAt)
        try c.encode(deleted, forKey: .deleted)
        try c.encodeIfPresent(version, forKey: .version)
        try c.encodeIfPresent(serverUpdatedAt, forKey: .serverUpdatedAt)
    }

    /// The wire form of `collection`: the id in lower case, as the API stores it.
    init(_ collection: MusicCollection, deleted: Bool = false) {
        self.init(
            id: collection.id.uuidString.lowercased(), name: collection.name, items: collection.items,
            origin: collection.origin, originDevice: collection.originDevice,
            createdAt: collection.createdAt, updatedAt: collection.updatedAt, deleted: deleted
        )
    }

    var collection: MusicCollection? {
        guard let uuid = UUID(uuidString: id) else { return nil }
        return MusicCollection(id: uuid, name: name, items: items, origin: origin, originDevice: originDevice, createdAt: createdAt, updatedAt: updatedAt)
    }
}

/// One element of a `GET /v1/collections` page: `nil` when the record is malformed (a bad known item), so
/// one bad record never fails the page.
struct SyncCollectionPageElement: Decodable {
    let collection: SyncCollection?

    init(from decoder: Decoder) throws {
        collection = try? SyncCollection(from: decoder)
    }
}

struct SyncCollectionsPage: Equatable {
    var collections: [SyncCollection]
    var nextVersion: Int
    var hasMore: Bool
}

/// The reply to `PUT /v1/collections/:id`: `pruned > 0` means the server dropped items naming deleted
/// releases, so the phone pulls that collection back rather than keep its own copy.
struct SyncCollectionPutResult: Equatable {
    var version: Int
    var pruned: Int
}

/// What a collection plays, from its items and the releases this phone knows. Pure.
enum CollectionQueue {
    /// One track a collection would play, in play order.
    struct Row: Identifiable, Equatable {
        /// Stable: the item's position plus the track, since a track may appear twice (as a release's
        /// track and as its own item).
        var id: String { "\(itemIndex)-\(trackID.uuidString)" }
        var itemIndex: Int
        var releaseID: UUID
        var trackID: UUID
        var title: String
        var artist: String
        var durationSec: Double?
        /// False for a release this phone has no files for (an adopted, details-only one): shown dimmed
        /// with the devices line and skipped when playing.
        var isHeld: Bool
    }

    /// Every row the collection shows. A release item becomes its tracks (disc, then track number), a
    /// track item itself. Items that don't resolve (release unknown, track gone) and items of a kind this
    /// build doesn't know give no row.
    static func rows(_ items: [CollectionItem], releases: [UUID: Release]) -> [Row] {
        var rows: [Row] = []
        for (index, item) in items.enumerated() {
            switch item {
            case .release(let releaseId):
                guard let release = releases[releaseId] else { continue }
                for track in playOrder(release.tracks) { rows.append(row(index, release, track)) }
            case .track(let releaseId, let trackId):
                guard let release = releases[releaseId], let track = release.tracks.first(where: { $0.id == trackId }) else { continue }
                rows.append(row(index, release, track))
            case .unknown:
                continue
            }
        }
        return rows
    }

    /// What Play would queue: the rows this phone holds.
    static func items(_ items: [CollectionItem], releases: [UUID: Release]) -> [(releaseID: UUID, trackID: UUID)] {
        rows(items, releases: releases).filter(\.isHeld).map { (releaseID: $0.releaseID, trackID: $0.trackID) }
    }

    /// What the "Make it a playlist" guide lists (#353): the titles this phone holds, in the collection's order (a
    /// release expands disc then track, a repeated track stays), and how many tracks it has to leave out.
    static func playlistGuide(_ items: [CollectionItem], releases: [UUID: Release]) -> (titles: [String], leftOut: Int) {
        let all = rows(items, releases: releases)
        return (all.filter(\.isHeld).map(\.title), all.filter { !$0.isHeld }.count)
    }

    static func playOrder(_ tracks: [Track]) -> [Track] {
        tracks.sorted {
            ($0.discNumber ?? 1, $0.trackNumber) < ($1.discNumber ?? 1, $1.trackNumber)
        }
    }

    private static func row(_ index: Int, _ release: Release, _ track: Track) -> Row {
        Row(itemIndex: index, releaseID: release.id, trackID: track.id, title: track.title, artist: release.artist, durationSec: track.durationSec, isHeld: !release.isAdopted)
    }
}

/// Editing a collection's items. Pure, so the list's `onMove`, its VoiceOver actions and the tests share it.
/// The edit list shows only items that resolve; the others (an unknown kind, a deleted release) keep their
/// slots and are re-pushed as they came.
enum CollectionEdit {
    /// Positions in `items` of the entries the edit list shows: release and track items whose release is known
    /// (and, for a track, still has it).
    static func visible(_ items: [CollectionItem], releases: [UUID: Release]) -> [Int] {
        items.indices.filter { index in
            switch items[index] {
            case .release(let id): releases[id] != nil
            case .track(let id, let trackId): releases[id]?.tracks.contains(where: { $0.id == trackId }) ?? false
            case .unknown: false
            }
        }
    }

    /// `items` with the visible entries at `source` moved to `destination` (SwiftUI's `onMove` offsets, within
    /// the visible list). Hidden entries stay where they were.
    static func moved(_ items: [CollectionItem], visible: [Int], from source: IndexSet, to destination: Int) -> [CollectionItem] {
        var shown = visible.map { items[$0] }
        let moving = source.sorted().map { shown[$0] }
        let before = source.filter { $0 < destination }.count
        for index in source.sorted(by: >) { shown.remove(at: index) }
        shown.insert(contentsOf: moving, at: max(0, min(shown.count, destination - before)))
        var result = items
        for (slot, item) in zip(visible, shown) { result[slot] = item }
        return result
    }

    /// Moves the visible entry at `position` one place up (`-1`) or down (`+1`); unchanged at the ends.
    static func moved(_ items: [CollectionItem], visible: [Int], position: Int, by step: Int) -> [CollectionItem] {
        let target = position + step
        guard visible.indices.contains(position), visible.indices.contains(target) else { return items }
        return moved(items, visible: visible, from: [position], to: step > 0 ? target + 1 : target)
    }

    /// `items` without the visible entry at `position`.
    static func removed(_ items: [CollectionItem], visible: [Int], position: Int) -> [CollectionItem] {
        guard visible.indices.contains(position) else { return items }
        var result = items
        result.remove(at: visible[position])
        return result
    }

    /// `items` with `new` added at the end, skipping any already there (the same release or track item
    /// appears at most once) and stopping at 1,000. `added` is how many went in.
    static func appended(_ items: [CollectionItem], _ new: [CollectionItem]) -> (items: [CollectionItem], added: Int) {
        var result = items
        var added = 0
        for item in new where !result.contains(item) && result.count < MusicCollection.maxItems {
            result.append(item)
            added += 1
        }
        return (result, added)
    }
}
