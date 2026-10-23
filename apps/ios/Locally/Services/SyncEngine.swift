import Foundation
import os

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
    /// Records from another device (the Mac, the web, ...) not yet in this
    /// device's library, offered in the Import tab's "From your devices" toast.
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
    /// Shares friends sent this account that are not yet claimed (#183), offered in the Library tray's
    /// "From your friends" section. Refreshed on every reconcile from `GET /v1/shares?role=received`.
    var receivedShares: [ReceivedShare] = []
    /// Share ids being sent to Spotify now, and ones whose last send failed (kept in the tray, with
    /// their own retry, even after the server marks them claimed).
    var acceptingShareIds: Set<String> = []
    var failedShareIds: Set<String> = []
    /// The downloaded cover bytes of the shares in `receivedShares`, by share id (each downloaded once).
    var shareCoverData: [String: Data] = [:]
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
    private let now: () -> Date
    private let defaults: UserDefaults
    private let shareCovers: ShareCoverCache?

    let status: SyncStatus

    private var reconcileTask: Task<Void, Never>?
    private var drainTask: Task<Void, Never>?
    /// The last problem `surface(_:)` reported since the current reconcile
    /// began, so a later successful send or the end-of-run reset can't wipe
    /// it with `nil`.
    private var reconcileIssue: String?

    private static let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "Locally", category: "sync")

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
        now: @escaping () -> Date = { Date() },
        deviceName: @escaping () -> String,
        defaults: UserDefaults = .standard,
        shareCovers: ShareCoverCache? = nil
    ) {
        self.defaults = defaults
        self.shareCovers = shareCovers
        self.api = api
        self.account = account
        self.library = library
        self.coordinator = coordinator
        self.coverStore = coverStore
        self.outbox = outbox
        self.status = status
        self.reconcileInterval = reconcileInterval
        self.reconcileSleep = reconcileSleep
        self.now = now
        self.deviceName = deviceName
        status.signedIn = account.deviceToken != nil
        status.email = account.email
        status.deviceName = account.deviceName
        if account.deviceToken != nil { restoreSyncQueues() }
    }

    // MARK: - Persisted queues

    static let pendingFromMacKey = "com.tdare.locally.sync.pendingFromMac.v1"
    static let failedCoverUpdatesKey = "com.tdare.locally.sync.failedCoverUpdates.v1"

    /// Brings back the tray and the failed covers after a restart. The pull
    /// cursor has moved past these records, so nothing else would re-offer
    /// them. A blob that does not decode is removed, never fatal. Pending
    /// entries already in the library are dropped.
    private func restoreSyncQueues() {
        let decoder = JSONDecoder.syncApi
        if let data = defaults.data(forKey: Self.pendingFromMacKey) {
            if let records = try? decoder.decode([SyncRecord].self, from: data) {
                let localIds = Set((try? library.all())?.map { $0.id.uuidString.lowercased() } ?? [])
                status.pendingFromMac = records.filter { !localIds.contains($0.id.lowercased()) }
            } else {
                defaults.removeObject(forKey: Self.pendingFromMacKey)
            }
        }
        if let data = defaults.data(forKey: Self.failedCoverUpdatesKey) {
            if let records = try? decoder.decode([String: SyncRecord].self, from: data) {
                status.failedCoverUpdates = records
            } else {
                defaults.removeObject(forKey: Self.failedCoverUpdatesKey)
            }
        }
    }

    /// Writes both lists to `defaults`; an empty list removes its key. Called
    /// wherever the engine changes either list (not a `didSet`, so a bare
    /// `SyncStatus` such as the component gallery's never persists).
    private func persistSyncQueues() {
        let encoder = JSONEncoder.syncApi
        if status.pendingFromMac.isEmpty {
            defaults.removeObject(forKey: Self.pendingFromMacKey)
        } else if let data = try? encoder.encode(status.pendingFromMac) {
            defaults.set(data, forKey: Self.pendingFromMacKey)
        }
        if status.failedCoverUpdates.isEmpty {
            defaults.removeObject(forKey: Self.failedCoverUpdatesKey)
        } else if let data = try? encoder.encode(status.failedCoverUpdates) {
            defaults.set(data, forKey: Self.failedCoverUpdatesKey)
        }
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
        account.deviceName = result.deviceName
        account.userId = result.userId
        // Another account's shares never carry over (its persisted ids stay under its own key).
        resetShareState(persisted: false)
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
            // Best-effort: offline must not stop the user signing out.
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
            clearLocalAccountState(forgetShares: true)
            return true
        } catch {
            status.lastError = error.localizedDescription
            return false
        }
        clearLocalAccountState(forgetShares: true)
        return true
    }

    /// The local half of signing out: clears the stored account (including
    /// the persisted device name), the outbox, `status`, and every release's
    /// sync markers (`signOut` and `deleteAccount` both end here). Never
    /// talks to the server.
    private func clearLocalAccountState(forgetShares: Bool = false) {
        // An ordinary sign-out keeps the imported and owed-claim ids (under the account-and-host key), so
        // signing back in does not offer a share again whose release is still here; deleting the account
        // forgets them.
        resetShareState(persisted: forgetShares)
        account.clear()
        // A failure here would let queued work go out under the next account,
        // or leave markers that stop a new account re-pushing everything, so
        // it is surfaced (after the status reset below) rather than dropped.
        var cleanupFailure: Error?
        do { try outbox.removeAll() } catch { cleanupFailure = error }
        do { try library.clearSyncMarkers() } catch { cleanupFailure = error }
        status.signedIn = false
        status.email = nil
        status.deviceName = nil
        status.pendingFromMac = []
        status.failedCoverUpdates = [:]
        defaults.removeObject(forKey: Self.pendingFromMacKey)
        defaults.removeObject(forKey: Self.failedCoverUpdatesKey)
        status.failedAcceptIds = []
        status.quota = nil
        status.lastError = nil
        if let cleanupFailure {
            surface(Copy.Sync.signOutCleanupFailed(cleanupFailure.localizedDescription), error: cleanupFailure)
        }
    }

    /// Logs `error` and shows `message` on `status.lastError`. Also kept in
    /// `reconcileIssue` so a reconcile that carries on past the problem still
    /// ends with it visible.
    private func surface(_ message: String, error: Error) {
        Self.log.error("\(message, privacy: .public): \(String(describing: error), privacy: .public)")
        status.lastError = message
        reconcileIssue = message
    }

    /// Enqueues `id` for `operation`. A failure is surfaced, not swallowed:
    /// the change would otherwise never reach the server. Callers still
    /// drain, since other entries may be waiting.
    @discardableResult
    private func enqueue(_ id: UUID, _ operation: SyncOutboxEntry.Operation) -> Bool {
        do {
            try outbox.enqueue(id, operation)
            return true
        } catch {
            surface(Copy.Sync.queueFailed(error.localizedDescription), error: error)
            return false
        }
    }

    /// Every local release, or `nil` after surfacing the failure. An empty
    /// list must never stand in for an unreadable library: callers would
    /// offer everything as new, skip tombstones, or drop pending work.
    private func localReleases() -> [Release]? {
        do {
            return try library.all()
        } catch {
            surface(Copy.Sync.libraryUnreadable(error.localizedDescription), error: error)
            return nil
        }
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
            guard let self, self.isSignedIn, !release.isAdopted else { return }
            self.enqueue(release.id, .push)
            await self.drainOutbox()
        }
    }

    nonisolated func pushTombstone(_ id: UUID) {
        Task { @MainActor [weak self] in
            guard let self, self.isSignedIn else { return }
            self.enqueue(id, .delete)
            await self.drainOutbox()
        }
    }

    // MARK: - Push / tombstone entry points

    /// Enqueues `release` for push (if signed in) and drains the outbox.
    /// Existing callers (tests, `verify`'s implicit back-fill via
    /// `reconcile`) still call this directly.
    func push(_ release: Release) async {
        guard isSignedIn, !release.isAdopted else { return }
        enqueue(release.id, .push)
        await drainOutbox()
    }

    /// Enqueues `id` for tombstone (if signed in) and drains the outbox.
    func tombstone(_ id: UUID) async {
        guard isSignedIn else { return }
        enqueue(id, .delete)
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
            let entries: [SyncOutboxEntry]
            do {
                entries = try outbox.all()
            } catch {
                surface(Copy.Sync.queueFailed(error.localizedDescription), error: error)
                break
            }
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
            // Best-effort: the server confirmed; a leftover entry only retries an idempotent delete.
            try? outbox.remove(id, ifOperation: .delete)
            status.lastError = reconcileIssue
        } catch {
            // Best-effort: attempts/lastError bookkeeping only; the entry stays queued either way.
            try? outbox.recordFailure(id, error: error.localizedDescription)
            status.lastError = error.localizedDescription
        }
    }

    /// Looks the release up fresh (it may have changed, or vanished, since
    /// it was enqueued) rather than carrying a snapshot in the outbox entry.
    private func sendPush(_ id: UUID) async {
        // Unreadable library: leave the entry queued for the next drain.
        guard let localReleases = localReleases() else { return }
        guard let release = localReleases.first(where: { $0.id == id }) else {
            // Deleted before this entry was drained: nothing to push, and
            // the delete itself either already went out or has its own
            // `.delete` entry queued — either way this stale `.push` entry
            // is simply dropped.
            // Best-effort: a leftover stale entry is dropped again next drain.
            try? outbox.remove(id, ifOperation: .push)
            return
        }
        // This phone doesn't own an adopted release: never push it.
        if release.isAdopted {
            try? outbox.remove(id, ifOperation: .push)
            return
        }
        do {
            try await pushInternal(release)
            // Best-effort: the server confirmed; a leftover entry only retries an idempotent push.
            try? outbox.remove(id, ifOperation: .push)
            status.lastError = reconcileIssue
        } catch {
            // Best-effort: attempts/lastError bookkeeping only; the entry stays queued either way.
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
        // Best-effort: if this can't be read or written the file is simply re-uploaded next push.
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
        // Best-effort: an unmarked release is just pushed again (idempotent).
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
        reconcileIssue = nil
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

            // One-off (#276, folds in #266's v1): re-pull from 0 once on every
            // phone, whatever its covers, so the tray and any missing adopted
            // covers come back on phones whose cursor is already past them.
            // `process(_:)` re-applies only adopted records that are newer or
            // lack a cover, skips other records that are not newer, and offers
            // non-ios records missing locally. The flags are set only after the
            // pull succeeds, so an interrupted pull tries again next reconcile.
            let fullRefetch = !defaults.bool(forKey: Self.fullRefetchKey)
            try await fetchRemoteChanges(fromVersion: fullRefetch ? 0 : nil)
            if fullRefetch {
                defaults.set(true, forKey: Self.fullRefetchKey)
                defaults.set(true, forKey: Self.adoptedCoverRefetchKey)
            }

            await retryFailedAccepts()
            await refreshReceivedShares()

            // Re-check after the await: a sign-out or account delete that
            // ran while `me()` was in flight has already cleared the
            // account, and nothing from this response may be written back.
            // Best-effort: quota display only.
            let me = try? await api.me()
            if let me, isSignedIn {
                status.quota = me.quota
                if account.deviceName == nil {
                    account.deviceName = me.deviceName
                    status.deviceName = me.deviceName
                }
            }

            await healMissingFiles(resyncRequestedAt: me?.resyncRequestedAt)

            status.lastRunAt = Date()
            // Don't stomp on an accept retry's own error message with `nil`
            // when one is still pending.
            if let reconcileIssue {
                status.lastError = reconcileIssue
            } else if status.failedAcceptIds.isEmpty {
                status.lastError = nil
            }
        } catch {
            status.lastError = error.localizedDescription
        }
    }

    /// How long a successful `GET /v1/files/missing` check holds off the next
    /// one (the endpoint is rate-limited and lists blob storage, which is a
    /// priced call). A newer `resyncRequestedAt` from the Mac skips the wait.
    private static let missingFilesCheckSpacing: TimeInterval = 6 * 60 * 60

    /// Self-heal for releases whose record reached the server but whose files
    /// did not (#171, `docs/plans/119-missing-files.md`). At most every 6 hours,
    /// or at once when `/v1/me` reports a `resyncRequestedAt` newer than the
    /// last check, asks the server which file names it never stored. For each
    /// listed release this phone owns, drops exactly those names from
    /// `uploadedFileNames` and queues one push; the partial-upload logic in
    /// `uploadFiles` then sends only those files. Names the server holds are
    /// never touched, so nothing it already has is uploaded again.
    ///
    /// Quiet by design: a 404 (an API that predates the route) is skipped and
    /// not retried for 6 hours, and a 429 or any other failed check is skipped
    /// and retried on the next reconcile without moving the timestamp. None of
    /// those reach `status.lastError`. Only a failure to write the markers or
    /// queue the push does, as for any other local sync write.
    private func healMissingFiles(resyncRequestedAt: Date?) async {
        guard isSignedIn else { return }
        let checkedAt = now()
        let last = account.lastMissingFilesCheckAt
        let spacingElapsed = last.map { checkedAt.timeIntervalSince($0) >= Self.missingFilesCheckSpacing } ?? true
        let nudged: Bool
        if let last, let resyncRequestedAt { nudged = resyncRequestedAt > last } else { nudged = false }
        guard spacingElapsed || nudged else { return }

        let result: SyncMissingFiles
        do {
            result = try await api.missingFiles()
        } catch SyncApiError.notFound {
            Self.log.info("Missing-files check unavailable: the sync server doesn't have the route yet.")
            // Not an error and not worth asking again every reconcile.
            account.lastMissingFilesCheckAt = checkedAt
            return
        } catch SyncApiError.rateLimited {
            Self.log.info("Missing-files check rate limited; trying again on the next reconcile.")
            return
        } catch {
            Self.log.error("Missing-files check failed: \(String(describing: error), privacy: .public)")
            return
        }
        // A sign-out that ran while the call was in flight has already cleared the account.
        guard isSignedIn else { return }

        var queued = 0
        if !result.releases.isEmpty {
            // Unreadable library: already surfaced; leave the timestamp so the next reconcile retries.
            guard let localReleases = localReleases() else { return }
            let localById = Dictionary(localReleases.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            for entry in result.releases {
                guard let id = UUID(uuidString: entry.id), let local = localById[id] else {
                    Self.log.info("Missing-files list names release \(entry.id, privacy: .public), which this phone doesn't have; leaving it.")
                    continue
                }
                if local.isAdopted { continue }
                if requeueMissingFiles(of: local, names: Set(entry.missing)) { queued += 1 }
            }
        }
        // `max` with the nudge: the Mac's clock and this phone's can differ, and
        // a nudge that is still "newer" than the stored time would re-run this
        // on every reconcile.
        account.lastMissingFilesCheckAt = max(checkedAt, resyncRequestedAt ?? checkedAt)
        if queued > 0 { await drainOutbox() }
    }

    /// Removes `names` (and only those) from `release`'s "server holds" markers
    /// and queues one push. False when the release is gone from the index or
    /// the marker write failed (nothing is queued then: with the markers
    /// unchanged a push would upload nothing).
    private func requeueMissingFiles(of release: Release, names: Set<String>) -> Bool {
        var cleared = release
        cleared.uploadedFileNames.removeAll { names.contains($0) }
        if cleared.uploadedFileNames.count != release.uploadedFileNames.count {
            do {
                // Update-only, like `markPushed`: a release deleted meanwhile must not come back.
                guard try library.updateIfPresent(cleared) else { return false }
            } catch {
                surface(Copy.Sync.queueFailed(error.localizedDescription), error: error)
                return false
            }
        }
        return enqueue(release.id, .push)
    }

    /// The most pages `fetchRemoteChanges` pulls in one `reconcile()`, as a
    /// guard against a misbehaving or hostile server whose `nextVersion`
    /// never advances while it keeps claiming `hasMore` — see
    /// `docs/plans/30-sync-pagination.md`.
    private static let maxReleasePagesPerReconcile = 100

    /// Fetches every page of remote changes since `account.lastVersion` and
    /// applies each (see `process(_:)`), advancing `account.lastVersion`
    /// after every page so an interruption resumes from the last one
    /// applied. Split out of `reconcile()` so `pushInternal`'s 409 path can
    /// pull in the conflicting change without going through `reconcile()`
    /// itself — that would otherwise wait on the very drain that's calling
    /// it.
    private func fetchRemoteChanges(fromVersion: Int? = nil) async throws {
        var cursor = fromVersion ?? account.lastVersion
        for _ in 0..<Self.maxReleasePagesPerReconcile {
            let page = try await api.releases(sinceVersion: cursor, limit: syncReleasesPageLimit)
            for record in page.releases {
                try await process(record)
            }
            // Only a pulled page's `nextVersion` may write `lastVersion`
            // (the #37 invariant); persisted after every page, not just the
            // last, so a later interruption resumes from here with whatever
            // was already applied.
            account.lastVersion = page.nextVersion

            guard page.hasMore else { return }
            if page.nextVersion <= cursor {
                throw SyncApiError.network("Sync pull stalled: the server reported more releases without advancing the cursor.")
            }
            cursor = page.nextVersion
        }
        throw SyncApiError.network("Sync pull did not finish after \(Self.maxReleasePagesPerReconcile) pages; stopping this reconcile.")
    }

    /// The v1 flag (#266). No longer read; still set with v2 so it stays true.
    static let adoptedCoverRefetchKey = "com.tdare.locally.sync.adoptedCoverRefetch.v1"

    /// The v2 one-off full re-pull flag (#276). Set together with the v1 key.
    static let fullRefetchKey = "com.tdare.locally.sync.fullRefetch.v2"

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
        defer { persistSyncQueues() }
        let pending = status.failedCoverUpdates
        // Unreadable library: keep everything pending rather than dropping it as "gone".
        guard let localReleases = localReleases() else { return }
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

    /// Throws only when the library can't be read, which stops the fetch
    /// before `account.lastVersion` advances past this page, so the page is
    /// pulled again next reconcile instead of being misapplied.
    private func process(_ record: SyncRecord) async throws {
        guard let recordId = UUID(uuidString: record.id) else { return }
        defer { persistSyncQueues() }
        let localReleases: [Release]
        do {
            localReleases = try library.all()
        } catch {
            Self.log.error("Library unreadable while applying a pulled record: \(String(describing: error), privacy: .public)")
            throw error
        }
        let existingLocal = localReleases.first { $0.id == recordId }

        if record.deleted {
            status.pendingFromMac.removeAll { $0.id == record.id }
            if existingLocal != nil {
                do {
                    try await coordinator.applyTombstone(recordId)
                } catch {
                    // The cursor still advances, so this delete is not retried
                    // automatically; the release stays until it is deleted again.
                    surface(Copy.Sync.applyRemoteFailed(error.localizedDescription), error: error)
                }
            }
            return
        }

        if let existingLocal {
            // An adopted release is re-applied when newer, or when its cover is
            // still missing locally (#266): the same `updatedAt` must not strand it.
            if existingLocal.isAdopted {
                if record.updatedAt > existingLocal.updatedAt
                    || adoptedCoverNeeded(record, existingLocal: existingLocal) {
                    await applyAdopted(record, existingLocal: existingLocal)
                }
                return
            }
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
                // Best-effort: a stale updatedAt only means this echo is seen again.
                _ = try? library.updateIfPresent(caughtUp)
            } else {
                await applyRemoteUpdate(record, existingLocal: existingLocal)
            }
            return
        }

        // An adopted record is not offered: it goes straight into the library as a
        // details-only release (no files, never the "From your devices" tray).
        if record.source == .adopted {
            status.pendingFromMac.removeAll { $0.id == record.id }
            await applyAdopted(record, existingLocal: nil)
            return
        }

        // Offered in the tray: anything this phone didn't write itself, whether it is the Mac,
        // the web, or an origin this build has never heard of (#185). Only "ios" is held back
        // (this phone's echo, or another iPhone's), the mirror of the Mac holding back "mac".
        guard record.origin != "ios" else { return }
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
        // Details only: never re-tagged, and no files written.
        if existingLocal.isAdopted {
            await applyAdopted(record, existingLocal: existingLocal)
            return
        }
        guard let coverName = record.cover, isCoverChanged(record, existingLocal: existingLocal) else {
            do {
                _ = try await coordinator.applyRemoteUpdate(record)
                status.failedCoverUpdates.removeValue(forKey: record.id)
            } catch {
                // Kept for `retryFailedCoverUpdates()`: the cursor has moved on,
                // so nothing else would bring this update back.
                status.failedCoverUpdates[record.id] = record
                surface(Copy.Sync.applyRemoteFailed(error.localizedDescription), error: error)
            }
            return
        }

        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("Locally-Sync-Cover-\(UUID().uuidString)", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
            // Best-effort temp-dir cleanup.
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

    /// Stores an adopted record as a details-only release, downloading its
    /// cover (keyed by `coverHash`, as `applyRemoteUpdate` does) when the
    /// record has one this phone lacks or that changed. No track files are
    /// fetched. If the cover download fails the details are still stored and
    /// the record joins `status.failedCoverUpdates` so the next reconcile
    /// retries the cover.
    private func applyAdopted(_ record: SyncRecord, existingLocal: Release?) async {
        var coverData: Data?
        var coverFailed = false
        if let coverName = record.cover, adoptedCoverNeeded(record, existingLocal: existingLocal) {
            let tempDir = FileManager.default.temporaryDirectory
                .appendingPathComponent("Locally-Sync-Cover-\(UUID().uuidString)", isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
                // Best-effort temp-dir cleanup.
                defer { try? FileManager.default.removeItem(at: tempDir) }
                try await downloadFile(releaseId: record.id, name: coverName, into: tempDir)
                coverData = try Data(contentsOf: tempDir.appendingPathComponent(coverName))
            } catch {
                coverFailed = true
                status.lastError = error.localizedDescription
            }
        }
        do {
            _ = try coordinator.importAdopted(record, coverData: coverData)
        } catch {
            surface(Copy.Sync.applyRemoteFailed(error.localizedDescription), error: error)
            return
        }
        if coverFailed {
            status.failedCoverUpdates[record.id] = record
        } else {
            status.failedCoverUpdates.removeValue(forKey: record.id)
        }
    }

    private func adoptedCoverNeeded(_ record: SyncRecord, existingLocal: Release?) -> Bool {
        guard record.cover != nil else { return false }
        guard let existingLocal else { return true }
        guard let remoteHash = record.coverHash else { return coverStore.load(existingLocal.id) == nil }
        return remoteHash != coverStore.load(existingLocal.id)?.sha256Hex
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
        guard let localReleases = localReleases() else { return }
        for release in localReleases where !release.isAdopted && needsPush(release) {
            enqueue(release.id, .push)
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

    /// What a tray run did, for its announcement: records added, and records that failed.
    struct AcceptRunResult: Equatable {
        var added = 0
        var failed = 0
    }

    /// Ids whose acceptance is running or reserved by a run (Add all, Try all again). A second ask
    /// for one of them, from any control, does nothing (#296), so nothing is sent twice.
    private var reservedAcceptIds: Set<String> = []

    /// Accepts one pending record. Does nothing when it is already being accepted or is reserved
    /// by a run that has not reached it yet.
    func acceptFromMac(_ recordId: String) async {
        guard !reservedAcceptIds.contains(recordId) else { return }
        reservedAcceptIds.insert(recordId)
        status.acceptingIds.insert(recordId)
        defer {
            reservedAcceptIds.remove(recordId)
            status.acceptingIds.remove(recordId)
            persistSyncQueues()
        }
        await performAccept(recordId)
    }

    /// Reserves `ids` at once, so each shows its sending look and refuses other asks at the press,
    /// then accepts them one at a time; each reservation ends when its own turn does.
    @discardableResult
    private func acceptReserved(_ ids: [String]) async -> AcceptRunResult {
        var result = AcceptRunResult()
        let mine = ids.filter { !reservedAcceptIds.contains($0) }
        reservedAcceptIds.formUnion(mine)
        status.acceptingIds.formUnion(mine)
        for recordId in mine {
            await performAccept(recordId)
            if status.pendingFromMac.contains(where: { $0.id == recordId }) { result.failed += 1 } else { result.added += 1 }
            reservedAcceptIds.remove(recordId)
            status.acceptingIds.remove(recordId)
            persistSyncQueues()
        }
        return result
    }

    /// Downloads every file `record` names into a fresh temp directory, then
    /// hands it to `ReleaseCoordinator.importSynced` to move into Spotify's
    /// folder. The temp directory is removed afterwards either way.
    private func performAccept(_ recordId: String) async {
        guard let record = status.pendingFromMac.first(where: { $0.id == recordId }) else { return }

        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("Locally-Sync-\(UUID().uuidString)", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
            // Best-effort temp-dir cleanup.
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
        await acceptReserved(status.pendingFromMac.map(\.id))
    }

    /// The ids "Add all" takes: pending, not sending (or reserved) and not failed.
    var readyAcceptIds: [String] {
        status.pendingFromMac.map(\.id).filter {
            !status.failedAcceptIds.contains($0) && !status.acceptingIds.contains($0) && !reservedAcceptIds.contains($0)
        }
    }

    /// "Add all" (#296): accepts the ready records as they are when pressed. Failed and sending
    /// ones belong to the other section and are left alone.
    @discardableResult
    func acceptReadyFromMac() async -> AcceptRunResult {
        await acceptReserved(readyAcceptIds)
    }

    /// "Try all again" (#296): retries the failed ids as they are when pressed. A record that
    /// fails again stays failed; one that becomes ready later is not picked up by this run.
    @discardableResult
    func retryFailedAcceptsFromMac() async -> AcceptRunResult {
        let snapshot = status.pendingFromMac.map(\.id).filter { status.failedAcceptIds.contains($0) }
        return await acceptReserved(snapshot)
    }

    // MARK: - Shares from friends (#183)

    private var reservedShareIds: Set<String> = []

    static let importedSharesKey = "com.tdare.locally.sync.importedShares.v1"
    static let unclaimedImportedSharesKey = "com.tdare.locally.sync.unclaimedImportedShares.v1"

    /// The account the share state belongs to: its user id, or (for a sign-in made before the id was stored)
    /// its email. `nil` when signed out.
    private var shareScope: String? {
        let who = account.userId ?? account.email.map { "email:" + $0.lowercased() }
        // The same account on another host is another account.
        return who.map { $0 + "@" + account.baseURL.absoluteString }
    }

    /// Who a share request belongs to, captured when it starts and compared when it completes, so an answer
    /// that arrives after a sign-out or a different sign-in is dropped.
    private var shareSession: String? {
        shareScope.map { $0 + "|" + (account.deviceId ?? "") }
    }

    private func scopedKey(_ base: String, scope: String?) -> String? { scope.map { base + "." + $0 } }

    private func idSet(_ base: String) -> Set<String> {
        guard let key = scopedKey(base, scope: shareScope) else { return [] }
        return Set(defaults.stringArray(forKey: key) ?? [])
    }

    /// Edits the persisted set under an explicit scope (the one captured when a request began).
    private func updateIdSet(_ base: String, scope: String, _ change: (inout Set<String>) -> Void) {
        guard let key = scopedKey(base, scope: scope) else { return }
        var set = Set(defaults.stringArray(forKey: key) ?? [])
        change(&set)
        defaults.set(set.sorted(), forKey: key)
    }

    private func setIdSet(_ base: String, _ value: Set<String>) {
        guard let key = scopedKey(base, scope: shareScope) else { return }
        defaults.set(value.sorted(), forKey: key)
    }

    /// Ids of shares this phone has imported (for this account): the tray hides them even before the claim
    /// succeeds, and across a relaunch.
    private var importedShareIds: Set<String> {
        get { idSet(Self.importedSharesKey) }
        set { setIdSet(Self.importedSharesKey, newValue) }
    }
    /// Imported shares whose `POST /claim` has not been confirmed yet; each reconcile retries them.
    private var unclaimedImportedShareIds: Set<String> {
        get { idSet(Self.unclaimedImportedSharesKey) }
        set { setIdSet(Self.unclaimedImportedSharesKey, newValue) }
    }

    /// Forgets everything about friends' shares for the current account: the tray rows, the imported and
    /// owed-claim id sets, and the cached covers. Used on sign-out, account deletion, a new sign-in and a
    /// change of sync host.
    private func resetShareState(persisted: Bool = true) {
        if persisted, let scope = shareScope {
            defaults.removeObject(forKey: Self.importedSharesKey + "." + scope)
            defaults.removeObject(forKey: Self.unclaimedImportedSharesKey + "." + scope)
        }
        status.receivedShares = []
        status.acceptingShareIds = []
        status.failedShareIds = []
        status.shareCoverData = [:]
        shareCovers?.removeAll()
    }

    /// The sync host was changed in Settings: the account store has already signed the device out, so the
    /// engine drops the share state it held (and follows the account store's signed-out state).
    func syncHostChanged(previousScope: String?) {
        if let previousScope {
            defaults.removeObject(forKey: Self.importedSharesKey + "." + previousScope)
            defaults.removeObject(forKey: Self.unclaimedImportedSharesKey + "." + previousScope)
        }
        resetShareState()
        status.signedIn = account.deviceToken != nil
        status.email = account.email
    }

    /// The scope a host change must pass to `syncHostChanged`, read before the change.
    var currentShareScope: String? { shareScope }

    /// Reads the shares sent to this account and keeps the unclaimed, not-yet-imported ones for the
    /// tray, fetches each one's cover once, then retries claims owed for shares already imported. Quiet:
    /// an API without the route, or any failure, leaves the list as it was and sets no error.
    func refreshReceivedShares() async {
        guard isSignedIn, let session = shareSession else { return }
        guard let shares = try? await api.receivedShares(), isSignedIn, shareSession == session else { return }
        let listed = Set(shares.map(\.id))
        // A share the server no longer lists (hidden, revoked, expired) needs no bookkeeping or cover.
        importedShareIds = importedShareIds.intersection(listed)
        unclaimedImportedShareIds = unclaimedImportedShareIds.intersection(listed)
        shareCovers?.prune(keeping: listed)
        let imported = importedShareIds
        status.receivedShares = shares.filter { share in
            reservedShareIds.contains(share.id) || (share.claimedAt == nil && !imported.contains(share.id))
        }
        status.failedShareIds.formIntersection(status.receivedShares.map(\.id))
        status.shareCoverData = status.shareCoverData.filter { listed.contains($0.key) }
        await fetchShareCovers(session: session)
        await retryOwedClaims(session: session)
    }

    private var coverFetches: Set<String> = []

    /// Downloads the cover of each tray share that has none cached yet. A cached cover is read from disk,
    /// never fetched again; a fetch in flight is not repeated.
    private func fetchShareCovers(session: String) async {
        guard let cache = shareCovers else { return }
        for share in status.receivedShares {
            guard let coverName = share.snapshot.cover, status.shareCoverData[share.id] == nil,
                  ReleaseLayout.isPlainFileName(coverName),
                  let destination = cache.fileURL(shareId: share.id, coverName: coverName) else { continue }
            if let data = cache.data(shareId: share.id, coverName: coverName) {
                status.shareCoverData[share.id] = data
                continue
            }
            guard !coverFetches.contains(share.id) else { continue }
            coverFetches.insert(share.id)
            defer { coverFetches.remove(share.id) }
            cache.prepareDirectory()
            do {
                let url = try await api.shareFileURL(shareId: share.id, fileName: coverName)
                try await api.downloadFile(from: url, to: destination)
                guard shareSession == session else {
                    try? FileManager.default.removeItem(at: destination)
                    return
                }
                status.shareCoverData[share.id] = try? Data(contentsOf: destination)
            } catch {
                // The row shows without its cover; the next refresh tries again.
            }
        }
    }

    private func retryOwedClaims(session: String) async {
        for id in unclaimedImportedShareIds where !reservedShareIds.contains(id) {
            do {
                _ = try await api.claimShare(id)
                guard shareSession == session else { return }
                unclaimedImportedShareIds.remove(id)
            } catch SyncApiError.notFound {
                if shareSession == session { unclaimedImportedShareIds.remove(id) }
            } catch {
                // Kept for the next reconcile.
            }
        }
    }

    /// "Send to Spotify" on a friend's share: downloads each file from the share, writes a new
    /// release (fresh ids, tagged from the snapshot) into the Spotify folder and the library, and
    /// only then claims the share. A failed download or import claims nothing and leaves the row,
    /// marked failed, for another try. A claim that fails after the import is retried on the next
    /// reconcile; the row is already hidden. If the account changes while this runs, it stops and
    /// records nothing for the new account.
    func sendShareToSpotify(_ id: String) async {
        guard let share = status.receivedShares.first(where: { $0.id == id }), !reservedShareIds.contains(id),
              let session = shareSession, let scope = shareScope else { return }
        reservedShareIds.insert(id)
        status.acceptingShareIds.insert(id)
        defer {
            reservedShareIds.remove(id)
            status.acceptingShareIds.remove(id)
        }
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("Locally-Share-\(UUID().uuidString)", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: tempDir) }
            for track in share.snapshot.tracks {
                try await downloadShareFile(shareId: id, name: track.file, into: tempDir)
            }
            if let cover = share.snapshot.cover {
                try await downloadShareFile(shareId: id, name: cover, into: tempDir)
            }
            // A different account is signed in now: this share is not theirs to import.
            guard shareSession == session else { return }
            // A new release of this account: the coordinator queues its push like any import. It carries
            // where it came from, so sharing it again goes through this share's reshare route.
            _ = try await coordinator.importShared(
                share.snapshot, dir: tempDir, isPartial: share.trackIds != nil,
                sharedFrom: SharedFrom(shareId: share.id, allowReshare: share.canReshare))
        } catch {
            guard shareSession == session else { return }
            status.failedShareIds.insert(id)
            status.lastError = error.localizedDescription
            return
        }
        // The release is in the library now. Remember it under the account and host this import started
        // for, even if the session has changed since, so signing back in does not offer the share again.
        updateIdSet(Self.importedSharesKey, scope: scope) { $0.insert(id) }
        updateIdSet(Self.unclaimedImportedSharesKey, scope: scope) { $0.insert(id) }
        // A changed session gets no UI update and no claim; the owed claim is retried at the next sign-in.
        guard shareSession == session else { return }
        status.receivedShares.removeAll { $0.id == id }
        status.failedShareIds.remove(id)
        do {
            _ = try await api.claimShare(id)
            if shareSession == session { updateIdSet(Self.unclaimedImportedSharesKey, scope: scope) { $0.remove(id) } }
        } catch {
            // Imported, so the row stays hidden; the next reconcile claims it.
        }
    }

    /// "Dismiss" on a friend's share: hides it from the tray on the server too.
    func dismissShare(_ id: String) async {
        guard !reservedShareIds.contains(id), let session = shareSession else { return }
        do {
            try await api.hideShare(id)
            guard shareSession == session else { return }
            status.receivedShares.removeAll { $0.id == id }
            status.failedShareIds.remove(id)
        } catch {
            status.lastError = error.localizedDescription
        }
    }

    private func downloadShareFile(shareId: String, name: String, into dir: URL) async throws {
        guard ReleaseLayout.isPlainFileName(name) else {
            throw LocallyError.importFailed("A file in that share has a name Locally won't use.")
        }
        let destination = dir.appendingPathComponent(name)
        guard ReleaseLayout().isInside(folder: dir, path: destination.path) else {
            throw LocallyError.pathOutsideFolder
        }
        let url = try await api.shareFileURL(shareId: shareId, fileName: name)
        try await api.downloadFile(from: url, to: destination)
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
        // Best-effort: an unreadable size counts as 0 (quota is enforced server-side).
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
