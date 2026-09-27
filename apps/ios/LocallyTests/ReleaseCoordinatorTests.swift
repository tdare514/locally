import Foundation
import Testing
@testable import Locally

struct ReleaseCoordinatorTests {
    private func makeSourceFile(named name: String = "song.mp3") throws -> URL {
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

    @Test func importSingleProducesLayoutNamedFileAndOneRelease() async throws {
        let source = try makeSourceFile()
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        let tagWriter = FakeTagWriter()

        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: folder,
            library: library
        )

        let tags = TagSet(title: "My Title", artist: "My Artist", album: "My Album", trackNumber: 1, totalTracks: 1)
        let release = try await coordinator.importSingle(file: source, tags: tags, cover: nil)

        let expectedName = ReleaseLayout().fileName(artist: "My Artist", album: "My Album", trackNumber: 1, title: "My Title", ext: "mp3")
        let expectedURL = folder.directory.appendingPathComponent(expectedName)
        #expect(FileManager.default.fileExists(atPath: expectedURL.path))

        let allReleases = try library.all()
        #expect(allReleases.count == 1)
        #expect(allReleases.first?.id == release.id)
        #expect(release.tracks.first?.filePath == expectedURL.path)

        #expect(tagWriter.calls.count == 1)
        #expect(tagWriter.calls.first?.tags.title == "My Title")
    }

    @Test func tagWriterFailureLeavesFolderAndStoreEmpty() async throws {
        let source = try makeSourceFile()
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        let tagWriter = FakeTagWriter()
        tagWriter.errorToThrow = LocallyError.taggingFailed("boom")

        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: folder,
            library: library
        )

        let tags = TagSet(title: "My Title", artist: "My Artist", album: "My Album")

        await #expect(throws: Error.self) {
            _ = try await coordinator.importSingle(file: source, tags: tags, cover: nil)
        }

        let contents = try FileManager.default.contentsOfDirectory(atPath: folder.directory.path)
        #expect(contents.isEmpty)
        #expect(try library.all().isEmpty)
    }

    @Test func m4aFilesUseTheM4ATagWriter() async throws {
        let source = try makeSourceFile(named: "song.m4a")
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        let m4aWriter = FakeTagWriter()
        let id3Writer = FakeTagWriter()

        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: m4aWriter,
            id3TagWriter: id3Writer,
            folder: folder,
            library: library
        )

        let tags = TagSet(title: "T", artist: "A", album: "Al")
        _ = try await coordinator.importSingle(file: source, tags: tags, cover: nil)

        #expect(m4aWriter.calls.count == 1)
        #expect(id3Writer.calls.isEmpty)
    }

    @Test func importingTheSameSongTwiceNeverOverwritesTheFirstFile() async throws {
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        let tagWriter = FakeTagWriter()
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: folder,
            library: library
        )
        let tags = TagSet(title: "Same", artist: "Dup", album: "Same", trackNumber: 1, totalTracks: 1)

        let first = try await coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)
        let second = try await coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)

        #expect(first.tracks[0].filePath != second.tracks[0].filePath)
        #expect(second.tracks[0].filePath.hasSuffix("Dup - Same - 01 - Same (2).mp3"))
        #expect(FileManager.default.fileExists(atPath: first.tracks[0].filePath))
        #expect(FileManager.default.fileExists(atPath: second.tracks[0].filePath))
        #expect(try library.all().count == 2)
    }
}
