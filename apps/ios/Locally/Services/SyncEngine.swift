import Foundation

/// The narrow interface `ReleaseCoordinator` pushes through after a
/// successful user-initiated change. Kept separate from `SyncEngine` itself
/// so the coordinator (built first, in `AppContainer`) never needs to know
/// about `SyncApi`/`SyncAccountStore` — only that *something* wants to know
/// when a release changed or was deleted. `SyncEngine` is the only
/// production conformer; `AppContainer` wires `coordinator.syncHook =
/// syncEngine` after both exist, breaking what would otherwise be a
/// constructor cycle (the engine needs the coordinator too, for
/// `importSynced`/`applyRemoteUpdate`/`applyTombstone`).
protocol ReleaseSyncHook: AnyObject {
    /// Fire-and-forget: push `release` if signed in. Never throws — a sync
    /// failure must never surface as a failure of the user's own action.
    func pushAfterChange(_ release: Release)
    /// Fire-and-forget: tombstone `id` if signed in.
    func pushTombstone(_ id: UUID)
}

/// What Settings and the Import tab bind to: sign-in state, the last run,
/// any error, releases waiting to be accepted from the Mac, and quota.
/// `@Observable` so SwiftUI redraws without the views polling `SyncEngine`.
@Observable
final class SyncStatus {
    var signedIn: Bool
    var email: String?
    var deviceName: String?
    var lastRunAt: Date?
    var lastError: String?
    /// Records from the Mac not yet in this device's library, offered in
    /// the Import tab's "N from your Mac" toast.
    var pendingFromMac: [SyncRecord] = []
    var quota: SyncQuota?
    /// Record ids currently being downloaded by `acceptFromMac`, so the UI
    /// can show a per-item progress state.
    var acceptingIds: Set<String> = []
    /// Record ids whose most recent `acceptFromMac` attempt failed to
    /// download — the record is visible in `GET /v1/releases` from the
    /// moment it's `PUT`, but its files land afterwards, so a fresh Mac
    /// release can briefly 404 here. Never dropped from `pendingFromMac` on
    /// this; `reconcile()` retries every id in this set automatically, so it
    /// completes on its own once the files are actually there.
    var failedAcceptIds: Set<String> = []
    /// Whether a code was just sent, and to which address — drives the
    /// Settings sign-in form's step (email entry vs. code entry).
    var codeSentTo: String?

    init(
        signedIn: Bool = false,
        email: String? = nil,
        deviceName: String? = nil,
        lastRunAt: Date? = nil,
        lastError: String? = nil
    ) {
        self.signedIn = signedIn
        self.email = email
        self.deviceName = deviceName
        self.lastRunAt = lastRunAt
        self.lastError = lastError
    }
}

/// Orchestrates the phone side of `spec/sync.md`: sign-in, pushing local
/// changes, and reconciling remote ones. Mirrors `ReleaseCoordinator`'s role
/// for import/edit/delete — the one place that sequences a sync flow over
/// `SyncApi`, `SyncAccountStore` and `ReleaseCoordinator`.
///
/// Every entry point is safe to call when signed out (no-ops) and safe to
/// call concurrently with itself: `reconcile()` skips an overlapping run,
/// and `push`/`tombstone` never throw — every failure lands on
/// `status.lastError` instead, so a sync problem never blocks or fails the
/// user's own action.
final class SyncEngine: ReleaseSyncHook {
    private let api: SyncApi
    private let account: SyncAccountStore
    private let library: LibraryStore
    private let coordinator: ReleaseCoordinator
    private let deviceName: () -> String

    let status: SyncStatus

    private var isReconciling = false
    private var pushingIds: Set<UUID> = []

    init(
        api: SyncApi,
        account: SyncAccountStore,
        library: LibraryStore,
        coordinator: ReleaseCoordinator,
        status: SyncStatus = SyncStatus(),
        deviceName: @escaping () -> String
    ) {
        self.api = api
        self.account = account
        self.library = library
        self.coordinator = coordinator
        self.status = status
        self.deviceName = deviceName
        status.signedIn = account.deviceToken != nil
        status.email = account.email
    }

    var isSignedIn: Bool { account.deviceToken != nil }

    // MARK: - Account

    /// `POST /v1/auth/code`. Errors are surfaced to the caller (the
    /// sign-in form shows them inline) rather than only to `status`.
    func requestCode(email: String) async throws {
        try await api.requestCode(email: email)
        status.codeSentTo = email
    }

    /// `POST /v1/auth/verify`. On success, saves the device token/email and
    /// immediately reconciles once, which back-fills every release this
    /// device hasn't pushed yet (see `reconcile`).
    func verify(email: String, code: String) async throws {
        let result = try await api.verify(email: email, code: code, deviceName: deviceName(), platform: "ios")
        account.save(email: result.email, deviceToken: result.token, deviceId: result.deviceId)
        status.signedIn = true
        status.email = result.email
        status.deviceName = result.deviceName
        status.codeSentTo = nil
        status.lastError = nil
        await reconcile()
    }

