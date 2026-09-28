import Foundation
import Testing
@testable import Locally

/// On-device restructure checks (#6): long-press drag without Edit mode lands
/// in these ViewModel move helpers. Cover the album builder and the release
/// detail so a reorder on either screen updates order (and, on save, tags).
@MainActor
struct TrackReorderViewModelTests {
    private func makeAudioFile(named name: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try Data([0xFF, 0xFB, 1, 2, 3, 4]).write(to: url)
        return url
    }

    private func makeCoordinator(
        library: LibraryStore = InMemoryLibraryStore(),
        tagWriter: FakeTagWriter = FakeTagWriter(),
        coverStore: CoverStore = FakeCoverStore()
    ) -> (ReleaseCoordinator, FakeTagWriter, CoverStore) {
        let folderDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: FakeSpotifyFolder(directory: folderDir),
            library: library,
            coverStore: coverStore
        )
        return (coordinator, tagWriter, coverStore)
    }

    @Test func albumBuilderMoveRowsReordersTitlesForSend() async throws {
        let first = try makeAudioFile(named: "one.mp3")
        let second = try makeAudioFile(named: "two.mp3")
        let third = try makeAudioFile(named: "three.mp3")
        let importer = FakeFileImporter()
        importer.tagsByURL[first] = TagSet(title: "One", artist: "A", album: "Al")
        importer.tagsByURL[second] = TagSet(title: "Two", artist: "A", album: "Al")
        importer.tagsByURL[third] = TagSet(title: "Three", artist: "A", album: "Al")
        let (coordinator, _, _) = makeCoordinator()
        let model = AlbumBuilderViewModel(importer: importer, coordinator: coordinator)

        await model.addFiles([first, second, third])
        #expect(model.orderedTrackTitles == ["One", "Two", "Three"])

        // Lift the first row and drop it after the third (destination 3).
        model.moveRows(from: IndexSet(integer: 0), to: 3)
        #expect(model.orderedTrackTitles == ["Two", "Three", "One"])

        model.albumTitle = "Album"
        model.artist = "Someone"
        await model.send()

        #expect(model.errorMessage == nil)
        #expect(model.completedRelease?.tracks.map(\.title) == ["Two", "Three", "One"])
        #expect(model.completedRelease?.tracks.map(\.trackNumber) == [1, 2, 3])
    }

    @Test func releaseDetailMoveTracksEnablesSaveAndPersistsOrder() async throws {
        let (coordinator, tagWriter, coverStore) = makeCoordinator()
        let files = try [makeAudioFile(named: "a.mp3"), makeAudioFile(named: "b.mp3"), makeAudioFile(named: "c.mp3")]
        let album = AlbumDraft(
            title: "Album",
            artist: "Artist",
            tracks: [TrackDraft(title: "A"), TrackDraft(title: "B"), TrackDraft(title: "C")]
        )
        let release = try await coordinator.importAlbum(files: files, album: album, cover: nil)
        let model = ReleaseDetailViewModel(release: release, coordinator: coordinator, coverStore: coverStore)
        let originalOrder = model.trackRows.map(\.id)
        #expect(model.hasChanges == false)
        #expect(model.canSave == false)

        model.moveTracks(from: IndexSet(integer: 2), to: 0)
        #expect(model.trackRows.map(\.id) == [originalOrder[2], originalOrder[0], originalOrder[1]])
        #expect(model.hasChanges)
        #expect(model.canSave)

        let callsBefore = tagWriter.calls.count
        await model.save()
        #expect(model.errorMessage == nil)
        #expect(model.hasChanges == false)

        let updateCalls = Array(tagWriter.calls.suffix(from: callsBefore))
        #expect(updateCalls.map(\.tags.trackNumber) == [1, 2, 3])
        #expect(updateCalls.map(\.tags.title) == ["C", "A", "B"])
    }
}
