import Foundation
import Testing
@testable import Locally

struct ReleaseCoordinatorDeleteTests {
    private func makeSourceFile(named name: String, in dir: URL? = nil) throws -> URL {
        let parent = dir ?? FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        let url = parent.appendingPathComponent(name)
        try Data([0xFF, 0xFB, 1, 2, 3, 4]).write(to: url)
        return url
    }

    private func makeFolder() -> FakeSpotifyFolder {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        return FakeSpotifyFolder(directory: dir)
    }

    private func makeCoordinator(folder: FakeSpotifyFolder, library: LibraryStore) -> ReleaseCoordinator {
        let tagWriter = FakeTagWriter()
        return ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: folder,
            library: library,
            coverStore: FakeCoverStore()
        )
    }

    @Test func deleteRemovesEveryTrackFileAndTheStoreEntry() async throws {
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        let coordinator = makeCoordinator(folder: folder, library: library)

        let files = try [makeSourceFile(named: "one.mp3"), makeSourceFile(named: "two.mp3")]
        let album = AlbumDraft(title: "Album", artist: "Artist", tracks: [TrackDraft(title: "One"), TrackDraft(title: "Two")])
        let release = try await coordinator.importAlbum(files: files, album: album, cover: nil)

        let paths = release.tracks.map(\.filePath)
        for path in paths {
            #expect(FileManager.default.fileExists(atPath: path))
        }

        try await coordinator.deleteRelease(release.id)

        for path in paths {
            #expect(!FileManager.default.fileExists(atPath: path))
        }
        #expect(try library.all().isEmpty)
    }

    @Test func deleteToleratesAnAlreadyMissingFile() async throws {
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        let coordinator = makeCoordinator(folder: folder, library: library)

        let files = try [makeSourceFile(named: "one.mp3")]
        let album = AlbumDraft(title: "Album", artist: "Artist", tracks: [TrackDraft(title: "One")])
        let release = try await coordinator.importAlbum(files: files, album: album, cover: nil)
        try FileManager.default.removeItem(atPath: release.tracks[0].filePath)

        try await coordinator.deleteRelease(release.id)

        #expect(try library.all().isEmpty)
    }

    @Test func refusesATrackPathOutsideTheFolderAndDeletesNothing() async throws {
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        let coordinator = makeCoordinator(folder: folder, library: library)

        let insideURL = folder.directory.appendingPathComponent("inside.mp3")
        try Data([1, 2, 3]).write(to: insideURL)

        let outsideDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: outsideDir, withIntermediateDirectories: true)
        let outsideURL = try makeSourceFile(named: "outside.mp3", in: outsideDir)

        let releaseId = UUID()
        let release = Release(
            id: releaseId,
            kind: .album,
            title: "Tampered",
            artist: "Artist",
            folderPath: folder.directory.path,
            tracks: [
                Track(title: "Inside", trackNumber: 1, filePath: insideURL.path, originalName: "inside.mp3"),
                Track(title: "Outside", trackNumber: 2, filePath: outsideURL.path, originalName: "outside.mp3")
            ]
        )
        try library.upsert(release)

        await #expect(throws: LocallyError.self) {
            try await coordinator.deleteRelease(releaseId)
        }

        #expect(FileManager.default.fileExists(atPath: insideURL.path))
        #expect(FileManager.default.fileExists(atPath: outsideURL.path))
        #expect(try library.all().count == 1)
    }

    /// Spotify's container path changes when Spotify is reinstalled. A release
    /// whose stored absolute paths point at the old container must still be
    /// deletable by file name inside the currently connected folder.
    @Test func deleteFindsFilesByNameWhenTheStoredContainerPathIsStale() async throws {
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        let coordinator = makeCoordinator(folder: folder, library: library)

        let files = try [makeSourceFile(named: "one.mp3")]
        let album = AlbumDraft(title: "Album", artist: "Artist", tracks: [TrackDraft(title: "One")])
        let release = try await coordinator.importAlbum(files: files, album: album, cover: nil)
        let liveName = (release.tracks[0].filePath as NSString).lastPathComponent
        let livePath = folder.directory.appendingPathComponent(liveName).path
        #expect(FileManager.default.fileExists(atPath: livePath))

        // Rewrite the index entry as if the folder had moved containers.
        var stale = release
        stale.tracks[0].filePath = "/private/var/old-container/Documents/" + liveName
        try library.upsert(stale)

        try await coordinator.deleteRelease(release.id)

        #expect(!FileManager.default.fileExists(atPath: livePath))
        #expect(try library.all().isEmpty)
    }
}
