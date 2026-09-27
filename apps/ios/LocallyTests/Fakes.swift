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

/// In-memory `SyncAccountStore` fake — no `UserDefaults`/Keychain — so tests
/// can drive sign-in state directly (`save`/`clear`) and inspect `lastVersion`.
final class InMemorySyncAccountStore: SyncAccountStore {
    var baseURL = URL(string: "http://localhost:4000")!
    private(set) var email: String?
    private(set) var deviceToken: String?
    private(set) var deviceId: String?
    var lastVersion: Int = 0

    func save(email: String, deviceToken: String, deviceId: String) {
        self.email = email
        self.deviceToken = deviceToken
        self.deviceId = deviceId
    }

    func clear() {
        email = nil
        deviceToken = nil
        deviceId = nil
        lastVersion = 0
    }
}

/// In-memory `KeychainTokenStore` fake, for environments where the simulator
/// keychain isn't reliably available to a test bundle (see
/// `SyncAccountStoreTests`'s note on `SecKeychainTokenStore`).
final class InMemoryKeychainTokenStore: KeychainTokenStore {
    private var token: String?

    func load() -> String? { token }
    func save(_ newToken: String) { token = newToken }
    func delete() { token = nil }
}

/// `ReleaseSyncHook` fake — records what `ReleaseCoordinator` pushed/tombstoned,
/// without needing a real `SyncEngine`.
final class FakeReleaseSyncHook: ReleaseSyncHook {
    private(set) var pushedReleases: [Release] = []
    private(set) var tombstonedIds: [UUID] = []

    func pushAfterChange(_ release: Release) {
        pushedReleases.append(release)
    }

    func pushTombstone(_ id: UUID) {
        tombstonedIds.append(id)
    }

    func reset() {
        pushedReleases.removeAll()
        tombstonedIds.removeAll()
    }
}

/// `SyncApi` fake with an in-memory "server": a version-stamped release
/// store (so `releases(sinceVersion:)` behaves like the real paging
/// contract) and a settable set of file names each release already "has",
/// so `requestUploads` only returns tickets for the rest — exactly the
/// "upload missing files" behaviour `SyncEngine.push` relies on.
final class FakeSyncApi: SyncApi {
    private(set) var requestCodeCalls: [String] = []
    private(set) var verifyCalls: [(email: String, code: String, deviceName: String, platform: String)] = []
    var verifyResult: Result<SyncVerifyResult, Error> = .success(
        SyncVerifyResult(token: "test-token", userId: "user-1", email: "test@example.com", deviceId: "device-1", deviceName: "Test Device")
    )
    var meResult: Result<SyncMeResult, Error> = .success(
        SyncMeResult(email: "test@example.com", deviceId: "device-1", deviceName: "Test Device", quota: SyncQuota(usedBytes: 0, limitBytes: 1_073_741_824))
    )
    private(set) var revokedDeviceIds: [String] = []

    /// Release id -> stored record, each carrying the version it was last
    /// written at. `nil` records never existed; a tombstone stays in this
    /// dictionary with `deleted == true`, same as the real service.
    private var storage: [String: SyncRecord] = [:]
    private var currentVersion = 0

    /// Release id -> file names the fake "server" already has, so
    /// `requestUploads` omits them from the returned tickets.
    var existingFileNames: [String: Set<String>] = [:]
    private(set) var uploadedFileNames: [String] = []
    private(set) var requestUploadsCalls: [(releaseId: String, files: [SyncFileUploadRequest])] = []
    /// Bytes `downloadFile` writes for a given file name, so a test can hand
    /// `acceptFromMac` something to actually copy into the Spotify folder.
    var fileContents: [String: Data] = [:]

    /// Release ids whose *next* `putRelease` throws `.conflict` once, then
    /// succeeds normally — simulating "someone else wrote this first".
    var conflictOnNextPut: Set<String> = []
    private(set) var putCalls: [SyncRecord] = []
    private(set) var deleteCalls: [String] = []

    func requestCode(email: String) async throws {
        requestCodeCalls.append(email)
    }

