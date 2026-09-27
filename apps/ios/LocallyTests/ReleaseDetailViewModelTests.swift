import Foundation
import Testing
@testable import Locally

/// The detail screen's "Title" is the only title a single has, so saving it
/// must reach the track tag Spotify displays, not just the album tag.
@MainActor
struct ReleaseDetailViewModelTests {
    private func makeSourceFile() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("song.mp3")
        try Data([0xFF, 0xFB, 1, 2, 3, 4]).write(to: url)
        return url
    }

    @Test func editingASinglesTitleRewritesTheTrackTitleTag() async throws {
        let folderDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let folder = FakeSpotifyFolder(directory: folderDir)
        let library = InMemoryLibraryStore()
        let tagWriter = FakeTagWriter()
        let coverStore = FakeCoverStore()
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: folder,
            library: library,
            coverStore: coverStore
        )
        let tags = TagSet(title: "Old Name", artist: "Artist", album: "Old Name", trackNumber: 1, totalTracks: 1)
        let release = try await coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)

        let model = ReleaseDetailViewModel(release: release, coordinator: coordinator, coverStore: coverStore)
        model.title = "New Name"
        await model.save()

        let last = try #require(tagWriter.calls.last)
        #expect(last.tags.title == "New Name")
        #expect(last.tags.album == "New Name")
        #expect(try library.all().first?.tracks.first?.title == "New Name")
    }
}
