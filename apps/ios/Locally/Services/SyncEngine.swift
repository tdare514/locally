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
///
/// Both methods are `nonisolated` because `ReleaseCoordinator` (and its
/// caller, a view action) is not itself on `SyncEngine`'s main actor.
protocol ReleaseSyncHook: AnyObject {
    /// Fire-and-forget: enqueue `release` for push if signed in. Never
    /// throws — a sync failure must never surface as a failure of the
    /// user's own action.
    func pushAfterChange(_ release: Release)
    /// Fire-and-forget: enqueue `id` for tombstone if signed in.
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
/// call concurrently with itself: `reconcile()` and `drainOutbox()` each
/// await an in-flight run of themselves rather than starting a second one,
/// and `push`/`tombstone` never throw — every failure lands on
/// `status.lastError` instead, so a sync problem never blocks or fails the
/// user's own action.
///
/// The engine is `@MainActor`, which is what makes the above safe: every
/// method runs on the main actor, so `reconcileTask`/`drainTask` and
/// `SyncStatus`'s mutable state can never be touched from two threads at
/// once. What actually queues a change is a persistent `SyncOutbox` (#19):
/// `pushAfterChange`/`pushTombstone` (called from `ReleaseCoordinator`,
/// which is not itself main-actor-isolated, so they're `nonisolated`) hop to
/// the main actor, enqueue, and only then start draining — enqueuing first
/// means the work survives even if the app is killed or the network call
/// that follows never completes. A delete queued while a push for the same
/// release is in flight is never clobbered by that push finishing: see
/// `SyncOutbox`'s doc comment for the enqueue/remove rules that guarantee
/// that.
///
/// `updateIfPresent` is still used everywhere a write follows an `await`
/// (`markPushed`, the own-echo branch in `process(_:)`): the engine awaits
/// across user actions (an import, an edit, a delete can all happen while a
/// push or reconcile is mid-flight), so a write that lands after such an
/// action finished must never resurrect a release the user just deleted.
@MainActor
final class SyncEngine: ReleaseSyncHook {
    private let api: SyncApi
    private let account: SyncAccountStore
    private let library: LibraryStore
    private let coordinator: ReleaseCoordinator
    private let coverStore: CoverStore
    private let outbox: SyncOutbox
    private let deviceName: () -> String
    private let reconcileInterval: Duration
    private let reconcileSleep: @Sendable (Duration) async throws -> Void

    let status: SyncStatus

    private var reconcileTask: Task<Void, Never>?
    private var drainTask: Task<Void, Never>?

    /// Runs `reconcile()` on a timer while the app is foregrounded. Built
    /// lazily so its `tick` closure can capture `self` after the rest of
    /// `init` has finished.
    private lazy var scheduler = ReconcileScheduler(
        interval: reconcileInterval,
        sleep: reconcileSleep
    ) { [weak self] in await self?.reconcile() }

