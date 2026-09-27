import Foundation

/// Persists a release's cover image for the library thumbnail, keyed by the
/// release's id. Kept separate from the tracks themselves — cover bytes are
/// re-embedded into each track file by a `TagWriter`, but the library list
/// needs a copy it can read without going through `SpotifyFolderAccess`.
protocol CoverStore {
    /// Saves `data` for `id`, replacing any previous cover for that id, and
    /// returns the path it was saved to (for `Release.coverPath`).
    func save(_ data: Data, for id: UUID) throws -> String
    func load(_ id: UUID) -> Data?
    func delete(_ id: UUID) throws
}

/// Production `CoverStore`: one file per release under the app's own
/// Application Support directory, named `<id>.jpg` or `<id>.png` depending
/// on the image's magic bytes (never trusting a filename that may not
/// exist). Never touches the Spotify folder.
final class FileCoverStore: CoverStore {
    private static let extensions = ["jpg", "png"]

    private let directory: URL

    init(directory: URL = FileCoverStore.defaultDirectory()) {
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    static func defaultDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("Covers", isDirectory: true)
    }

    func save(_ data: Data, for id: UUID) throws -> String {
        try? delete(id)
        let url = directory.appendingPathComponent("\(id.uuidString).\(Self.fileExtension(for: data))")
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            throw LocallyError.libraryFailed(error.localizedDescription)
        }
        return url.path
    }

    func load(_ id: UUID) -> Data? {
        for ext in Self.extensions {
            let url = directory.appendingPathComponent("\(id.uuidString).\(ext)")
            if let data = try? Data(contentsOf: url) {
                return data
            }
        }
        return nil
    }

    func delete(_ id: UUID) throws {
        for ext in Self.extensions {
            let url = directory.appendingPathComponent("\(id.uuidString).\(ext)")
            if FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.removeItem(at: url)
            }
        }
    }

    /// Sniffs the image's leading bytes: PNG's signature starts `0x89 0x50`,
    /// anything else is treated as JPEG (the only other format `CoverPicker`
    /// and the tag writers produce).
    static func fileExtension(for data: Data) -> String {
        if data.count >= 2, data[data.startIndex] == 0x89, data[data.startIndex + 1] == 0x50 {
            return "png"
        }
        return "jpg"
    }
}
