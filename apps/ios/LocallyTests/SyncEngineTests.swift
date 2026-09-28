import Foundation
import Testing
@testable import Locally

struct SyncEngineTests {
    private struct Harness {
        let coordinator: ReleaseCoordinator
        let folder: FakeSpotifyFolder
        let library: InMemoryLibraryStore
        let tagWriter: FakeTagWriter
        let coverStore: FakeCoverStore
        let api: FakeSyncApi
        let account: InMemorySyncAccountStore
        let engine: SyncEngine
    }

    /// Marks `release` as already pushed, without an actual network round
    /// trip — the realistic starting point for tests about a *remote*
    /// change to a release ("update"/"tombstone" imply both sides already
    /// had it), and needed so `reconcile()`'s back-fill step (which runs
    /// before the fetch, so its own push is reflected in the same pass)
    /// doesn't also try to push this release and clobber the seeded remote
    /// record for the same id.
    private func markSynced(_ release: Release, in library: InMemoryLibraryStore) throws {
        var synced = release
        synced.syncedUpdatedAt = release.updatedAt
        try library.upsert(synced)
    }

    private func makeSourceFile(named name: String = "song.mp3") throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try Data([0xFF, 0xFB, 1, 2, 3, 4]).write(to: url)
        return url
    }

    /// Every test signs in up front (`account.save`) unless it's explicitly
    /// testing signed-out behaviour, since every `SyncEngine` entry point is
    /// a no-op when signed out.
    private func makeHarness() -> Harness {
        let folderDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let folder = FakeSpotifyFolder(directory: folderDir)
        let library = InMemoryLibraryStore()
        let tagWriter = FakeTagWriter()
        let coverStore = FakeCoverStore()
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: folder,
            library: library,
            coverStore: coverStore
        )
        let api = FakeSyncApi()
        let account = InMemorySyncAccountStore()
        account.save(email: "toby@example.com", deviceToken: "test-token", deviceId: "device-1")
        let engine = SyncEngine(api: api, account: account, library: library, coordinator: coordinator, coverStore: coverStore, deviceName: { "Toby's iPhone" })
        return Harness(coordinator: coordinator, folder: folder, library: library, tagWriter: tagWriter, coverStore: coverStore, api: api, account: account, engine: engine)
    }

    // MARK: - Push

    @Test func pushUploadsEachTrackFileThenPutsTheRecord() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "My Song", artist: "My Artist", album: "My Album")
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)

        await h.engine.push(release)

        #expect(h.engine.status.lastError == nil)
        #expect(h.api.requestUploadsCalls.count == 1)
        let trackFileName = (release.tracks[0].filePath as NSString).lastPathComponent
        #expect(h.api.requestUploadsCalls.first?.files.map(\.name) == [trackFileName])
        #expect(h.api.uploadedFileNames == [trackFileName])
        #expect(h.api.putCalls.count == 1)
        #expect(h.api.putCalls.first?.id == release.id.uuidString)
        #expect(h.api.putCalls.first?.origin == "ios")

        let stored = try h.library.all().first { $0.id == release.id }
        #expect(stored?.syncedUpdatedAt != nil)
    }

    /// `Release.coverPath` is absolute and can go stale (iOS may move the
    /// app's data container between installs), so the push resolves the
    /// cover through the store by id and names it by the file it finds.
    @Test func pushUploadsTheCoverResolvedByIdEvenWhenCoverPathIsStale() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "Covered", artist: "Artist", album: "Covered")
        let cover = Data([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3])
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: cover)
        var stale = release
        stale.coverPath = "/private/var/mobile/Containers/Data/Application/OLD-CONTAINER/Covers/\(release.id.uuidString).jpg"
        try h.library.upsert(stale)

        await h.engine.push(stale)

        #expect(h.engine.status.lastError == nil)
        #expect(h.api.putCalls.first?.cover == "cover.jpg")
        #expect(h.api.uploadedFileNames.contains("cover.jpg"))
        #expect(h.api.fileContents["cover.jpg"] == cover)
    }

    @Test func pushLeavesTheCoverOutOfTheRecordWhenItsFileIsGone() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "Lost Cover", artist: "Artist", album: "Lost Cover")
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: Data([0xFF, 0xD8, 1]))
        try h.coverStore.delete(release.id)

        await h.engine.push(release)

        #expect(h.engine.status.lastError == nil, "a missing cover never fails the track's push")
        #expect(h.api.putCalls.first?.cover == nil, "the other device must not wait for a cover that will never upload")
        #expect(!h.api.uploadedFileNames.contains("cover.jpg"))
        let stored = try #require(h.library.all().first { $0.id == release.id })
        #expect(stored.syncedUpdatedAt != nil)
    }

    @Test func pushSkipsFilesTheServerAlreadyHas() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "My Song", artist: "My Artist", album: "My Album")
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)
        let trackFileName = (release.tracks[0].filePath as NSString).lastPathComponent
        h.api.existingFileNames[release.id.uuidString] = [trackFileName]

        await h.engine.push(release)

        #expect(h.api.requestUploadsCalls.count == 1, "still asks, so the server can say what it's missing")
        #expect(h.api.uploadedFileNames.isEmpty, "the server already has it, so nothing is actually uploaded")
        #expect(h.api.putCalls.count == 1)
    }

    @Test func pushSignedOutDoesNothing() async throws {
        let h = makeHarness()
        h.account.clear()
        let tags = TagSet(title: "T", artist: "A", album: "Al")
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)

        await h.engine.push(release)

        #expect(h.api.putCalls.isEmpty)
    }

    @Test func conflictOnPutReconcilesThenRePutsWithAFreshUpdatedAt() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "My Song", artist: "My Artist", album: "My Album")
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)
        h.api.conflictOnNextPut.insert(release.id.uuidString)

        await h.engine.push(release)

        #expect(h.engine.status.lastError == nil)
        #expect(h.api.putCalls.count == 2, "the first attempt conflicts, the retry succeeds")
        let firstAttempt = h.api.putCalls[0]
        let secondAttempt = h.api.putCalls[1]
        #expect(secondAttempt.updatedAt > firstAttempt.updatedAt, "the retry wins last-writer-wins with a fresher updatedAt")

        let stored = try h.library.all().first { $0.id == release.id }
        #expect(stored?.syncedUpdatedAt != nil)
    }

    // MARK: - Reconcile: pending from the Mac

    @Test func reconcileListsAMacOriginRecordNotLocalAsPending() async throws {
        let h = makeHarness()
        let macRecord = SyncRecord(
            id: UUID().uuidString,
            kind: "single",
            title: "Mac Song",
            artist: "Mac Artist",
            tracks: [SyncTrack(id: UUID().uuidString, title: "Mac Song", trackNumber: 1, file: "Mac Artist - Mac Song - 01 - Mac Song.mp3", bytes: 1000, durationSec: nil)],
            origin: "mac",
            originDevice: "Toby's MacBook",
            createdAt: Date(),
            updatedAt: Date()
        )
        h.api.seed(macRecord)

        await h.engine.reconcile()

        #expect(h.engine.status.pendingFromMac.map(\.id) == [macRecord.id])
        #expect(try h.library.all().isEmpty, "not accepted yet, so nothing local changed")
    }

    // MARK: - Reconcile: accept from the Mac

    @Test func acceptFromMacImportsIntoTheSpotifyFolderWithAUniqueNameAndTheSameId() async throws {
        let h = makeHarness()
        let releaseId = UUID()
        let fileName = "Mac Artist - Mac Song - 01 - Mac Song.mp3"
        // A pre-existing, unrelated file already uses this name, forcing the
        // same "never overwrite" uniquing `ReleaseCoordinator` uses locally.
        try Data([9, 9, 9]).write(to: h.folder.directory.appendingPathComponent(fileName))

        let macRecord = SyncRecord(
            id: releaseId.uuidString,
            kind: "single",
            title: "Mac Song",
            artist: "Mac Artist",
            cover: "cover.jpg",
            tracks: [SyncTrack(id: UUID().uuidString, title: "Mac Song", trackNumber: 1, file: fileName, bytes: 6, durationSec: nil)],
            origin: "mac",
            originDevice: "Toby's MacBook",
            createdAt: Date(),
            updatedAt: Date()
        )
        h.api.fileContents[fileName] = Data([0xFF, 0xFB, 1, 2, 3, 4])
        h.api.fileContents["cover.jpg"] = Data([0xFF, 0xD8, 0xFF, 0xE0])
        h.engine.status.pendingFromMac = [macRecord]

        await h.engine.acceptFromMac(macRecord.id)

        #expect(h.engine.status.lastError == nil)
        #expect(h.engine.status.pendingFromMac.isEmpty)

        let releases = try h.library.all()
        #expect(releases.count == 1)
        let imported = try #require(releases.first)
        #expect(imported.id == releaseId, "keeps the record's own id")
        #expect(imported.tracks[0].filePath.hasSuffix("Mac Artist - Mac Song - 01 - Mac Song (2).mp3"), "never overwrites the pre-existing file, so it lands under a unique name")
        #expect(FileManager.default.fileExists(atPath: imported.tracks[0].filePath))
        #expect(h.coverStore.load(releaseId) != nil, "the cover is stored")
        #expect(h.tagWriter.calls.isEmpty, "accepted files are placed as-is, never re-tagged")
    }

    /// A record's file names come off the network and are used as path
    /// components under the download directory, so a `../` name must be
    /// refused before anything is downloaded: nothing may be written outside
    /// that directory and nothing may be imported.
    @Test func acceptFromMacRefusesARecordWhoseFileNameWouldLeaveTheDownloadDirectory() async throws {
        let h = makeHarness()
        let hostile = "../escape-\(UUID().uuidString).mp3"
        let macRecord = SyncRecord(
            id: UUID().uuidString,
            kind: "single",
            title: "Mac Song",
            artist: "Mac Artist",
            cover: nil,
            tracks: [SyncTrack(id: UUID().uuidString, title: "Mac Song", trackNumber: 1, file: hostile, bytes: 6, durationSec: nil)],
            origin: "mac",
            originDevice: "Toby's MacBook",
            createdAt: Date(),
            updatedAt: Date()
        )
        h.engine.status.pendingFromMac = [macRecord]

        await h.engine.acceptFromMac(macRecord.id)

        #expect(h.engine.status.lastError != nil)
        #expect(h.engine.status.failedAcceptIds.contains(macRecord.id))
        #expect(try h.library.all().isEmpty, "nothing is imported")
        let escaped = FileManager.default.temporaryDirectory.appendingPathComponent(String(hostile.dropFirst(3)))
        #expect(!FileManager.default.fileExists(atPath: escaped.path), "nothing is written outside the download directory")
    }

    /// The API returns a release record from the moment it's `PUT`, before
    /// its files necessarily finish uploading (see `SyncEngine.push`'s doc
    /// comment) — so a download can 404 even though the record is legitimate.
    /// That must leave the release pending, not drop it, and the next
    /// `reconcile()` (the 30-second timer, or "Sync now") should complete it
    /// on its own without the user tapping "Send to Spotify" again.
    @Test func aFailedAcceptFromMacIsRetriedAndCompletedOnTheNextReconcile() async throws {
        let h = makeHarness()
        let releaseId = UUID()
        let fileName = "Mac Artist - Mac Song - 01 - Mac Song.mp3"
        let macRecord = SyncRecord(
            id: releaseId.uuidString,
            kind: "single",
            title: "Mac Song",
            artist: "Mac Artist",
            tracks: [SyncTrack(id: UUID().uuidString, title: "Mac Song", trackNumber: 1, file: fileName, bytes: 6, durationSec: nil)],
            origin: "mac",
            originDevice: "Toby's MacBook",
            createdAt: Date(),
            updatedAt: Date()
        )
        h.api.fileContents[fileName] = Data([0xFF, 0xFB, 1, 2, 3, 4])
        h.api.downloadFailCountRemaining[fileName] = 1
        h.engine.status.pendingFromMac = [macRecord]

        await h.engine.acceptFromMac(macRecord.id)

        #expect(h.engine.status.pendingFromMac.map(\.id) == [macRecord.id], "still pending after the first, failing attempt")
        #expect(h.engine.status.failedAcceptIds.contains(macRecord.id))
        #expect(try h.library.all().isEmpty)

        await h.engine.reconcile()

        #expect(h.engine.status.pendingFromMac.isEmpty, "the retry inside reconcile completed it")
        #expect(h.engine.status.failedAcceptIds.isEmpty)
        #expect(try h.library.all().count == 1)
    }

    // MARK: - Reconcile: newer remote update

    @Test func newerRemoteUpdateRetagsInPlaceWithoutRenaming() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "Old Title", artist: "Old Artist", album: "Old Title")
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)
        try markSynced(release, in: h.library)
        let originalPath = release.tracks[0].filePath
        let callsBefore = h.tagWriter.calls.count

        let record = SyncRecord(
            id: release.id.uuidString,
            kind: "single",
            title: "New Title",
            artist: "New Artist",
            tracks: [SyncTrack(id: release.tracks[0].id.uuidString, title: "New Title", trackNumber: 1, file: "irrelevant.mp3", bytes: 0, durationSec: nil)],
            origin: "mac",
            originDevice: "Toby's MacBook",
            createdAt: release.createdAt,
            updatedAt: release.updatedAt.addingTimeInterval(60)
        )
        h.api.seed(record)

        await h.engine.reconcile()

        #expect(h.engine.status.lastError == nil)
        let newCalls = h.tagWriter.calls.suffix(from: callsBefore)
        #expect(newCalls.count == 1)
        #expect(newCalls.first?.tags.title == "New Title")
        #expect(newCalls.first?.tags.album == "New Title")
        #expect(newCalls.first?.url.path == originalPath, "re-tags the same file, never renames or moves it")

        let stored = try #require(h.library.all().first { $0.id == release.id })
        #expect(stored.title == "New Title")
        #expect(stored.tracks[0].filePath == originalPath)
        #expect(h.engine.status.pendingFromMac.isEmpty)
    }

    @Test func aRemoteUpdateNoNewerThanLocalIsIgnored() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "Title", artist: "Artist", album: "Title")
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)
        try markSynced(release, in: h.library)
        let callsBefore = h.tagWriter.calls.count

        let record = SyncRecord(
            id: release.id.uuidString,
            kind: "single",
            title: "Stale Title",
            artist: "Stale Artist",
            tracks: [SyncTrack(id: release.tracks[0].id.uuidString, title: "Stale Title", trackNumber: 1, file: "x.mp3", bytes: 0, durationSec: nil)],
            origin: "mac",
            originDevice: "Toby's MacBook",
            createdAt: release.createdAt,
            updatedAt: release.updatedAt.addingTimeInterval(-60)
        )
        h.api.seed(record)

        await h.engine.reconcile()

        #expect(h.tagWriter.calls.count == callsBefore)
        let stored = try #require(h.library.all().first { $0.id == release.id })
        #expect(stored.title == "Title")
    }

    // MARK: - Reconcile: tombstone

    @Test func aTombstoneRecordDeletesTheLocalRelease() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "T", artist: "A", album: "T")
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)
        try markSynced(release, in: h.library)
        let path = release.tracks[0].filePath
        #expect(FileManager.default.fileExists(atPath: path))

        let tombstone = SyncRecord(
            id: release.id.uuidString,
            kind: "single",
            title: "T",
            artist: "A",
            tracks: [],
            origin: "mac",
            originDevice: "Toby's MacBook",
            createdAt: release.createdAt,
            updatedAt: Date(),
            deleted: true
        )
        h.api.seed(tombstone)

        await h.engine.reconcile()

        #expect(!FileManager.default.fileExists(atPath: path))
        #expect(try h.library.all().isEmpty)
    }

    // MARK: - Reconcile: back-fill

    @Test func reconcileBackfillsALocalReleaseThatWasNeverPushed() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "Never Pushed", artist: "Artist", album: "Never Pushed")
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)
        #expect(release.syncedUpdatedAt == nil)

        await h.engine.reconcile()

        #expect(h.api.putCalls.map(\.id) == [release.id.uuidString])
        let stored = try #require(h.library.all().first { $0.id == release.id })
        #expect(stored.syncedUpdatedAt != nil)
    }

    @Test func reconcileRePushesAReleaseEditedSinceItsLastCompletePush() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "Edited", artist: "Artist", album: "Edited")
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)
        // As if an earlier push completed, then a local edit's push failed.
        var edited = release
        edited.syncedUpdatedAt = release.updatedAt.addingTimeInterval(-60)
        try h.library.upsert(edited)

        await h.engine.reconcile()

        #expect(h.api.putCalls.map(\.id) == [release.id.uuidString])
        let stored = try #require(h.library.all().first { $0.id == release.id })
        #expect(stored.syncedUpdatedAt == stored.updatedAt)
    }

    /// The record `PUT` lands, the upload after it fails, and on the next
    /// pull the server hands this phone its own record back with a newer
    /// `updatedAt` (what the 409 path's re-`PUT` produces). That echo must
    /// not count as "synced", or the files would never be retried.
    @Test func aPushWhoseUploadFailedIsRetriedEvenAfterItsOwnRecordEchoesBack() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "Dropped", artist: "Artist", album: "Dropped")
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)
        let fileName = (release.tracks[0].filePath as NSString).lastPathComponent
        h.api.uploadFailCountRemaining[fileName] = 1

        await h.engine.push(release)
        #expect(h.engine.status.lastError != nil)
        #expect(h.api.uploadedFileNames.isEmpty)
        let afterFailure = try #require(h.library.all().first { $0.id == release.id })
        #expect(afterFailure.syncedUpdatedAt == nil)

        var echoed = try #require(h.api.putCalls.last)
        echoed.updatedAt = release.updatedAt.addingTimeInterval(60)
        h.api.seed(echoed)
        let tagCallsBefore = h.tagWriter.calls.count

        // Back-fill runs first: its PUT (and the retry after the 409, whose
        // fresh `updatedAt` is still older than the echo) is rejected, so the
        // upload isn't reached. Then the echo is pulled.
        await h.engine.reconcile()
        let afterEcho = try #require(h.library.all().first { $0.id == release.id })
        #expect(afterEcho.updatedAt == echoed.updatedAt, "catches up to the server's timestamp")
        #expect(afterEcho.syncedUpdatedAt == nil, "an own echo is not a completed push")
        #expect(h.tagWriter.calls.count == tagCallsBefore, "own content: nothing to re-tag")

        await h.engine.reconcile()
        #expect(h.api.uploadedFileNames == [fileName])
        let synced = try #require(h.library.all().first { $0.id == release.id })
        #expect(synced.syncedUpdatedAt == synced.updatedAt)
        #expect(h.api.putCalls.last?.updatedAt == echoed.updatedAt, "re-pushed with the caught-up timestamp, no conflict")
        #expect(h.engine.status.lastError == nil)
    }

    @Test func aSecondReconcileRunIsANoOp() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "Song", artist: "Artist", album: "Song")
        _ = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)

        await h.engine.reconcile()
        let putsAfterFirstRun = h.api.putCalls.count
        let requestUploadsAfterFirstRun = h.api.requestUploadsCalls.count
        #expect(putsAfterFirstRun == 1)

        await h.engine.reconcile()

        #expect(h.api.putCalls.count == putsAfterFirstRun, "already synced, so it isn't backfilled again")
        #expect(h.api.requestUploadsCalls.count == requestUploadsAfterFirstRun)
        #expect(h.engine.status.lastError == nil)
    }

    @Test func reconcileSignedOutDoesNothing() async throws {
        let h = makeHarness()
        h.account.clear()

        await h.engine.reconcile()

        #expect(h.api.putCalls.isEmpty)
        #expect(h.engine.status.pendingFromMac.isEmpty)
    }

    // MARK: - Tombstone push

    @Test func tombstoneCallsDeleteRelease() async throws {
        let h = makeHarness()
        let id = UUID()

        await h.engine.tombstone(id)

        #expect(h.api.deleteCalls == [id.uuidString])
    }
}
