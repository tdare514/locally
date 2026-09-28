import Foundation
import SwiftData

/// The on-device index of releases the user has sent to Spotify. Kept as a
/// protocol over plain `Release`/`Track` structs so the SwiftData schema
/// (`ReleaseRecord`) never leaks into domain logic or tests.
protocol LibraryStore {
    func all() throws -> [Release]
    func upsert(_ release: Release) throws
    func delete(id: UUID) throws
    /// Writes `release` only if a row with its id is still in the index, and
    /// says whether it was. `SyncEngine` uses this, not `upsert`, once a push
    /// or accept has finished: a release the user deleted while that push
    /// was in flight must not be re-inserted behind the delete, leaving an
    /// index row whose files are gone (#19). The default is a read-then-write
    /// for the in-memory fake; `SwiftDataLibraryStore` does it atomically.
    @discardableResult
    func updateIfPresent(_ release: Release) throws -> Bool
}

extension LibraryStore {
    @discardableResult
    func updateIfPresent(_ release: Release) throws -> Bool {
        guard try all().contains(where: { $0.id == release.id }) else { return false }
        try upsert(release)
        return true
    }
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
    /// JSON-encoded `Release.uploadedFileNames`; `nil` for rows written
    /// before it existed, read back as empty.
    var uploadedFileNamesData: Data?

    init(id: UUID, kindRaw: String, title: String, artist: String, year: String?, genre: String?, coverPath: String?, folderPath: String, tracksData: Data, createdAt: Date, updatedAt: Date, syncedUpdatedAt: Date? = nil, uploadedFileNamesData: Data? = nil) {
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
        self.uploadedFileNamesData = uploadedFileNamesData
    }
}

/// Production `LibraryStore`, backed by the container's `mainContext`.
///
/// `ModelContext` is not thread-safe, and `mainContext` belongs to the main
/// actor. Its callers, though, are non-isolated async code
/// (`ReleaseCoordinator`, `SyncEngine`) that runs on the cooperative thread
/// pool after its first `await`, so a reconcile-loop fetch could run on one
/// thread while a delete saved on another, which asserts inside SwiftData
/// (#19). Every operation here therefore runs on the main thread: inline
/// when already there, otherwise through a synchronous hop. That serialises
/// every read and write on the one thread the context expects, so the loop
/// and a user action can no longer touch it at the same time.
final class SwiftDataLibraryStore: LibraryStore {
    private let context: ModelContext

    init(context: ModelContext) {
        self.context = context
    }

    func all() throws -> [Release] {
        try onMain {
            let records = try context.fetch(FetchDescriptor<ReleaseRecord>())
            return records.compactMap(Self.toRelease)
        }
    }

    func upsert(_ release: Release) throws {
        _ = try onMain { try write(release, insertIfMissing: true) }
    }

    @discardableResult
    func updateIfPresent(_ release: Release) throws -> Bool {
        try onMain { try write(release, insertIfMissing: false) }
    }

    func delete(id: UUID) throws {
        try onMain {
            let predicate = #Predicate<ReleaseRecord> { $0.id == id }
            if let existing = try context.fetch(FetchDescriptor(predicate: predicate)).first {
                context.delete(existing)
                try context.save()
            }
        }
    }

    /// Runs `body` on the main thread. The main thread is never blocked
    /// waiting on a cooperative-pool thread (async callers suspend at their
    /// `await` instead), so the synchronous hop cannot deadlock; the
    /// `isMainThread` check covers callers already there, where `sync` would.
    private func onMain<T>(_ body: () throws -> T) rethrows -> T {
        if Thread.isMainThread { return try body() }
        return try DispatchQueue.main.sync(execute: body)
    }

    /// Fetch-and-write in one main-thread turn, so "is it still there?" and
    /// the write can't be split by a delete from another caller.
    @discardableResult
    private func write(_ release: Release, insertIfMissing: Bool) throws -> Bool {
        let predicate = #Predicate<ReleaseRecord> { $0.id == release.id }
        let existing = try context.fetch(FetchDescriptor(predicate: predicate)).first

        let tracksData = try JSONEncoder().encode(release.tracks)
        let uploadedFileNamesData = try JSONEncoder().encode(release.uploadedFileNames)

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
            existing.uploadedFileNamesData = uploadedFileNamesData
        } else {
            guard insertIfMissing else { return false }
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
                syncedUpdatedAt: release.syncedUpdatedAt,
                uploadedFileNamesData: uploadedFileNamesData
            )
            context.insert(record)
        }

        try context.save()
        return true
    }

    private static func toRelease(_ record: ReleaseRecord) -> Release? {
        guard let kind = ReleaseKind(rawValue: record.kindRaw),
              let tracks = try? JSONDecoder().decode([Track].self, from: record.tracksData) else {
            return nil
        }
        let uploadedFileNames: [String] = record.uploadedFileNamesData.flatMap {
            try? JSONDecoder().decode([String].self, from: $0)
        } ?? []
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
            syncedUpdatedAt: record.syncedUpdatedAt,
            uploadedFileNames: uploadedFileNames
        )
    }
}