    init(
        api: SyncApi,
        account: SyncAccountStore,
        library: LibraryStore,
        coordinator: ReleaseCoordinator,
        coverStore: CoverStore,
        outbox: SyncOutbox,
        status: SyncStatus = SyncStatus(),
        reconcileInterval: Duration = .seconds(30),
        reconcileSleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        deviceName: @escaping () -> String
    ) {
        self.api = api
        self.account = account
        self.library = library
        self.coordinator = coordinator
        self.coverStore = coverStore
        self.outbox = outbox
        self.status = status
        self.reconcileInterval = reconcileInterval
        self.reconcileSleep = reconcileSleep
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
    /// account state, including any queued sync work: a delete or push
    /// still waiting in the outbox must never go out under a different
    /// account the user signs into next.
    func signOut() async {
        if let deviceId = account.deviceId {
            try? await api.revokeDevice(deviceId)
        }
        clearLocalAccountState()
    }

    /// `DELETE /v1/me`, confirmed by the settings UI beforehand. On success,
    /// or on `.unauthorized` (the account or this device's token is already
    /// gone), the account is treated as deleted: local state is cleared the
    /// same way `signOut` clears it, and every release's sync markers are
    /// reset so a later sign-in to a different account re-pushes everything
    /// rather than believing the server already has it. Any other failure
    /// (offline, server error) leaves the account, outbox and markers in
    /// place and surfaces on `status.lastError`, like any other sync
    /// failure. Returns whether the account was deleted.
    @discardableResult
    func deleteAccount() async -> Bool {
        guard let email = account.email else { return false }
        do {
            try await api.deleteAccount(email: email)
        } catch SyncApiError.unauthorized {
            clearLocalAccountState()
            return true
        } catch {
            status.lastError = error.localizedDescription
            return false
        }
        clearLocalAccountState()
        return true
    }

    /// The local half of signing out: clears the stored account, the
    /// outbox, `status`, and every release's sync markers (`signOut` and
    /// `deleteAccount` both end here). Never talks to the server.
    private func clearLocalAccountState() {
        account.clear()
        try? outbox.removeAll()
        try? library.clearSyncMarkers()
        status.signedIn = false
        status.email = nil
        status.deviceName = nil
        status.pendingFromMac = []
        status.failedAcceptIds = []
        status.quota = nil
        status.lastError = nil
    }

    // MARK: - Auto-reconcile

    func startAutoReconcile() {
        scheduler.start()
    }

    func stopAutoReconcile() {
        scheduler.stop()
    }

    // MARK: - ReleaseSyncHook

    nonisolated func pushAfterChange(_ release: Release) {
        Task { @MainActor [weak self] in
            guard let self, self.isSignedIn else { return }
            try? self.outbox.enqueue(release.id, .push)
            await self.drainOutbox()
        }
    }

    nonisolated func pushTombstone(_ id: UUID) {
        Task { @MainActor [weak self] in
            guard let self, self.isSignedIn else { return }
            try? self.outbox.enqueue(id, .delete)
            await self.drainOutbox()
        }
    }

    // MARK: - Push / tombstone entry points

    /// Enqueues `release` for push (if signed in) and drains the outbox.
    /// Existing callers (tests, `verify`'s implicit back-fill via
    /// `reconcile`) still call this directly.
    func push(_ release: Release) async {
        guard isSignedIn else { return }
        try? outbox.enqueue(release.id, .push)
        await drainOutbox()
    }

    /// Enqueues `id` for tombstone (if signed in) and drains the outbox.
    func tombstone(_ id: UUID) async {
        guard isSignedIn else { return }
        try? outbox.enqueue(id, .delete)
        await drainOutbox()
    }

    // MARK: - Outbox draining

    /// Sends every entry currently in the outbox, coalescing with any drain
    /// already running rather than starting a second one — a caller that
    /// enqueues while a drain is in flight just awaits that same run, and
    /// the drain loop itself re-reads the outbox on every iteration, so an
    /// entry enqueued mid-drain is still picked up before this call returns.
    func drainOutbox() async {
        if let existing = drainTask {
            await existing.value
            return
        }
        // Cleared inside the task, in the same main-actor turn the loop
        // exits: clearing it after `await task.value` would leave a window
        // where a new caller awaits an already-finished drain and its
        // freshly enqueued entry waits for the next `reconcile()`.
        let task = Task { [weak self] in
            guard let self else { return }
            await self.runDrainLoop()
            self.drainTask = nil
        }
        drainTask = task
        await task.value
    }

    /// Sends the first not-yet-attempted-this-pass entry, re-reading the
    /// outbox after every send. An entry that fails once is left for the
    /// *next* drain (or the next `reconcile()`), not retried again in this
    /// same pass — its `lastError`/`attempts` already reflect the failure.
    private func runDrainLoop() async {
        var attemptedThisPass: Set<UUID> = []
        while true {
            guard let entries = try? outbox.all() else { break }
            guard let entry = entries.first(where: { !attemptedThisPass.contains($0.releaseId) }) else { break }
            attemptedThisPass.insert(entry.releaseId)
            await send(entry)
        }
    }

    private func send(_ entry: SyncOutboxEntry) async {
        switch entry.operation {
        case .delete:
            await sendDelete(entry.releaseId)
        case .push:
            await sendPush(entry.releaseId)
        }
    }

    private func sendDelete(_ id: UUID) async {
        do {
            try await api.deleteRelease(id.uuidString)
            try? outbox.remove(id, ifOperation: .delete)
            status.lastError = nil
        } catch {
            try? outbox.recordFailure(id, error: error.localizedDescription)
            status.lastError = error.localizedDescription
        }
    }

    /// Looks the release up fresh (it may have changed, or vanished, since
    /// it was enqueued) rather than carrying a snapshot in the outbox entry.
    private func sendPush(_ id: UUID) async {
        let localReleases = (try? library.all()) ?? []
        guard let release = localReleases.first(where: { $0.id == id }) else {
            // Deleted before this entry was drained: nothing to push, and
            // the delete itself either already went out or has its own
            // `.delete` entry queued — either way this stale `.push` entry
            // is simply dropped.
            try? outbox.remove(id, ifOperation: .push)
            return
        }
        do {
            try await pushInternal(release)
            try? outbox.remove(id, ifOperation: .push)
            status.lastError = nil
        } catch {
            try? outbox.recordFailure(id, error: error.localizedDescription)
            status.lastError = error.localizedDescription
        }
    }

    /// `PUT`s the record, then uploads any of `release`'s files the server
    /// doesn't already have. The record goes first: the service's
    /// `POST /v1/releases/:id/files` 404s until the release row exists, so
    /// requesting upload URLs before the `PUT` would always fail. A `409`
    /// on the `PUT` (someone else wrote this release first) fetches the
    /// remote changes to pull that change in, then re-submits this device's
    /// record with a fresh `updatedAt` so it still wins — this device's own
    /// coordinator just finished this change a moment ago, so it is, by
    /// construction, the newer intent.
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
            let cover = coverUpload(for: release)
            record.cover = cover?.name
            // The hash is the change signal the other side compares against
            // its own local cover's hash (see `applyRemoteUpdate` below); it
            // is not what decides whether the cover gets re-uploaded here —
            // `uploadFiles` does that from `release.uploadedFileNames`. A
            // local cover replace makes `ReleaseCoordinator` drop the
            // cover's name from `uploadedFileNames`, which is what makes the
            // next push upload the new bytes.
            // `try?`: a cover that cannot be read is sent without a hash (no
            // change signal) rather than failing the whole push, in the same
            // spirit as the missing-cover case above.
            record.coverHash = cover.flatMap { (try? Data(contentsOf: $0.url))?.sha256Hex }

            do {
                try await api.putRelease(record)
            } catch SyncApiError.conflict {
                try await fetchRemoteChanges()
                record.updatedAt = Date()
                try await api.putRelease(record)
            }

            let uploaded = try await uploadFiles(release: release, record: record, files: files, cover: cover)
            markPushed(release, at: record.updatedAt, uploaded: uploaded)
        }
    }

