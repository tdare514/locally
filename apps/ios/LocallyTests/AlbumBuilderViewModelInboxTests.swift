import Foundation
import Testing
@testable import Locally

/// `AlbumBuilderViewModel.addFiles(fromInbox:)`: seeding an album from files
/// shared in from other apps should create the same prefilled rows as
/// picking files, and remove each one from the inbox as it's staged.
struct AlbumBuilderViewModelInboxTests {
    private func makeAudioFile(named name: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try Data([0xFF, 0xFB, 1, 2, 3, 4]).write(to: url)
        return url
    }

    private func makeCoordinator() -> ReleaseCoordinator {
        let folderDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        return ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: FakeTagWriter(),
            id3TagWriter: FakeTagWriter(),
            folder: FakeSpotifyFolder(directory: folderDir),
            library: InMemoryLibraryStore(),
            coverStore: FakeCoverStore()
        )
    }

    @Test func addFilesFromInboxCreatesRowsPrefilledFromTagsAndRemovesEachFromTheInbox() async throws {
        let firstURL = try makeAudioFile(named: "one.mp3")
        let secondURL = try makeAudioFile(named: "two.mp3")
        let importer = FakeFileImporter()
        importer.tagsByURL[firstURL] = TagSet(title: "One", artist: "A", album: "Al")
        let firstFile = InboxFile(url: firstURL, originalName: "one.mp3", createdAt: Date())
        let secondFile = InboxFile(url: secondURL, originalName: "two.mp3", createdAt: Date())
        let inbox = FakeInboxStore(files: [firstFile, secondFile])

        let model = AlbumBuilderViewModel(importer: importer, coordinator: makeCoordinator(), inbox: inbox)
        await model.addFiles(fromInbox: [firstFile, secondFile])

        #expect(model.rows.map(\.title) == ["One", "two"])
        #expect(inbox.files.isEmpty)
        #expect(Set(inbox.removed.map(\.url)) == Set([firstURL, secondURL]))
    }

    /// The inbox originals are deleted once staged, so the album send must
    /// work from the staged copies the rows keep.
    @Test func sendSucceedsAfterTheInboxOriginalsAreGone() async throws {
        let firstURL = try makeAudioFile(named: "one.mp3")
        let secondURL = try makeAudioFile(named: "two.mp3")
        let firstFile = InboxFile(url: firstURL, originalName: "one.mp3", createdAt: Date())
        let secondFile = InboxFile(url: secondURL, originalName: "two.mp3", createdAt: Date())
        let inbox = FakeInboxStore(files: [firstFile, secondFile])
        let model = AlbumBuilderViewModel(importer: FakeFileImporter(), coordinator: makeCoordinator(), inbox: inbox)

        await model.addFiles(fromInbox: [firstFile, secondFile])
        try FileManager.default.removeItem(at: firstURL)
        try FileManager.default.removeItem(at: secondURL)
        model.albumTitle = "Album"
        model.artist = "Someone"
        await model.send()

        #expect(model.errorMessage == nil)
        #expect(model.completedRelease?.tracks.count == 2)
    }
}
