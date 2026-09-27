import Foundation
@testable import Locally

/// Copies the staged file through untouched and reports the extension it
/// was given, so `ReleaseCoordinatorTests` can exercise the coordinator's
/// wiring without AVFoundation.
final class FakeTranscoder: Transcoder {
    func prepare(_ file: StagedFile) async throws -> PreparedFile {
        PreparedFile(url: file.url, ext: file.url.pathExtension.lowercased())
    }
}

/// Records every call it receives instead of touching the file, so tests
/// can assert on what tags/cover were passed, and can simulate a failure.
final class FakeTagWriter: TagWriter {
    struct Call {
        let tags: TagSet
        let cover: Data?
        let url: URL
    }

    private(set) var calls: [Call] = []
    var errorToThrow: Error?

    func write(_ tags: TagSet, cover: Data?, to url: URL) async throws {
        if let errorToThrow {
            throw errorToThrow
        }
        calls.append(Call(tags: tags, cover: cover, url: url))
    }
}

/// In-memory `LibraryStore` fake — no SwiftData, just a dictionary.
final class InMemoryLibraryStore: LibraryStore {
    private var storage: [UUID: Release] = [:]

    func all() throws -> [Release] {
        Array(storage.values)
    }

    func upsert(_ release: Release) throws {
        storage[release.id] = release
    }

    func delete(id: UUID) throws {
        storage.removeValue(forKey: id)
    }
}

/// `SpotifyFolderAccess` fake backed by a real temp directory, so
/// `withAccess` can actually move files on disk the way the production
/// bookmark-backed implementation does.
final class FakeSpotifyFolder: SpotifyFolderAccess {
    let directory: URL
    private(set) var connected: Bool

    init(directory: URL) {
        self.directory = directory
        self.connected = true
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    var isConnected: Bool { connected }

    func connect(url: URL) throws {
        connected = true
    }

    func withAccess<T>(_ body: (URL) throws -> T) throws -> T {
        guard connected else { throw LocallyError.folderNotConnected }
        return try body(directory)
    }

    func disconnect() {
        connected = false
    }
}

/// `FileImporter` fake that copies a fixed set of already-on-disk URLs into
/// a fresh tmp directory, mirroring the shape (but not the security scope)
/// of the production importer.
final class FakeFileImporter: FileImporter {
    func stage(_ urls: [URL]) async throws -> [StagedFile] {
        try urls.map { url in
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let dest = dir.appendingPathComponent(url.lastPathComponent)
            try FileManager.default.copyItem(at: url, to: dest)
            return StagedFile(url: dest, originalName: url.lastPathComponent, existingTags: nil)
        }
    }
}
