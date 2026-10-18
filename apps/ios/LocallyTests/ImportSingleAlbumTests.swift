import Foundation
import Testing
@testable import Locally

/// #293: a single has no Album field. Its album tag is always the plain title, so the import
/// and every later save from the release page write the same value.
struct ImportSingleAlbumTests {
    private func makeAudioFile(named name: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try Data([0xFF, 0xFB, 1, 2, 3, 4]).write(to: url)
        return url
    }

    private func makeCoordinator(importer: FakeFileImporter, tagWriter: FakeTagWriter) -> ReleaseCoordinator {
        let folderDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        return ReleaseCoordinator(
            importer: importer,
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: FakeSpotifyFolder(directory: folderDir),
            library: InMemoryLibraryStore(),
            coverStore: FakeCoverStore(),
            durationReader: FakeDurationReader()
        )
    }

    @Test func existingAlbumTagIsIgnoredAndTheAlbumIsThePlainTitle() async throws {
        let url = try makeAudioFile(named: "song.mp3")
        let importer = FakeFileImporter()
        importer.tagsByURL[url] = TagSet(title: "Song (feat. B)", artist: "A", album: "Some Other Album")
        let model = ImportSingleViewModel(importer: importer, coordinator: makeCoordinator(importer: importer, tagWriter: FakeTagWriter()))
        await model.pick(url: url)

        let tags = model.tagSet()
        #expect(tags.album == "Song")
        #expect(tags.title == "Song (feat. B)")
    }

    @Test func importThenYearOnlySaveWriteTheSameAlbum() async throws {
        let url = try makeAudioFile(named: "song.mp3")
        let importer = FakeFileImporter()
        importer.tagsByURL[url] = TagSet(title: "Song", artist: "A", album: "Some Other Album")
        let tagWriter = FakeTagWriter()
        let coordinator = makeCoordinator(importer: importer, tagWriter: tagWriter)
        let model = ImportSingleViewModel(importer: importer, coordinator: coordinator)
        await model.pick(url: url)
        await model.send()

        let release = try #require(model.completedRelease)
        let importedAlbum = try #require(tagWriter.calls.last?.tags.album)
        #expect(importedAlbum == "Song")

        _ = try await coordinator.updateRelease(release.id, changes: ReleaseChanges(year: "2021"))
        let savedAlbum = try #require(tagWriter.calls.last?.tags.album)
        #expect(tagWriter.calls.count >= 2)
        #expect(savedAlbum == importedAlbum)
    }
}
