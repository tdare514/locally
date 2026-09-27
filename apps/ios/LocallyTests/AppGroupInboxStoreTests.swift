import Foundation
import Testing
@testable import Locally

struct AppGroupInboxStoreTests {
    private func makeStore() -> (AppGroupInboxStore, URL) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return (AppGroupInboxStore(directory: dir), dir)
    }

    /// Writes a file named per `InboxFileNaming` and backdates its creation
    /// date so ordering tests don't depend on how fast the filesystem
    /// timestamps successive writes.
    private func writeInboxFile(named originalName: String, createdAt: Date, in dir: URL) throws -> URL {
        let name = InboxFileNaming.fileName(id: UUID(), originalName: originalName)
        let url = dir.appendingPathComponent(name)
        try Data([0, 1, 2, 3]).write(to: url)
        try FileManager.default.setAttributes([.creationDate: createdAt], ofItemAtPath: url.path)
        return url
    }

    @Test func pendingFilesListsAudioFilesOldestFirst() throws {
        let (store, dir) = makeStore()
        let now = Date()
        _ = try writeInboxFile(named: "second.mp3", createdAt: now, in: dir)
        _ = try writeInboxFile(named: "first.m4a", createdAt: now.addingTimeInterval(-60), in: dir)

        let files = store.pendingFiles()

        #expect(files.map(\.originalName) == ["first.m4a", "second.mp3"])
    }

    @Test func pendingFilesIgnoresNonAudioFiles() throws {
        let (store, dir) = makeStore()
        _ = try writeInboxFile(named: "song.mp3", createdAt: Date(), in: dir)
        _ = try writeInboxFile(named: "cover.jpg", createdAt: Date(), in: dir)

        let files = store.pendingFiles()

        #expect(files.map(\.originalName) == ["song.mp3"])
    }

    @Test func pendingFilesIgnoresHiddenFiles() throws {
        let (store, dir) = makeStore()
        _ = try writeInboxFile(named: "song.mp3", createdAt: Date(), in: dir)
        let hidden = dir.appendingPathComponent(".DS_Store")
        try Data([0]).write(to: hidden)

        let files = store.pendingFiles()

        #expect(files.map(\.originalName) == ["song.mp3"])
    }

    @Test func pendingFilesIgnoresNamesNotMatchingTheInboxScheme() throws {
        let (store, dir) = makeStore()
        try Data([0]).write(to: dir.appendingPathComponent("stray.mp3"))

        #expect(store.pendingFiles().isEmpty)
    }

    @Test func pendingFilesOnAMissingDirectoryReturnsEmpty() {
        let missing = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let store = AppGroupInboxStore(directory: missing)

        #expect(store.pendingFiles().isEmpty)
    }

    @Test func removeDeletesTheFileAndItNoLongerAppearsInPendingFiles() throws {
        let (store, dir) = makeStore()
        let url = try writeInboxFile(named: "song.mp3", createdAt: Date(), in: dir)
        let file = InboxFile(url: url, originalName: "song.mp3", createdAt: Date())

        try store.remove(file)

        #expect(!FileManager.default.fileExists(atPath: url.path))
        #expect(store.pendingFiles().isEmpty)
    }

    @Test func removingAnAlreadyMissingFileDoesNotThrow() throws {
        let (store, dir) = makeStore()
        let url = dir.appendingPathComponent(InboxFileNaming.fileName(id: UUID(), originalName: "gone.mp3"))
        let file = InboxFile(url: url, originalName: "gone.mp3", createdAt: Date())

        try store.remove(file)
    }

    /// Files people drop into "On My iPhone > Locally" (the app's Documents
    /// folder) count as waiting too, under their own names.
    @Test func pendingFilesIncludesAudioDroppedInTheDocumentsFolder() throws {
        let (_, inboxDir) = makeStore()
        let docs = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true)
        try Data([0xFF, 0xFB, 1, 2]).write(to: docs.appendingPathComponent("2 far from this.mp3"))
        try Data([1, 2, 3]).write(to: docs.appendingPathComponent("notes.txt"))
        try FileManager.default.createDirectory(at: docs.appendingPathComponent("folder.mp3"), withIntermediateDirectories: true)
        let store = AppGroupInboxStore(directory: inboxDir, documentsDirectory: docs)

        let files = store.pendingFiles()

        #expect(files.map(\.originalName) == ["2 far from this.mp3"])
        try store.remove(files[0])
        #expect(store.pendingFiles().isEmpty)
    }
}