    func verify(email: String, code: String, deviceName: String, platform: String) async throws -> SyncVerifyResult {
        verifyCalls.append((email, code, deviceName, platform))
        return try verifyResult.get()
    }

    func me() async throws -> SyncMeResult {
        try meResult.get()
    }

    func revokeDevice(_ id: String) async throws {
        revokedDeviceIds.append(id)
    }

    func releases(sinceVersion: Int) async throws -> SyncReleasesPage {
        let matching = storage.values
            .filter { ($0.version ?? 0) > sinceVersion }
            .sorted { ($0.version ?? 0) < ($1.version ?? 0) }
        return SyncReleasesPage(releases: matching, nextVersion: currentVersion)
    }

    @discardableResult
    func putRelease(_ record: SyncRecord) async throws -> Int {
        putCalls.append(record)
        if conflictOnNextPut.remove(record.id) != nil {
            throw SyncApiError.conflict(serverUpdatedAt: storage[record.id]?.updatedAt)
        }
        currentVersion += 1
        var stored = record
        stored.version = currentVersion
        storage[record.id] = stored
        return currentVersion
    }

    @discardableResult
    func deleteRelease(_ id: String) async throws -> Int {
        deleteCalls.append(id)
        currentVersion += 1
        var stored = storage[id] ?? SyncRecord(
            id: id, kind: "single", title: "", artist: "", tracks: [],
            origin: "ios", originDevice: "", createdAt: Date(), updatedAt: Date()
        )
        stored.deleted = true
        stored.version = currentVersion
        storage[id] = stored
        return currentVersion
    }

    /// Bytes to fail with, and how many times, before a given file name's
    /// `downloadFile` starts succeeding — simulates a Mac release that's
    /// visible (already `PUT`) before its files finish uploading, which
    /// `SyncEngine.acceptFromMac`/`reconcile` must tolerate by retrying
    /// rather than failing outright.
    var downloadFailCountRemaining: [String: Int] = [:]

    func requestUploads(releaseId: String, files: [SyncFileUploadRequest]) async throws -> [SyncUpload] {
        requestUploadsCalls.append((releaseId, files))
        // The real service 404s until the release record has been `PUT`
        // (see `spec/sync.md`), so this fake enforces the same order:
        // `SyncEngine.push` must `PUT` before it asks for upload tickets.
        guard storage[releaseId] != nil else {
            throw SyncApiError.network("No such release (PUT it before requesting uploads).")
        }
        let existing = existingFileNames[releaseId] ?? []
        return files.filter { !existing.contains($0.name) }.map { file in
            SyncUpload(
                name: file.name,
                url: URL(string: "https://fake-storage.example.com/\(releaseId)/\(file.name)")!,
                method: "PUT",
                headers: [:]
            )
        }
    }

    func uploadFile(_ fileURL: URL, to upload: SyncUpload) async throws {
        uploadedFileNames.append(upload.name)
        if let data = try? Data(contentsOf: fileURL) {
            fileContents[upload.name] = data
        }
    }

    func downloadURL(releaseId: String, fileName: String) async throws -> URL {
        URL(string: "https://fake-storage.example.com/\(releaseId)/\(fileName)")!
    }

    func downloadFile(from url: URL, to destination: URL) async throws {
        let name = url.lastPathComponent
        if let remaining = downloadFailCountRemaining[name], remaining > 0 {
            downloadFailCountRemaining[name] = remaining - 1
            throw SyncApiError.network("Not found yet (simulated upload-in-progress).")
        }
        let data = fileContents[name] ?? Data([0xFF, 0xFB, 1, 2, 3, 4])
        try data.write(to: destination)
    }

    /// Test helper: seeds the fake "server" with `record` directly (as if
    /// another device had already `PUT` it), bumping the version so
    /// `releases(sinceVersion:)` returns it.
    func seed(_ record: SyncRecord) {
        currentVersion += 1
        var stored = record
        stored.version = currentVersion
        storage[record.id] = stored
    }
}
