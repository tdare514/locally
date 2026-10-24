import Testing
import Foundation
@testable import Locally

/// The player's file access over a real temp folder (#336 with #335): a track kept in the `Locally/`
/// brand folder must resolve and pass the inside-the-folder check.
struct SpotifyPlaybackFileAccessTests {
    private struct TempFolder: SpotifyFolderAccess {
        let url: URL
        var isConnected: Bool { true }
        func connect(url: URL) throws {}
        func withAccess<T>(_ body: (URL) throws -> T) throws -> T { try body(url) }
        func withAccess<T>(_ body: (URL) async throws -> T) async throws -> T { try await body(url) }
        func disconnect() {}
    }

    private func makeFolder() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("PlaybackAccess-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir.appendingPathComponent(Brand.folderName, isDirectory: true), withIntermediateDirectories: true)
        return dir
    }

    private func track(path: String) -> Track {
        Track(title: "X", trackNumber: 1, filePath: path, originalName: "x.mp3")
    }

    @Test func aTrackStoredInTheBrandFolderResolvesAndPasses() async throws {
        let folder = try makeFolder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let file = folder.appendingPathComponent(Brand.folderName).appendingPathComponent("x.mp3")
        try Data([1]).write(to: file)
        let access = SpotifyPlaybackFileAccess(folder: TempFolder(url: folder))
        let resolved = try await access.withFile(for: track(path: file.path)) { $0 }
        #expect(resolved?.lastPathComponent == "x.mp3")
        #expect(resolved?.deletingLastPathComponent().lastPathComponent == Brand.folderName)
    }

    @Test func aBrandFolderTrackWhoseStoredPathMovedResolvesByStructure() async throws {
        let folder = try makeFolder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let file = folder.appendingPathComponent(Brand.folderName).appendingPathComponent("x.mp3")
        try Data([1]).write(to: file)
        // The container moved: the stored path no longer exists, but it names the brand folder.
        let stale = "/old/container/Spotify/\(Brand.folderName)/x.mp3"
        let access = SpotifyPlaybackFileAccess(folder: TempFolder(url: folder))
        let resolved = try await access.withFile(for: track(path: stale)) { $0 }
        #expect(resolved?.standardizedFileURL.path.hasSuffix("/\(Brand.folderName)/x.mp3") == true)
    }

    @Test func aMissingFileIsNilAndAPathOutsideTheFolderIsRefused() async throws {
        let folder = try makeFolder()
        let outside = FileManager.default.temporaryDirectory.appendingPathComponent("outside-\(UUID().uuidString).mp3")
        try Data([1]).write(to: outside)
        defer {
            try? FileManager.default.removeItem(at: folder)
            try? FileManager.default.removeItem(at: outside)
        }
        let access = SpotifyPlaybackFileAccess(folder: TempFolder(url: folder))
        let missing = try await access.withFile(for: track(path: folder.appendingPathComponent(Brand.folderName).appendingPathComponent("gone.mp3").path)) { $0 }
        #expect(missing == nil)
        let refused = try await access.withFile(for: track(path: outside.path)) { $0 }
        #expect(refused == nil)
    }
}
