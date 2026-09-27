import Foundation
import Testing
@testable import Locally

/// `ImportSingleViewModel`'s share-inbox queue: loading a file shared in
/// from another app should behave just like picking one, but also remove
/// it from the inbox once staged, and hand off to the next queued file
/// when the user moves on.
struct ImportSingleViewModelInboxTests {
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

    @Test func startingTheInboxQueueLoadsTheFirstFileAndRemovesItFromTheInbox() async throws {
        let url = try makeAudioFile(named: "shared.mp3")
        let importer = FakeFileImporter()
        importer.tagsByURL[url] = TagSet(title: "Shared Title", artist: "Shared Artist", album: "Shared Album")
        let inboxFile = InboxFile(url: url, originalName: "shared.mp3", createdAt: Date())
        let inbox = FakeInboxStore(files: [inboxFile])

        let model = ImportSingleViewModel(importer: importer, coordinator: makeCoordinator(), inbox: inbox)
        await model.startInboxQueue([inboxFile])

        // The form now points at the staged copy, not the inbox original.
        #expect(model.pickedURL != url)
        #expect(FileManager.default.fileExists(atPath: model.pickedURL?.path ?? ""))
        #expect(model.pickedName == "shared.mp3")
        #expect(model.title == "Shared Title")
        #expect(model.artist == "Shared Artist")
        #expect(inbox.removed.map(\.url) == [url])
        #expect(inbox.files.isEmpty)
    }

    /// The real inbox store deletes the original once staged, so Send has
    /// to work from the staged copy alone.
    @Test func sendSucceedsAfterTheInboxOriginalIsGone() async throws {
        let url = try makeAudioFile(named: "shared.mp3")
        let inboxFile = InboxFile(url: url, originalName: "shared.mp3", createdAt: Date())
        let inbox = FakeInboxStore(files: [inboxFile])
        let model = ImportSingleViewModel(importer: FakeFileImporter(), coordinator: makeCoordinator(), inbox: inbox)

        await model.startInboxQueue([inboxFile])
        try FileManager.default.removeItem(at: url)
        model.artist = "Someone"
        await model.send()

        #expect(model.errorMessage == nil)
        #expect(model.completedRelease != nil)
    }

    @Test func startingTheInboxQueueWithSeveralFilesKeepsTheRestPending() async throws {
        let firstURL = try makeAudioFile(named: "first.mp3")
        let secondURL = try makeAudioFile(named: "second.mp3")
        let firstFile = InboxFile(url: firstURL, originalName: "first.mp3", createdAt: Date())
        let secondFile = InboxFile(url: secondURL, originalName: "second.mp3", createdAt: Date())
        let inbox = FakeInboxStore(files: [firstFile, secondFile])

        let model = ImportSingleViewModel(importer: FakeFileImporter(), coordinator: makeCoordinator(), inbox: inbox)
        await model.startInboxQueue([firstFile, secondFile])

        #expect(model.pickedName == "first.mp3")
        #expect(model.pendingInboxQueue.map(\.url) == [secondURL])
        // Only the file actually staged so far is removed from the inbox.
        #expect(inbox.removed.map(\.url) == [firstURL])
        #expect(inbox.files.map(\.url) == [secondURL])
    }

    @Test func resetImmediatelyPopsTheNextQueuedFileFromThePendingQueue() async throws {
        let firstURL = try makeAudioFile(named: "first.mp3")
        let secondURL = try makeAudioFile(named: "second.mp3")
        let firstFile = InboxFile(url: firstURL, originalName: "first.mp3", createdAt: Date())
        let secondFile = InboxFile(url: secondURL, originalName: "second.mp3", createdAt: Date())
        let inbox = FakeInboxStore(files: [firstFile, secondFile])

        let model = ImportSingleViewModel(importer: FakeFileImporter(), coordinator: makeCoordinator(), inbox: inbox)
        await model.startInboxQueue([firstFile, secondFile])
        #expect(model.pendingInboxQueue.map(\.url) == [secondURL])

        model.reset()

        #expect(model.pendingInboxQueue.isEmpty)
    }

    @Test func resetWithNoQueueJustClearsTheForm() async throws {
        let model = ImportSingleViewModel(importer: FakeFileImporter(), coordinator: makeCoordinator())
        await model.pick(url: try makeAudioFile(named: "song.mp3"))

        model.reset()

        #expect(model.pickedURL == nil)
        #expect(model.title.isEmpty)
    }
}
