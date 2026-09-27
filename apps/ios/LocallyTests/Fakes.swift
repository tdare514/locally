import Foundation
@testable import Locally

/// Copies the staged file through untouched and reports the extension it
/// was given, so `ReleaseCoordinatorTests` can exercise the coordinator's
/// wiring without AVFoundation.
final class FakeTranscoder: Transcoder {
    func prepare(_ file: StagedFile) async throws -> PreparedFile {
        PreparedFile(url: file.url, ext: file.url.pathExtension.lowercased())
    }
}

/// Records every call it receives instead of touching the file, so tests
/// can assert on what tags/cover were passed, and can simulate a failure.
final class FakeTagWriter: TagWriter {
    struct Call {
        let tags: TagSet
        let cover: Data?
        let url: URL
    }

    private(set) var calls: [Call] = []
    var errorToThrow: Error?
    /// When set alongside `errorToThrow`, only the call with this 1-based
    /// number fails; every other call succeeds and is recorded. Leaving
    /// this `nil` (the default) fails every call, as before.
    var failOnCallNumber: Int?

    func write(_ tags: TagSet, cover: Data?, to url: URL) async throws {
        let callNumber = calls.count + 1
        if let errorToThrow, failOnCallNumber == nil || failOnCallNumber == callNumber {
            throw errorToThrow
        }
        calls.append(Call(tags: tags, cover: cover, url: url))
    }
}

/// In-memory `LibraryStore` fake — no SwiftData, just a dictionary.
final class InMemoryLibraryStore: LibraryStore {
    private var storage: [UUID: Release] = [:]

    func all() throws -> [Release] {
        Array(storage.values)
    }

    func upsert(_ release: Release) throws {
        storage[release.id] = release
    }

    func delete(id: UUID) throws {
        storage.removeValue(forKey: id)
    }
}

/// `SpotifyFolderAccess` fake backed by a real temp directory, so
/// `withAccess` can actually move files on disk the way the production
/// bookmark-backed implementation does.
final class FakeSpotifyFolder: SpotifyFolderAccess {
    let directory: URL
    private(set) var connected: Bool

    init(directory: URL) {
        self.directory = directory
        self.connected = true
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    var isConnected: Bool { connected }

    func connect(url: URL) throws {
        connected = true
    }

    func withAccess<T>(_ body: (URL) throws -> T) throws -> T {
        guard connected else { throw LocallyError.folderNotConnected }
        return try body(directory)
    }

    func withAccess<T>(_ body: (URL) async throws -> T) async throws -> T {
        guard connected else { throw LocallyError.folderNotConnected }
        return try await body(directory)
    }

    func disconnect() {
        connected = false
    }
}

/// In-memory `CoverStore` fake — no disk I/O, just a dictionary, so tests
/// can assert on what was saved/deleted without touching Application
/// Support.
final class FakeCoverStore: CoverStore {
    private var storage: [UUID: Data] = [:]
    private(set) var deletedIds: [UUID] = []

    func save(_ data: Data, for id: UUID) throws -> String {
        storage[id] = data
        return "fake-cover-\(id.uuidString)"
    }

    func load(_ id: UUID) -> Data? {
        storage[id]
    }

    func delete(_ id: UUID) throws {
        storage.removeValue(forKey: id)
        deletedIds.append(id)
    }
}

/// `FileImporter` fake that copies a fixed set of already-on-disk URLs into
/// a fresh tmp directory, mirroring the shape (but not the security scope)
/// of the production importer. Optionally reports tags for a given URL, so
/// tests can exercise the tag-prefill path the production `FileImporter`
/// drives from `AVAsset` metadata.
final class FakeFileImporter: FileImporter {
    var tagsByURL: [URL: TagSet] = [:]

    func stage(_ urls: [URL]) async throws -> [StagedFile] {
        try urls.map { url in
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let dest = dir.appendingPathComponent(url.lastPathComponent)
            try FileManager.default.copyItem(at: url, to: dest)
            return StagedFile(url: dest, originalName: url.lastPathComponent, existingTags: tagsByURL[url])
        }
    }
}

/// In-memory `InboxStore` fake — no App Group container, just an array — so
/// tests can seed pending files and assert on what got removed.
final class FakeInboxStore: InboxStore {
    private(set) var files: [InboxFile]
    private(set) var removed: [InboxFile] = []

    init(files: [InboxFile] = []) {
        self.files = files
    }

    func pendingFiles() -> [InboxFile] {
        files
    }

    func remove(_ file: InboxFile) throws {
        files.removeAll { $0.url == file.url }
        removed.append(file)
    }
}

/// `PurchaseService` fake — no StoreKit, just settable results — so tests
/// can drive `PaywallView`-adjacent logic without a network or a StoreKit
/// test session.
final class FakePurchaseService: PurchaseService {
    private(set) var isFullUnlocked: Bool
    var productToReturn: PurchaseProduct?
    var purchaseResult: Result<Bool, Error> = .success(true)
    var restoreResult: Result<Bool, Error> = .success(true)
    private(set) var purchaseCallCount = 0
    private(set) var restoreCallCount = 0
    private(set) var refreshCallCount = 0

    init(isFullUnlocked: Bool = false) {
        self.isFullUnlocked = isFullUnlocked
    }

    func loadProduct() async throws -> PurchaseProduct? {
        productToReturn
    }

    func purchase() async throws -> Bool {
        purchaseCallCount += 1
        switch purchaseResult {
        case .success(let unlocked):
            if unlocked { isFullUnlocked = true }
            return unlocked
        case .failure(let error):
            throw error
        }
    }

    func restore() async throws -> Bool {
        restoreCallCount += 1
        switch restoreResult {
        case .success(let unlocked):
            if unlocked { isFullUnlocked = true }
            return unlocked
        case .failure(let error):
            throw error
        }
    }

    func refreshEntitlement() async {
        refreshCallCount += 1
    }
}
