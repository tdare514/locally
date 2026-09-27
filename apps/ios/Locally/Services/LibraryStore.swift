import Foundation
import SwiftData

/// The on-device index of releases the user has sent to Spotify. Kept as a
/// protocol over plain `Release`/`Track` structs so the SwiftData schema
/// (`ReleaseRecord`) never leaks into domain logic or tests.
protocol LibraryStore {
    func all() throws -> [Release]
    func upsert(_ release: Release) throws
    func delete(id: UUID) throws
}

/// SwiftData-backed `@Model` mirroring `Release`. Tracks are stored as an
/// encoded JSON blob rather than child `@Model` objects, since they are
/// always read/written as a whole array and never queried independently.
@Model
final class ReleaseRecord {
    @Attribute(.unique) var id: UUID
    var kindRaw: String
    var title: String
    var artist: String
    var year: String?
    var genre: String?
    var coverPath: String?
    var folderPath: String
    var tracksData: Data
    var createdAt: Date
    var updatedAt: Date
    /// Mirrors `Release.syncedUpdatedAt`; `nil` until the first successful push.
    var syncedUpdatedAt: Date?

    init(id: UUID, kindRaw: String, title: String, artist: String, year: String?, genre: String?, coverPath: String?, folderPath: String, tracksData: Data, createdAt: Date, updatedAt: Date, syncedUpdatedAt: Date? = nil) {
        self.id = id
        self.kindRaw = kindRaw
        self.title = title
        self.artist = artist
        self.year = year
        self.genre = genre
        self.coverPath = coverPath
        self.folderPath = folderPath
        self.tracksData = tracksData
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.syncedUpdatedAt = syncedUpdatedAt
    }
}

/// Production `LibraryStore`, backed by a `ModelContext`.
final class SwiftDataLibraryStore: LibraryStore {
    private let context: ModelContext

    init(context: ModelContext) {
        self.context = context
    }

    func all() throws -> [Release] {
        let records = try context.fetch(FetchDescriptor<ReleaseRecord>())
        return records.compactMap(Self.toRelease)
    }

    func upsert(_ release: Release) throws {
        let predicate = #Predicate<ReleaseRecord> { $0.id == release.id }
        let existing = try context.fetch(FetchDescriptor(predicate: predicate)).first

        let tracksData = try JSONEncoder().encode(release.tracks)

        if let existing {
            existing.kindRaw = release.kind.rawValue
            existing.title = release.title
            existing.artist = release.artist
            existing.year = release.year
            existing.genre = release.genre
            existing.coverPath = release.coverPath
            existing.folderPath = release.folderPath
            existing.tracksData = tracksData
            existing.updatedAt = release.updatedAt
            existing.syncedUpdatedAt = release.syncedUpdatedAt
        } else {
            let record = ReleaseRecord(
                id: release.id,
                kindRaw: release.kind.rawValue,
                title: release.title,
                artist: release.artist,
                year: release.year,
                genre: release.genre,
                coverPath: release.coverPath,
                folderPath: release.folderPath,
                tracksData: tracksData,
                createdAt: release.createdAt,
                updatedAt: release.updatedAt,
                syncedUpdatedAt: release.syncedUpdatedAt
            )
            context.insert(record)
        }

        try context.save()
    }

    func delete(id: UUID) throws {
        let predicate = #Predicate<ReleaseRecord> { $0.id == id }
        if let existing = try context.fetch(FetchDescriptor(predicate: predicate)).first {
            context.delete(existing)
            try context.save()
        }
    }

    private static func toRelease(_ record: ReleaseRecord) -> Release? {
        guard let kind = ReleaseKind(rawValue: record.kindRaw),
              let tracks = try? JSONDecoder().decode([Track].self, from: record.tracksData) else {
            return nil
        }
        return Release(
            id: record.id,
            kind: kind,
            title: record.title,
            artist: record.artist,
            year: record.year,
            genre: record.genre,
            coverPath: record.coverPath,
            folderPath: record.folderPath,
            tracks: tracks,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            syncedUpdatedAt: record.syncedUpdatedAt
        )
    }
}
