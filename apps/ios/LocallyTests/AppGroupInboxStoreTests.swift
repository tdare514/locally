import Foundation
import Testing
@testable import Locally

struct AppGroupInboxStoreTests {
    private func makeStore(documentsDirectory: URL? = nil) -> (AppGroupInboxStore, URL) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let store = AppGroupInboxStore(directory: dir, documentsDirectory: documentsDirectory)
        return (store, dir)
    }

    /// Writes a file named per `InboxFileNaming` and backdates its creation
    /// date so ordering tests don't depend on how fast the filesystem
    /// timestamps successive writes.
    private func writeInboxFile(named originalName: String, createdAt: Date, in dir: URL, bytes: Data = Data([0, 1, 2, 3])) throws -> URL {
        let name = InboxFileNaming.fileName(id: UUID(), originalName: originalName)
        let url = dir.appendingPathComponent(name)
        try bytes.write(to: url)
        try FileManager.default.setAttributes([.creationDate: createdAt], ofItemAtPath: url.path)
        return url
    }

    private func writeRaw(name: String, bytes: Data, in dir: URL) throws -> URL {
        let url = dir.appendingPathComponent(name)
        try bytes.write(to: url)
        return url
    }

    private func setAge(_ url: URL, secondsAgo: TimeInterval) throws {
        let date = Date().addingTimeInterval(-secondsAgo)
        try FileManager.default.setAttributes(
            [.modificationDate: date, .creationDate: date],
            ofItemAtPath: url.path
        )
    }

    private static let staleAge: TimeInterval = 2 * 60 * 60

    @Test func pendingFilesListsAudioFilesOldestFirst() throws {
        let (store, dir) = makeStore()
        let now = Date()
        _ = try writeInboxFile(named: "second.mp3", createdAt: now, in: dir)
        _ = try writeInboxFile(named: "first.m4a", createdAt: now.addingTimeInterval(-60), in: dir)

        let files = store.pendingFiles()

        #expect(files.map(\.originalName) == ["first.m4a", "second.mp3"])
    }

    @Test func pendingFilesListsEverySupportedExtension() throws {
        let (store, dir) = makeStore()
        let now = Date()
        for name in ["one.mp3", "two.m4a", "three.wav", "four.flac", "five.aiff", "six.aif"] {
            _ = try writeInboxFile(named: name, createdAt: now, in: dir)
        }
        _ = try writeInboxFile(named: "LOUD.MP3", createdAt: now, in: dir)

        let files = store.pendingFiles()

        #expect(files.count == 7)
        #expect(Set(files.map(\.originalName)) == Set(["one.mp3", "two.m4a", "three.wav", "four.flac", "five.aiff", "six.aif", "LOUD.MP3"]))
    }

    @Test func pendingFilesIgnoresAudioTheAppCannotImport() throws {
        let (store, dir) = makeStore()
        _ = try writeInboxFile(named: "song.ogg", createdAt: Date(), in: dir)
        _ = try writeInboxFile(named: "song.caf", createdAt: Date(), in: dir)
        _ = try writeInboxFile(named: "song.mp3", createdAt: Date(), in: dir)

        let files = store.pendingFiles()

        #expect(files.map(\.originalName) == ["song.mp3"])
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

    @Test func pendingFilesInDocumentsIgnoresUnsupportedAudio() throws {
        let (_, inboxDir) = makeStore()
        let docs = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true)
        try Data([1, 2, 3]).write(to: docs.appendingPathComponent("a.ogg"))
        try Data([1, 2, 3]).write(to: docs.appendingPathComponent("b.mp3"))
        let store = AppGroupInboxStore(directory: inboxDir, documentsDirectory: docs)

        let files = store.pendingFiles()

        #expect(files.map(\.originalName) == ["b.mp3"])
        #expect(FileManager.default.fileExists(atPath: docs.appendingPathComponent("a.ogg").path))
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

    @Test func sweepDeletesUnsupportedInboxFilesImmediately() throws {
        let (store, dir) = makeStore()
        _ = try writeInboxFile(named: "cover.jpg", createdAt: Date(), in: dir)
        _ = try writeInboxFile(named: "song.ogg", createdAt: Date(), in: dir)
        _ = try writeInboxFile(named: "song.mp3", createdAt: Date(), in: dir)

        let removed = store.sweepOrphans()

        #expect(removed == 2)
        #expect(store.pendingFiles().map(\.originalName) == ["song.mp3"])
    }

    @Test func sweepKeepsFreshOffSchemeFilesAndDeletesStaleOnes() throws {
        let (store, dir) = makeStore()
        let fresh = try writeRaw(name: "stray.mp3", bytes: Data([1]), in: dir)
        let stale = try writeRaw(name: "old.mp3", bytes: Data([1]), in: dir)
        try setAge(stale, secondsAgo: Self.staleAge)

        let removed = store.sweepOrphans()

        #expect(removed == 1)
        #expect(FileManager.default.fileExists(atPath: fresh.path))
        #expect(!FileManager.default.fileExists(atPath: stale.path))
    }

    @Test func sweepDeletesStaleEmptyFilesButKeepsFreshEmptyOnes() throws {
        let (store, dir) = makeStore()
        let fresh = try writeInboxFile(named: "fresh.mp3", createdAt: Date(), in: dir, bytes: Data())
        let stale = try writeInboxFile(named: "stale.mp3", createdAt: Date(), in: dir, bytes: Data())
        try setAge(stale, secondsAgo: Self.staleAge)

        let removed = store.sweepOrphans()

        #expect(removed == 1)
        #expect(FileManager.default.fileExists(atPath: fresh.path))
        #expect(!FileManager.default.fileExists(atPath: stale.path))
    }

    @Test func sweepNeverDeletesAValidPendingFileHoweverOld() throws {
        let (store, dir) = makeStore()
        let url = try writeInboxFile(named: "song.mp3", createdAt: Date(), in: dir)
        try setAge(url, secondsAgo: 400 * 24 * 60 * 60)

        let removed = store.sweepOrphans()

        #expect(removed == 0)
        #expect(store.pendingFiles().map(\.originalName) == ["song.mp3"])
    }

    @Test func sweepSkipsDirectoriesAndHiddenFiles() throws {
        let (store, dir) = makeStore()
        try FileManager.default.createDirectory(at: dir.appendingPathComponent("junk.ogg"), withIntermediateDirectories: true)
        let hidden = dir.appendingPathComponent(".junk.ogg")
        try Data([1]).write(to: hidden)
        try setAge(hidden, secondsAgo: Self.staleAge)

        let removed = store.sweepOrphans()

        #expect(removed == 0)
        var isDir: ObjCBool = false
        #expect(FileManager.default.fileExists(atPath: dir.appendingPathComponent("junk.ogg").path, isDirectory: &isDir) && isDir.boolValue)
        #expect(FileManager.default.fileExists(atPath: hidden.path))
    }

    @Test func sweepNeverTouchesTheDocumentsFolder() throws {
        let (_, inboxDir) = makeStore()
        let docs = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true)
        let stray = try writeRaw(name: "stray.mp3", bytes: Data([1]), in: docs)
        let ogg = try writeRaw(name: "song.ogg", bytes: Data([1]), in: docs)
        let notes = try writeRaw(name: "notes.txt", bytes: Data([1]), in: docs)
        let empty = try writeRaw(name: "empty.mp3", bytes: Data(), in: docs)
        try setAge(stray, secondsAgo: Self.staleAge)
        try setAge(ogg, secondsAgo: Self.staleAge)
        try setAge(notes, secondsAgo: Self.staleAge)
        try setAge(empty, secondsAgo: Self.staleAge)
        let store = AppGroupInboxStore(directory: inboxDir, documentsDirectory: docs)
        _ = try writeInboxFile(named: "bad.ogg", createdAt: Date(), in: inboxDir)

        let removed = store.sweepOrphans()

        #expect(removed == 1)
        #expect(FileManager.default.fileExists(atPath: stray.path))
        #expect(FileManager.default.fileExists(atPath: ogg.path))
        #expect(FileManager.default.fileExists(atPath: notes.path))
        #expect(FileManager.default.fileExists(atPath: empty.path))
    }

    @Test func sweepOnAMissingDirectoryReturnsZero() {
        let missing = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let store = AppGroupInboxStore(directory: missing)

        #expect(store.sweepOrphans() == 0)
    }

    @Test func sweepThenPendingFilesAgree() throws {
        let (store, dir) = makeStore()
        _ = try writeInboxFile(named: "keep.mp3", createdAt: Date(), in: dir)
        _ = try writeInboxFile(named: "drop.ogg", createdAt: Date(), in: dir)
        let staleOffScheme = try writeRaw(name: "orphan.mp3", bytes: Data([1]), in: dir)
        try setAge(staleOffScheme, secondsAgo: Self.staleAge)
        try FileManager.default.createDirectory(at: dir.appendingPathComponent("dir.mp3"), withIntermediateDirectories: true)

        store.sweepOrphans()
        let pending = store.pendingFiles()

        for file in pending {
            #expect(FileManager.default.fileExists(atPath: file.url.path))
        }
        let fm = FileManager.default
        let remaining = try fm.contentsOfDirectory(atPath: dir.path)
        for name in remaining where !name.hasPrefix(".") {
            let url = dir.appendingPathComponent(name)
            var isDirectory: ObjCBool = false
            guard fm.fileExists(atPath: url.path, isDirectory: &isDirectory) else { continue }
            if isDirectory.boolValue { continue }
            let listed = pending.contains { $0.url.lastPathComponent == name }
            let freshOffScheme = InboxFileNaming.originalName(fromInboxFileName: name) == nil
                && SupportedAudio.isSupported(fileName: name)
            let attrs = try? fm.attributesOfItem(atPath: url.path)
            let size = (attrs?[.size] as? NSNumber)?.intValue ?? -1
            let mod = attrs?[.modificationDate] as? Date ?? attrs?[.creationDate] as? Date
            let age = mod.map { Date().timeIntervalSince($0) } ?? 0
            let freshEmpty = size == 0 && age <= AppGroupInboxStore.orphanGracePeriod
            #expect(listed || freshOffScheme && age <= AppGroupInboxStore.orphanGracePeriod || freshEmpty)
        }
    }
}