    /// Revokes this device server-side (best-effort — signing out proceeds
    /// locally even if that call fails, e.g. offline) and clears local
    /// account state.
    func signOut() async {
        if let deviceId = account.deviceId {
            try? await api.revokeDevice(deviceId)
        }
        account.clear()
        status.signedIn = false
        status.email = nil
        status.deviceName = nil
        status.pendingFromMac = []
        status.failedAcceptIds = []
        status.quota = nil
        status.lastError = nil
    }

    // MARK: - ReleaseSyncHook

    func pushAfterChange(_ release: Release) {
        Task { [weak self] in await self?.push(release) }
    }

    func pushTombstone(_ id: UUID) {
        Task { [weak self] in await self?.tombstone(id) }
    }

    // MARK: - Push

    /// `PUT`s the record, then uploads any of `release`'s files the server
    /// doesn't already have. The record goes first: the service's
    /// `POST /v1/releases/:id/files` 404s until the release row exists, so
    /// requesting upload URLs before the `PUT` would always fail. A `409`
    /// on the `PUT` (someone else wrote this release first) reconciles to
    /// pull that change in, then re-submits this device's record with a
    /// fresh `updatedAt` so it still wins — this device's own coordinator
    /// just finished this change a moment ago, so it is, by construction,
    /// the newer intent.
    func push(_ release: Release) async {
        guard isSignedIn else { return }
        guard pushingIds.insert(release.id).inserted else { return }
        defer { pushingIds.remove(release.id) }

        do {
            try await pushInternal(release)
            status.lastError = nil
        } catch {
            status.lastError = error.localizedDescription
        }
    }

    private func pushInternal(_ release: Release) async throws {
        // Sizes and uploads read the track files inside Spotify's folder, which
        // needs the folder's security scope open for the whole push.
        try await coordinator.withTrackFiles(of: release) { files in
            var fileBytes: [UUID: Int] = [:]
            for entry in files { fileBytes[entry.track.id] = Self.fileSize(at: entry.url) }
            var record = release.toSyncRecord(origin: "ios", originDevice: deviceName(), fileBytes: fileBytes)

            do {
                try await api.putRelease(record)
            } catch SyncApiError.conflict {
                await reconcile()
                record.updatedAt = Date()
                try await api.putRelease(record)
            }

            try await uploadFiles(for: release, record: record, files: files)
            markPushed(release, at: record.updatedAt)
        }
    }

    private func uploadFiles(for release: Release, record: SyncRecord, files: [(track: Track, url: URL)]) async throws {
        var localPathByName: [String: URL] = [:]
        var requests: [SyncFileUploadRequest] = []
        for entry in files {
            let name = entry.url.lastPathComponent
            localPathByName[name] = entry.url
            requests.append(SyncFileUploadRequest(
                name: name,
                bytes: Self.fileSize(at: entry.url),
                contentType: Self.contentType(forExtension: entry.url.pathExtension)
            ))
        }
        if let coverName = record.cover, let coverPath = release.coverPath {
            let coverURL = URL(fileURLWithPath: coverPath)
            localPathByName[coverName] = coverURL
            requests.append(SyncFileUploadRequest(name: coverName, bytes: Self.fileSize(at: coverURL), contentType: Self.contentType(forExtension: (coverName as NSString).pathExtension)))
        }

        guard !requests.isEmpty else { return }
        let uploads = try await api.requestUploads(releaseId: record.id, files: requests)
        for upload in uploads {
            guard let localURL = localPathByName[upload.name] else { continue }
            try await api.uploadFile(localURL, to: upload)
        }
    }

    /// Marks `release` as pushed (see `Release.syncedUpdatedAt`) so
    /// back-fill never re-pushes it until it changes again.
    private func markPushed(_ release: Release, at updatedAt: Date) {
        var pushed = release
        pushed.updatedAt = updatedAt
        pushed.syncedUpdatedAt = updatedAt
        try? library.upsert(pushed)
    }

    // MARK: - Tombstone

    func tombstone(_ id: UUID) async {
        guard isSignedIn else { return }
        do {
            try await api.deleteRelease(id.uuidString)
            status.lastError = nil
        } catch {
            status.lastError = error.localizedDescription
        }
    }

    // MARK: - Reconcile