    /// The cover file the push uploads for `release`, and the name it goes up
    /// under, or `nil` when the release has no cover or the store can't find
    /// its file (in which case the push leaves the cover out of the record).
    /// Resolved by id, not `coverPath` (see `CoverStore.fileURL`).
    private func coverUpload(for release: Release) -> (url: URL, name: String)? {
        guard release.coverPath != nil, let url = coverStore.fileURL(release.id) else { return nil }
        return (url, "cover.\(url.pathExtension)")
    }

    /// Requests tickets only for files not already in `release.uploadedFileNames`,
    /// uploads each, and returns the updated set of names the server holds.
    /// Persists progress after every single success (`recordUploaded`), so a
    /// crash or dropped connection mid-album leaves the next retry with only
    /// the remaining files to upload, not the whole release again. The first
    /// failure stops the push (as the Mac's `pushOne` does): on a flaky link
    /// carrying on would stack one timeout per remaining file, and the
    /// retry picks up exactly where this left off anyway.
    private func uploadFiles(release: Release, record: SyncRecord, files: [(track: Track, url: URL)], cover: (url: URL, name: String)?) async throws -> Set<String> {
        var uploaded = Set(release.uploadedFileNames)

        var localPathByName: [String: URL] = [:]
        var requests: [SyncFileUploadRequest] = []
        for entry in files {
            let name = entry.url.lastPathComponent
            guard !uploaded.contains(name) else { continue }
            localPathByName[name] = entry.url
            requests.append(SyncFileUploadRequest(
                name: name,
                bytes: Self.fileSize(at: entry.url),
                contentType: Self.contentType(forExtension: entry.url.pathExtension)
            ))
        }
        if let cover, !uploaded.contains(cover.name) {
            localPathByName[cover.name] = cover.url
            requests.append(SyncFileUploadRequest(name: cover.name, bytes: Self.fileSize(at: cover.url), contentType: Self.contentType(forExtension: (cover.name as NSString).pathExtension)))
        }

        guard !requests.isEmpty else { return uploaded }
        let uploads = try await api.requestUploads(releaseId: record.id, files: requests)
        // A requested name the server returns no ticket for is already held
        // by the server (that is what the fake and web's contract mean by
        // omitting it); recording it here keeps `needsPush` from retrying it
        // every reconcile forever.
        let requestedNames = Set(requests.map(\.name))
        let ticketedNames = Set(uploads.map(\.name))
        for name in requestedNames.subtracting(ticketedNames) {
            uploaded.insert(name)
            recordUploaded(name, for: release.id)
        }
        for upload in uploads {
            guard let localURL = localPathByName[upload.name] else { continue }
            try await api.uploadFile(localURL, to: upload)
            uploaded.insert(upload.name)
            recordUploaded(upload.name, for: release.id)
        }
        return uploaded
    }

    /// Records `name` as held by the server on the stored copy of the release
    /// (re-read, so a title edit made while the upload ran isn't overwritten).
    /// Update-only for the same reason as `markPushed`.
    private func recordUploaded(_ name: String, for id: UUID) {
        guard var current = ((try? library.all()) ?? []).first(where: { $0.id == id }) else { return }
        guard !current.uploadedFileNames.contains(name) else { return }
        current.uploadedFileNames.append(name)
        _ = try? library.updateIfPresent(current)
    }

