import Foundation
import Testing
@testable import Locally

/// Switching Single / Album on the record keeps the draft (#205): the fields and the cover carry
/// over, the first track survives a drop to a single, and the source is cleared without touching
/// its share queue.
struct ImportKindSwitchTests {
    private func makeCoordinator() -> ReleaseCoordinator {
        let folderDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        return ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: FakeTagWriter(),
            id3TagWriter: FakeTagWriter(),
            folder: FakeSpotifyFolder(directory: folderDir),
            library: InMemoryLibraryStore(),
            coverStore: FakeCoverStore(),
            durationReader: FakeDurationReader()
        )
    }

    private func makeModels() -> (ImportSingleViewModel, AlbumBuilderViewModel) {
        (
            ImportSingleViewModel(importer: FakeFileImporter(), coordinator: makeCoordinator()),
            AlbumBuilderViewModel(importer: FakeFileImporter(), coordinator: makeCoordinator())
        )
    }

    private let cover = Data([1, 2, 3])
    private let fileA = URL(fileURLWithPath: "/tmp/a.mp3")
    private let fileB = URL(fileURLWithPath: "/tmp/b.mp3")
    private let fileC = URL(fileURLWithPath: "/tmp/c.mp3")

    @Test func singleToAlbumMakesTheFileTheOneRowAndCarriesTheFields() {
        let (single, album) = makeModels()
        single.pickedURL = fileA
        single.pickedName = "a.mp3"
        single.title = "Song"
        single.artist = "Artist"
        single.releaseDateText = "2026"
        single.genre = "Pop"
        single.coverData = cover

        ImportKindSwitch.singleToAlbum(single, into: album)

        #expect(album.rows.map(\.url) == [fileA])
        #expect(album.rows.map(\.title) == ["Song"])
        #expect(album.albumTitle == "Song")
        #expect(album.artist == "Artist")
        #expect(album.releaseDateText == "2026")
        #expect(album.genre == "Pop")
        #expect(album.coverData == cover)
        // The single is cleared.
        #expect(single.pickedURL == nil)
        #expect(single.title.isEmpty)
        #expect(single.coverData == nil)
    }

    @Test func singleToAlbumUsesTheTitleWhenTheAlbumIsEmpty() {
        let (single, album) = makeModels()
        single.pickedURL = fileA
        single.title = "Song"

        ImportKindSwitch.singleToAlbum(single, into: album)

        #expect(album.albumTitle == "Song")
    }

    @Test func singleToAlbumOfAnEmptyDraftLeavesAnEmptyAlbum() {
        let (single, album) = makeModels()

        ImportKindSwitch.singleToAlbum(single, into: album)

        #expect(album.rows.isEmpty)
        #expect(album.albumTitle.isEmpty)
        #expect(album.coverData == nil)
    }

    @Test func albumToSingleKeepsTheFirstRowAndDropsTheOthers() {
        let (single, album) = makeModels()
        album.rows = [
            AlbumBuilderViewModel.TrackRow(url: fileA, title: "One"),
            AlbumBuilderViewModel.TrackRow(url: fileB, title: "Two"),
            AlbumBuilderViewModel.TrackRow(url: fileC, title: "Three"),
        ]
        album.albumTitle = "The Album"
        album.artist = "Artist"
        album.releaseDateText = "2026"
        album.genre = "Pop"
        album.coverData = cover

        ImportKindSwitch.albumToSingle(album, into: single)

        #expect(single.pickedURL == fileA)
        #expect(single.pickedName == "a.mp3")
        #expect(single.title == "One")
        #expect(single.artist == "Artist")
        #expect(single.releaseDateText == "2026")
        #expect(single.genre == "Pop")
        #expect(single.coverData == cover)
        // The album is cleared, so the dropped rows are gone from it too.
        #expect(album.rows.isEmpty)
        #expect(album.albumTitle.isEmpty)
        #expect(album.coverData == nil)
    }

    @Test func albumToSingleOfAnAlbumWithNoRowsKeepsTheFieldsAndNoFile() {
        let (single, album) = makeModels()
        album.albumTitle = "The Album"
        album.artist = "Artist"

        ImportKindSwitch.albumToSingle(album, into: single)

        #expect(single.pickedURL == nil)
        #expect(single.title.isEmpty)
        #expect(single.artist == "Artist")
    }

    @Test func albumToSingleOfAnEmptyDraftIsEmpty() {
        let (single, album) = makeModels()

        ImportKindSwitch.albumToSingle(album, into: single)

        #expect(single.pickedURL == nil)
        #expect(single.coverData == nil)
    }

    @Test func clearingTheSingleLeavesItsShareQueueAlone() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var files: [InboxFile] = []
        for name in ["first.mp3", "second.mp3"] {
            let url = dir.appendingPathComponent(name)
            try Data([0xFF, 0xFB, 1, 2]).write(to: url)
            files.append(InboxFile(url: url, originalName: name, createdAt: Date()))
        }
        let (single, album) = makeModels()
        await single.startInboxQueue(files)
        #expect(single.pendingInboxQueue.count == 1)

        ImportKindSwitch.singleToAlbum(single, into: album)

        #expect(single.pendingInboxQueue.map(\.originalName) == ["second.mp3"])
        #expect(single.pickedURL == nil)
        #expect(album.rows.count == 1)
    }
}
