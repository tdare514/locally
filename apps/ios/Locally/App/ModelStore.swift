import Foundation
import SwiftData

/// Opens the SwiftData store that holds the library index (`ReleaseRecord`)
/// and the sync outbox (`SyncOutboxRecord`), and moves it aside when it
/// can't be opened. Nothing here ever deletes the store: the index has no
/// rebuild-from-disk path, so a backup is the user's only way back.
enum ModelStore {
    /// Where SwiftData keeps the store by default.
    static var defaultURL: URL { ModelConfiguration().url }

    /// Opens the store at `url`, or an in-memory one when `url` is `nil`.
    static func open(at url: URL?) throws -> ModelContainer {
        let configuration = url.map { ModelConfiguration(url: $0) } ?? ModelConfiguration(isStoredInMemoryOnly: true)
        return try ModelContainer(for: ReleaseRecord.self, SyncOutboxRecord.self, configurations: configuration)
    }

    /// Moves the store file and its `-shm` / `-wal` siblings (whichever
    /// exist) into a new timestamped folder next to it, and returns that
    /// folder. Files are moved, never deleted.
    @discardableResult
    static func moveAside(storeAt url: URL, fileManager: FileManager = .default, now: Date = Date()) throws -> URL {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let directory = url.deletingLastPathComponent()
        let backup = directory.appendingPathComponent("Locally-store-backup-\(formatter.string(from: now))", isDirectory: true)
        try fileManager.createDirectory(at: backup, withIntermediateDirectories: true)
        for suffix in ["", "-shm", "-wal"] {
            let source = directory.appendingPathComponent(url.lastPathComponent + suffix)
            guard fileManager.fileExists(atPath: source.path) else { continue }
            try fileManager.moveItem(at: source, to: backup.appendingPathComponent(source.lastPathComponent))
        }
        return backup
    }
}
