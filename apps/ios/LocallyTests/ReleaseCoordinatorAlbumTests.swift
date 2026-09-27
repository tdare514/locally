import Foundation
import Testing
@testable import Locally

struct ReleaseCoordinatorAlbumTests {
    private func makeSourceFile(named name: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try Data([0xFF, 0xFB, 1, 2, 3, 4]).write(to: url)
        return url
    }

    private func makeFolder() -> FakeSpotifyFolder {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        return FakeSpotifyFolder(directory: dir)
    }

    private func makeAlbum(titles: [String], artist: String = "The Band", album: String = "Great Album") -> AlbumDraft {
        AlbumDraft(title: album, artist: artist, year: "2026", genre: "Rock", tracks: titles.map { TrackDraft(title: $0) })
    }

    @Test func importAlbumNumbersTracksByOrderAndSharesAlbumAndArtistTags() async throws {
        let files = try [
            makeSourceFile(named: "one.mp3"),
            makeSourceFile(named: "two.mp3"),
            makeSourceFile(named: "three.mp3")
        ]
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        let tagWriter = FakeTagWriter()

        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: folder,
            library: library,
            coverStore: FakeCoverStore()
        )

        let album = makeAlbum(titles: ["First", "Second", "Third"])
        let release = try await coordinator.importAlbum(files: files, album: album, cover: nil)

        #expect(release.kind == .album)
        #expect(release.tracks.count == 3)
        #expect(release.tracks.map(\.trackNumber) == [1, 2, 3])
        #expect(release.tracks.map(\.title) == ["First", "Second", "Third"])

        #expect(tagWriter.calls.count == 3)
        for call in tagWriter.calls {
            #expect(call.tags.album == "Great Album")
            #expect(call.tags.artist == "The Band")
            #expect(call.tags.albumArtist == "The Band")
            #expect(call.tags.totalTracks == 3)
        }
        #expect(tagWriter.calls.map(\.tags.trackNumber) == [1, 2, 3])

        let allReleases = try library.all()
        #expect(allReleases.count == 1)
        #expect(allReleases.first?.id == release.id)
    }

    @Test func importAlbumWritesEveryFileIntoTheFolderWithLayoutNames() async throws {
        let files = try [makeSourceFile(named: "a.mp3"), makeSourceFile(named: "b.mp3")]
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        let tagWriter = FakeTagWriter()

        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: folder,
            library: library,
            coverStore: FakeCoverStore()
        )

        let album = makeAlbum(titles: ["Alpha", "Beta"], artist: "Artist", album: "Album")
        _ = try await coordinator.importAlbum(files: files, album: album, cover: nil)

        let layout = ReleaseLayout()
        let firstName = layout.fileName(artist: "Artist", album: "Album", trackNumber: 1, title: "Alpha", ext: "mp3")
        let secondName = layout.fileName(artist: "Artist", album: "Album", trackNumber: 2, title: "Beta", ext: "mp3")

        #expect(FileManager.default.fileExists(atPath: folder.directory.appendingPathComponent(firstName).path))
        #expect(FileManager.default.fileExists(atPath: folder.directory.appendingPathComponent(secondName).path))

        let contents = try FileManager.default.contentsOfDirectory(atPath: folder.directory.path)
        #expect(contents.count == 2)
    }

    @Test func failureOnTrackTwoOfThreeLeavesFolderAndStoreEmpty() async throws {
        let files = try [
            makeSourceFile(named: "one.mp3"),
            makeSourceFile(named: "two.mp3"),
            makeSourceFile(named: "three.mp3")
        ]
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        let tagWriter = FakeTagWriter()
        tagWriter.errorToThrow = LocallyError.taggingFailed("boom")
        tagWriter.failOnCallNumber = 2

        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: folder,
            library: library,
            coverStore: FakeCoverStore()
        )

        let album = makeAlbum(titles: ["First", "Second", "Third"])

        await #expect(throws: Error.self) {
            _ = try await coordinator.importAlbum(files: files, album: album, cover: nil)
        }

        let contents = try FileManager.default.contentsOfDirectory(atPath: folder.directory.path)
        #expect(contents.isEmpty)
        #expect(try library.all().isEmpty)
        // The first track's write succeeded and was recorded before the second failed.
        #expect(tagWriter.calls.count == 1)
    }

    @Test func progressReportsEachTrackAsItLands() async throws {
        let files = try [makeSourceFile(named: "a.mp3"), makeSourceFile(named: "b.mp3")]
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        let tagWriter = FakeTagWriter()

        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: folder,
            library: library,
            coverStore: FakeCoverStore()
        )

        var updates: [(Int, Int)] = []
        let album = makeAlbum(titles: ["Alpha", "Beta"])
        _ = try await coordinator.importAlbum(files: files, album: album, cover: nil) { done, total in
            updates.append((done, total))
        }

        #expect(updates.map(\.0) == [1, 2])
        #expect(updates.map(\.1) == [2, 2])
    }
}
