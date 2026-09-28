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
    /// Records whose cover changed (per `SyncRecord.coverHash`) during
    /// `process(_:)` but whose download of the new cover bytes failed,
    /// the same "record visible before its files land" race
    /// `failedAcceptIds` exists for. Kept here, by record id, because
    /// `reconcile()` advances `account.lastVersion` past every record in a
    /// fetched page regardless of a per-record failure, so a record left
    /// out of this set would never be handed back by
    /// `GET /v1/releases?sinceVersion=` on its own; this device already
    /// has the (text) update, just not yet the new cover. Retried directly
    /// (not re-fetched) by `retryFailedCoverUpdates()` every `reconcile()`.
    var failedCoverUpdates: [String: SyncRecord] = [:]
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
    private let coverStore: CoverStore
    private let deviceName: () -> String

    let status: SyncStatus

    private var isReconciling = false
    private var pushingIds: Set<UUID> = []

    init(
        api: SyncApi,
        account: SyncAccountStore,
        library: LibraryStore,
        coordinator: ReleaseCoordinator,
        coverStore: CoverStore,
        status: SyncStatus = SyncStatus(),
        deviceName: @escaping () -> String
    ) {
        self.api = api
        self.account = account
        self.library = library
        self.coordinator = coordinator
        self.coverStore = coverStore
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
        try account.save(email: result.email, deviceToken: result.token, deviceId: result.deviceId)
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
            // The cover is resolved by id, not by `coverPath` (see
            // `CoverStore.fileURL`). A cover the store can't find is left out
            // of the record rather than failing the push: the other device
            // would otherwise wait forever for a `cover.jpg` that never lands.
            let coverURL = release.coverPath != nil ? coverStore.fileURL(release.id) : nil
            record.cover = coverURL.map { "cover.\($0.pathExtension)" }
            // The change signal the other side compares against its own
            // local cover's hash (see `applyRemoteUpdate` below). iOS
            // already re-uploads the cover on every push regardless (no
            // "already uploaded" cache like web's `uploadedFiles`), so
            // this needs no accompanying change to `uploadFiles`.
            // `try?`: a cover that cannot be read is sent without a hash (no
            // change signal) rather than failing the whole push, in the same
            // spirit as the missing-cover case above.
            record.coverHash = coverURL.flatMap { (try? Data(contentsOf: $0))?.sha256Hex }

            do {
                try await api.putRelease(record)
            } catch SyncApiError.conflict {
                await reconcile()
                record.updatedAt = Date()
                try await api.putRelease(record)
            }

            try await uploadFiles(record: record, files: files, coverURL: coverURL)
            markPushed(release, at: record.updatedAt)
        }
    }

    private func uploadFiles(record: SyncRecord, files: [(track: Track, url: URL)], coverURL: URL?) async throws {
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
        if let coverName = record.cover, let coverURL {
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
            // Retried before the fetch below, not after: a cover download
            // that fails during this run's own `process(_:)` loop is left
            // pending for the *next* `reconcile()` (see
            // `SyncStatus.failedCoverUpdates`), not retried again inside
            // this same run.
            await retryFailedCoverUpdates()

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

    /// Retries every record `applyRemoteUpdate(_:existingLocal:)` couldn't
    /// finish because its cover download failed. See
    /// `SyncStatus.failedCoverUpdates`'s doc comment for why this can't
    /// just wait for the next `GET /v1/releases` page.
    private func retryFailedCoverUpdates() async {
        guard !status.failedCoverUpdates.isEmpty else { return }
        let pending = status.failedCoverUpdates
        let localReleases = (try? library.all()) ?? []
        for (recordId, record) in pending {
            guard let releaseId = UUID(uuidString: record.id),
                  let existingLocal = localReleases.first(where: { $0.id == releaseId }) else {
                // The local release is gone (e.g. deleted since), so there
                // is nothing left to retry this against.
                status.failedCoverUpdates.removeValue(forKey: recordId)
                continue
            }
            await applyRemoteUpdate(record, existingLocal: existingLocal)
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
            guard record.updatedAt > existingLocal.updatedAt else { return }
            if isOwnEcho(record) {
                // This device's own record coming back newer than its local
                // copy: the re-`PUT` after a 409 landed (with a fresh
                // `updatedAt`) but the file uploads after it failed, so
                // `markPushed` never ran. The content is already ours, so
                // there is nothing to re-tag; catch `updatedAt` up and leave
                // `syncedUpdatedAt` alone, so `backfillUnpushed` retries the
                // files. Treating it as a remote update would mark it synced
                // and strand the files on this phone for good.
                var caughtUp = existingLocal
                caughtUp.updatedAt = record.updatedAt
                try? library.upsert(caughtUp)
            } else {
                await applyRemoteUpdate(record, existingLocal: existingLocal)
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

    /// Applies a remote text/tag update to `existingLocal`, downloading and
    /// re-embedding the cover first when `record.coverHash` shows it
    /// changed from the local copy.
    ///
    /// `record.coverHash` is the change signal: `nil` means either a
    /// `syncVersion` 1 sender or a `syncVersion` 2 record that legitimately
    /// has no cover, and in both cases `ReleaseCoordinator.applyRemoteUpdate`
    /// is called without new cover data, leaving the local cover alone
    /// exactly as before this change. A non-nil hash equal to the local
    /// cover's own hash (`coverStore.load` re-hashed on demand, `nil` when
    /// there is no local cover) means the bytes are unchanged, so no
    /// download is needed either. Only a non-nil hash that differs from the
    /// local one triggers a download.
    ///
    /// If that download fails (e.g. a 404 while the sender is still
    /// uploading, the same race `acceptFromMac` already tolerates), the
    /// coordinator is never called, so this release's local `updatedAt`
    /// stays behind `record.updatedAt` and the record is kept in
    /// `status.failedCoverUpdates` for `retryFailedCoverUpdates()` to
    /// retry on the next `reconcile()`, rather than being silently dropped.
    private func applyRemoteUpdate(_ record: SyncRecord, existingLocal: Release) async {
        guard let coverName = record.cover, isCoverChanged(record, existingLocal: existingLocal) else {
            _ = try? await coordinator.applyRemoteUpdate(record)
            status.failedCoverUpdates.removeValue(forKey: record.id)
            return
        }

        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("Locally-Sync-Cover-\(UUID().uuidString)", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: tempDir) }

            try await downloadFile(releaseId: record.id, name: coverName, into: tempDir)
            let data = try Data(contentsOf: tempDir.appendingPathComponent(coverName))
            _ = try await coordinator.applyRemoteUpdate(record, newCoverData: data)
            status.failedCoverUpdates.removeValue(forKey: record.id)
            status.lastError = nil
        } catch {
            // Keep it pending rather than failing outright: same
            // upload-in-progress race `acceptFromMac` documents. Retried by
            // `retryFailedCoverUpdates()`.
            status.failedCoverUpdates[record.id] = record
            status.lastError = error.localizedDescription
        }
    }

    /// `true` only when `record` carries a cover whose hash differs from
    /// the release's current local cover. `coverStore.load` is re-hashed
    /// on demand rather than trusting a stored hash, for the same reason
    /// there's no new persisted field on `Release`: it's a small file
    /// that's already read for re-embedding, so nothing is saved by
    /// caching its hash, and a cached value could drift from the bytes.
    private func isCoverChanged(_ record: SyncRecord, existingLocal: Release) -> Bool {
        guard let remoteHash = record.coverHash, record.cover != nil else { return false }
        let localHash = coverStore.load(existingLocal.id)?.sha256Hex
        return remoteHash != localHash
    }

    /// Pushes every local release that has never been fully pushed (see
    /// `needsPush`) — the "songs already on this phone before you signed in"
    /// back-fill `spec/sync.md` describes, and the retry for pushes that
    /// failed part-way.
    private func backfillUnpushed() async {
        let localReleases = (try? library.all()) ?? []
        for release in localReleases where Self.needsPush(release) {
            await push(release)
        }
    }

    /// Never pushed, or changed since the last push that fully completed
    /// (record and files). A push that failed part-way leaves
    /// `syncedUpdatedAt` behind `updatedAt`, which is what makes it retry.
    static func needsPush(_ release: Release) -> Bool {
        guard let synced = release.syncedUpdatedAt else { return true }
        return synced < release.updatedAt
    }

    /// A record this very device wrote, seen again on a pull.
    private func isOwnEcho(_ record: SyncRecord) -> Bool {
        record.origin == "ios" && record.originDevice == deviceName()
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

    /// `name` came off the network in a record. It is written under `dir`,
    /// so only a plain child name is accepted (`ReleaseLayout.isPlainFileName`,
    /// then `isInside`), or a `../x` would land, and via `downloadFile`'s
    /// replace, destroy, a file outside the download directory.
    private func downloadFile(releaseId: String, name: String, into dir: URL) async throws {
        guard ReleaseLayout.isPlainFileName(name) else {
            throw LocallyError.importFailed("A file in that release has a name Locally won't use.")
        }
        let destination = dir.appendingPathComponent(name)
        guard ReleaseLayout().isInside(folder: dir, path: destination.path) else {
            throw LocallyError.pathOutsideFolder
        }
        let url = try await api.downloadURL(releaseId: releaseId, fileName: name)
        try await api.downloadFile(from: url, to: destination)
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