    /// `GET /v1/releases?sinceVersion=<last seen>`, applies every record
    /// (see `process(_:)`), then back-fills local releases never pushed.
    /// Skips a run already in progress rather than queuing one — the next
    /// timer tick or explicit "Sync now" will simply pick up where this one
    /// left off via `lastVersion`.
    func reconcile() async {
        guard isSignedIn else { return }
        guard !isReconciling else { return }
        isReconciling = true
        defer { isReconciling = false }

        do {
            // Back-filling first means a release pushed just now is already
            // reflected in the very next fetch below, so `lastVersion`
            // converges in this one pass rather than lagging a cycle.
            await backfillUnpushed()

            let page = try await api.releases(sinceVersion: account.lastVersion)
            for record in page.releases {
                await process(record)
            }
            account.lastVersion = page.nextVersion

            await retryFailedAccepts()

            if let me = try? await api.me() {
                status.quota = me.quota
            }

            status.lastRunAt = Date()
            // Don't stomp on an accept retry's own error message with `nil`
            // when one is still pending.
            if status.failedAcceptIds.isEmpty {
                status.lastError = nil
            }
        } catch {
            status.lastError = error.localizedDescription
        }
    }

    /// Retries `acceptFromMac` for every record a previous attempt couldn't
    /// download, so the once-visible-before-its-files-land race in `push`'s
    /// doc comment resolves itself without the user needing to tap "Send to
    /// Spotify" again.
    private func retryFailedAccepts() async {
        guard !status.failedAcceptIds.isEmpty else { return }
        for recordId in status.failedAcceptIds {
            await acceptFromMac(recordId)
        }
    }

    private func process(_ record: SyncRecord) async {
        guard let recordId = UUID(uuidString: record.id) else { return }
        let localReleases = (try? library.all()) ?? []
        let existingLocal = localReleases.first { $0.id == recordId }

        if record.deleted {
            status.pendingFromMac.removeAll { $0.id == record.id }
            if existingLocal != nil {
                try? await coordinator.applyTombstone(recordId)
            }
            return
        }

        if let existingLocal {
            if record.updatedAt > existingLocal.updatedAt {
                _ = try? await coordinator.applyRemoteUpdate(record)
            }
            return
        }

        guard record.origin == "mac" else { return }
        if let index = status.pendingFromMac.firstIndex(where: { $0.id == record.id }) {
            status.pendingFromMac[index] = record
        } else {
            status.pendingFromMac.append(record)
        }
    }

    /// Pushes every local release that has never been pushed (`syncedUpdatedAt
    /// == nil`) — the "songs already on this phone before you signed in"
    /// back-fill `spec/sync.md` describes.
    private func backfillUnpushed() async {
        let localReleases = (try? library.all()) ?? []
        for release in localReleases where release.syncedUpdatedAt == nil {
            await push(release)
        }
    }

    // MARK: - Accept from Mac

    /// Downloads every file `record` names into a fresh temp directory, then
    /// hands it to `ReleaseCoordinator.importSynced` to move into Spotify's
    /// folder. The temp directory is removed afterwards either way.
    func acceptFromMac(_ recordId: String) async {
        guard let record = status.pendingFromMac.first(where: { $0.id == recordId }) else { return }
        status.acceptingIds.insert(recordId)
        defer { status.acceptingIds.remove(recordId) }

        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("Locally-Sync-\(UUID().uuidString)", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: tempDir) }

            for track in record.tracks {
                try await downloadFile(releaseId: record.id, name: track.file, into: tempDir)
            }
            if let cover = record.cover {
                try await downloadFile(releaseId: record.id, name: cover, into: tempDir)
            }

            let release = try await coordinator.importSynced(record, dir: tempDir)
            markPushed(release, at: release.updatedAt)
            status.pendingFromMac.removeAll { $0.id == recordId }
            status.failedAcceptIds.remove(recordId)
            status.lastError = nil
        } catch {
            // Keep it pending rather than failing outright: the record can
            // be visible here before the Mac finishes uploading its files
            // (see `push`'s doc comment), so this is often exactly that
            // race, not a permanent problem. `reconcile()` retries it.
            status.failedAcceptIds.insert(recordId)
            status.lastError = error.localizedDescription
        }
    }

    /// Convenience for "Send all": accepts every currently pending record,
    /// one at a time (each is its own temp directory and coordinator call).
    func acceptAllFromMac() async {
        for record in status.pendingFromMac {
            await acceptFromMac(record.id)
        }
    }

    private func downloadFile(releaseId: String, name: String, into dir: URL) async throws {
        let url = try await api.downloadURL(releaseId: releaseId, fileName: name)
        try await api.downloadFile(from: url, to: dir.appendingPathComponent(name))
    }

    // MARK: - Helpers

    private static func fileSize(at url: URL) -> Int {
        (try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? Int ?? 0
    }

    private static func contentType(forExtension ext: String) -> String {
        switch ext.lowercased() {
        case "mp3": return "audio/mpeg"
        case "m4a": return "audio/mp4"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        default: return "application/octet-stream"
        }
    }
}