    /// Marks `release` as pushed (see `Release.syncedUpdatedAt`) so
    /// back-fill never re-pushes it until it changes again. Update-only:
    /// the uploads above took a while, and if the user deleted this release
    /// in the meantime an `upsert` would re-create its index row with the
    /// files already gone. The delete's tombstone is the server's newest
    /// word on it, so there is nothing to mark.
    private func markPushed(_ release: Release, at updatedAt: Date, uploaded: Set<String>) {
        var pushed = release
        pushed.updatedAt = updatedAt
        pushed.syncedUpdatedAt = updatedAt
        pushed.uploadedFileNames = Array(uploaded).sorted()
        _ = try? library.updateIfPresent(pushed)
    }

    // MARK: - Reconcile

    /// Back-fills unpushed releases, drains the outbox, retries any pending
    /// cover downloads, fetches and applies remote changes
    /// (`GET /v1/releases?sinceVersion=<last seen>`), retries pending
    /// accepts, and refreshes quota. Coalesces with any run already in
    /// progress rather than queuing a second one — a caller that reconciles
    /// while one is in flight just awaits that same run.
    func reconcile() async {
        guard isSignedIn else { return }
        if let existing = reconcileTask {
            await existing.value
            return
        }
        // Cleared inside the task for the same reason as `drainTask`.
        let task = Task { [weak self] in
            guard let self else { return }
            await self.runReconcile()
            self.reconcileTask = nil
        }
        reconcileTask = task
        await task.value
    }

    private func runReconcile() async {
        do {
            // Back-filling first means a release pushed just now is already
            // reflected in the very next fetch below, so `lastVersion`
            // converges in this one pass rather than lagging a cycle.
            await backfillUnpushed()
            await drainOutbox()
            // Retried before the fetch below, not after: a cover download
            // that fails during this run's own `process(_:)` loop is left
            // pending for the *next* `reconcile()` (see
            // `SyncStatus.failedCoverUpdates`), not retried again inside
            // this same run.
            await retryFailedCoverUpdates()

            try await fetchRemoteChanges()

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

    /// Fetches one page of remote changes since `account.lastVersion` and
    /// applies each (see `process(_:)`), advancing `account.lastVersion`.
    /// Split out of `reconcile()` so `pushInternal`'s 409 path can pull in
    /// the conflicting change without going through `reconcile()` itself —
    /// that would otherwise wait on the very drain that's calling it.
    private func fetchRemoteChanges() async throws {
        let page = try await api.releases(sinceVersion: account.lastVersion)
        for record in page.releases {
            await process(record)
        }
        account.lastVersion = page.nextVersion
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
                _ = try? library.updateIfPresent(caughtUp)
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

    /// Enqueues every local release that has never been fully pushed (see
    /// `needsPush`) — the "songs already on this phone before you signed in"
    /// back-fill `spec/sync.md` describes, and the retry for pushes that
    /// failed part-way. `outbox.enqueue` is itself a no-op when an entry for
    /// that id already exists, so this never disturbs a `.delete` (or an
    /// already-queued `.push`) sitting in the outbox.
    private func backfillUnpushed() async {
        let localReleases = (try? library.all()) ?? []
        for release in localReleases where needsPush(release) {
            try? outbox.enqueue(release.id, .push)
        }
    }

    private func needsPush(_ release: Release) -> Bool {
        Self.needsPush(release, coverName: coverUpload(for: release)?.name)
    }

    /// The names a push of `release` uploads: each track's file name plus
    /// `coverName` (the name `coverUpload(for:)` resolves) when there is one.
    static func expectedUploadNames(of release: Release, coverName: String?) -> Set<String> {
        var names = Set(release.tracks.map { ($0.filePath as NSString).lastPathComponent })
        if let coverName { names.insert(coverName) }
        return names
    }

    /// Never pushed, changed since the last push that fully completed
    /// (record and files), or holding a file the server hasn't confirmed
    /// (see `Release.uploadedFileNames`). A push that failed part-way leaves
    /// `syncedUpdatedAt` behind `updatedAt`, which is what makes it retry;
    /// a release stored before `uploadedFileNames` existed has an empty set,
    /// so it is re-verified once and then settles.
    static func needsPush(_ release: Release, coverName: String?) -> Bool {
        guard let synced = release.syncedUpdatedAt else { return true }
        if synced < release.updatedAt { return true }
        return !expectedUploadNames(of: release, coverName: coverName).isSubset(of: release.uploadedFileNames)
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
            markPushed(release, at: release.updatedAt, uploaded: Set(release.uploadedFileNames))
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
