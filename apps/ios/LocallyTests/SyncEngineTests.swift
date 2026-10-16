import Foundation
import Testing
@testable import Locally

@MainActor
struct SyncEngineTests {
    private struct Harness {
        let coordinator: ReleaseCoordinator
        let folder: FakeSpotifyFolder
        let library: InMemoryLibraryStore
        let tagWriter: FakeTagWriter
        let coverStore: FakeCoverStore
        let api: FakeSyncApi
        let account: InMemorySyncAccountStore
        let outbox: any SyncOutbox
        let engine: SyncEngine
        let defaults: UserDefaults
    }

    /// Marks `release` as already pushed, without an actual network round
    /// trip — the realistic starting point for tests about a *remote*
    /// change to a release ("update"/"tombstone" imply both sides already
    /// had it), and needed so `reconcile()`'s back-fill step (which runs
    /// before the fetch, so its own push is reflected in the same pass)
    /// doesn't also try to push this release and clobber the seeded remote
    /// record for the same id. Also fills `uploadedFileNames` with what a
    /// real push would have landed (the fake cover store always names the
    /// cover file `cover.jpg`), so the back-fill's new "server hasn't
    /// confirmed everything" check doesn't also re-queue it.
    private func markSynced(_ release: Release, in library: InMemoryLibraryStore) throws {
        var synced = release
        synced.syncedUpdatedAt = release.updatedAt
        synced.uploadedFileNames = Array(SyncEngine.expectedUploadNames(
            of: release,
            coverName: release.coverPath != nil ? "cover.jpg" : nil
        ))
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
    ///
    /// `library` and `outbox` are accepted so a test can simulate an app
    /// restart: build a second harness over the same (still-in-memory, but
    /// standing in for "on disk") library and outbox, with a fresh `api`.
    private func makeHarness(
        library: InMemoryLibraryStore = InMemoryLibraryStore(),
        outbox: any SyncOutbox = InMemorySyncOutbox(),
        api: FakeSyncApi = FakeSyncApi(),
        account: InMemorySyncAccountStore? = nil,
        defaults: UserDefaults = UserDefaults(suiteName: UUID().uuidString)!,
        coverStore: FakeCoverStore = FakeCoverStore(),
        now: @escaping () -> Date = { Date() }
    ) -> Harness {
        let folderDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let folder = FakeSpotifyFolder(directory: folderDir)
        let tagWriter = FakeTagWriter()
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: folder,
            library: library,
            coverStore: coverStore,
            durationReader: FakeDurationReader()
        )
        let resolvedAccount: InMemorySyncAccountStore
        if let account {
            resolvedAccount = account
        } else {
            resolvedAccount = InMemorySyncAccountStore()
            resolvedAccount.save(email: "toby@example.com", deviceToken: "test-token", deviceId: "device-1")
        }
        let engine = SyncEngine(api: api, account: resolvedAccount, library: library, coordinator: coordinator, coverStore: coverStore, outbox: outbox, now: now, deviceName: { "Toby's iPhone" }, defaults: defaults)
        return Harness(coordinator: coordinator, folder: folder, library: library, tagWriter: tagWriter, coverStore: coverStore, api: api, account: resolvedAccount, outbox: outbox, engine: engine, defaults: defaults)
    }

    // MARK: - Outbox failures

    @Test func pushSurfacesAnOutboxEnqueueFailureInsteadOfDroppingIt() async throws {
        let h = makeHarness(outbox: FailingSyncOutbox())
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: TagSet(title: "T", artist: "A", album: "T"), cover: nil)

        await h.engine.push(release)

        #expect(h.engine.status.lastError == Copy.Sync.queueFailed(FailingSyncOutbox.Failure().localizedDescription))
        #expect(h.api.putCalls.isEmpty)
    }

    @Test func tombstoneSurfacesAnOutboxEnqueueFailureInsteadOfDroppingIt() async {
        let h = makeHarness(outbox: FailingSyncOutbox())

        await h.engine.tombstone(UUID())

        #expect(h.engine.status.lastError == Copy.Sync.queueFailed(FailingSyncOutbox.Failure().localizedDescription))
        #expect(h.api.deleteCalls.isEmpty)
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

    /// `coverHash` is the change signal the receiving side compares against
    /// its own local cover, since the wire name (`cover.jpg`) never changes
    /// on a replace.
    @Test func pushSendsTheCoversHashMatchingThePushedBytes() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "Covered", artist: "Artist", album: "Covered")
        let cover = Data([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3])
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: cover)

        await h.engine.push(release)

        #expect(h.engine.status.lastError == nil)
        #expect(h.api.putCalls.first?.coverHash == cover.sha256Hex)
    }

    @Test func pushSendsNoCoverHashWhenThereIsNoCover() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "No Cover", artist: "Artist", album: "No Cover")
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)

        await h.engine.push(release)

        #expect(h.engine.status.lastError == nil)
        #expect(h.api.putCalls.first?.cover == nil)
        #expect(h.api.putCalls.first?.coverHash == nil)
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

    @Test func aPartialUploadFailureThenRetryUploadsOnlyTheMissingFiles() async throws {
        let h = makeHarness()
        let album = AlbumDraft(title: "Album", artist: "Artist", year: "2026", genre: "Rock", tracks: [
            TrackDraft(title: "First"), TrackDraft(title: "Second")
        ])
        let files = try [makeSourceFile(named: "one.mp3"), makeSourceFile(named: "two.mp3")]
        let cover = Data([0xFF, 0xD8, 0xFF, 0xE0, 1])
        let release = try await h.coordinator.importAlbum(files: files, album: album, cover: cover)
        let firstTrackName = (release.tracks[0].filePath as NSString).lastPathComponent
        let secondTrackName = (release.tracks[1].filePath as NSString).lastPathComponent
        h.api.uploadFailCountRemaining[secondTrackName] = 1

        await h.engine.push(release)

        #expect(h.engine.status.lastError != nil)
        #expect(h.api.uploadedFileNames.contains(firstTrackName))
        #expect(h.api.uploadedFileNames == [firstTrackName], "the first track landed; the failure stops the push before the cover")
        var stored = try #require(h.library.all().first { $0.id == release.id })
        #expect(Set(stored.uploadedFileNames) == Set(h.api.uploadedFileNames), "only what actually landed is recorded")
        #expect(stored.syncedUpdatedAt == nil, "the push as a whole failed")

        await h.engine.push(release)

        #expect(h.engine.status.lastError == nil)
        #expect(h.api.requestUploadsCalls.last?.files.map(\.name) == [secondTrackName, "cover.jpg"], "only what hadn't landed (the failed track, and the cover behind it) is asked for again")
        stored = try #require(h.library.all().first { $0.id == release.id })
        #expect(Set(stored.uploadedFileNames) == Set([firstTrackName, secondTrackName, "cover.jpg"]))
        #expect(stored.syncedUpdatedAt == stored.updatedAt)
    }

    @Test func aCoverReplaceReUploadsOnlyTheCover() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "Covered", artist: "Artist", album: "Covered")
        let cover = Data([0xFF, 0xD8, 0xFF, 0xE0, 1])
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: cover)
        let trackFileName = (release.tracks[0].filePath as NSString).lastPathComponent

        await h.engine.push(release)
        #expect(h.engine.status.lastError == nil)

        let newCover = Data([0xFF, 0xD8, 0xFF, 0xE0, 2, 3])
        let edited = try await h.coordinator.updateRelease(release.id, changes: ReleaseChanges(cover: newCover))
        await h.engine.push(edited)

        #expect(h.engine.status.lastError == nil)
        #expect(h.api.requestUploadsCalls.last?.files.map(\.name) == ["cover.jpg"])
        #expect(h.api.uploadedFileNames.last == "cover.jpg")
        #expect(h.api.uploadedFileNames.filter { $0 == trackFileName }.count == 1, "the track is uploaded only once, on the first push")
        let stored = try #require(h.library.all().first { $0.id == release.id })
        #expect(Set(stored.uploadedFileNames) == Set([trackFileName, "cover.jpg"]))
    }

    @Test func anEditThatKeepsTheCoverUploadsNothing() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "Covered", artist: "Artist", album: "Covered")
        let cover = Data([0xFF, 0xD8, 0xFF, 0xE0, 1])
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: cover)

        await h.engine.push(release)
        #expect(h.engine.status.lastError == nil)
        let requestsAfterFirstPush = h.api.requestUploadsCalls.count

        let edited = try await h.coordinator.updateRelease(release.id, changes: ReleaseChanges(title: "New Title"))
        await h.engine.push(edited)

        #expect(h.engine.status.lastError == nil)
        #expect(h.api.requestUploadsCalls.count == requestsAfterFirstPush, "nothing to request: every file is already uploaded")
        #expect(h.api.putCalls.count == 2)
    }

    @Test func needsPushReVerifiesAReleaseStoredBeforeUploadedFileNamesExisted() {
        let track = Track(title: "A", trackNumber: 1, filePath: "/x/a.mp3", originalName: "a.mp3")
        let now = Date()
        var release = Release(
            kind: .single,
            title: "T",
            artist: "A",
            coverPath: nil,
            folderPath: "/x",
            tracks: [track],
            createdAt: now,
            updatedAt: now,
            syncedUpdatedAt: now,
            uploadedFileNames: []
        )
        #expect(SyncEngine.needsPush(release, coverName: nil), "an empty set on an old row must be re-verified")

        release.uploadedFileNames = ["a.mp3"]
        #expect(!SyncEngine.needsPush(release, coverName: nil))

        #expect(SyncEngine.needsPush(release, coverName: "cover.jpg"), "the cover isn't confirmed yet")
    }

    @Test func anAcceptedMacReleaseIsNotPushedBackOnTheNextReconcile() async throws {
        let h = makeHarness()
        let releaseId = UUID()
        let fileName = "Mac Artist - Mac Song - 01 - Mac Song.mp3"
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
        h.api.seed(macRecord)
        h.api.fileContents[fileName] = Data([0xFF, 0xFB, 1, 2, 3, 4])
        h.api.fileContents["cover.jpg"] = Data([0xFF, 0xD8, 0xFF, 0xE0])
        h.engine.status.pendingFromMac = [macRecord]

        await h.engine.acceptFromMac(macRecord.id)
        #expect(h.engine.status.lastError == nil)

        let imported = try #require(try h.library.all().first { $0.id == releaseId })
        #expect(Set(imported.uploadedFileNames) == Set([fileName, "cover.jpg"]))

        await h.engine.reconcile()

        #expect(h.api.putCalls.isEmpty, "already fully on the server; reconcile's back-fill must not re-push it")
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

    /// #185: a release from the web, or from a client this build has never
    /// heard of, is "another device": it is offered in the tray with its
    /// origin kept, and never mistaken for this phone's own.
    @Test func reconcileListsAWebOrUnknownOriginRecordNotLocalAsPending() async throws {
        let h = makeHarness()
        func record(origin: String, device: String) -> SyncRecord {
            SyncRecord(
                id: UUID().uuidString,
                kind: "single",
                title: "From \(origin)",
                artist: "Someone",
                tracks: [SyncTrack(id: UUID().uuidString, title: "From \(origin)", trackNumber: 1, file: "Someone - From \(origin) - 01.mp3", bytes: 1000, durationSec: nil)],
                origin: origin,
                originDevice: device,
                createdAt: Date(),
                updatedAt: Date()
            )
        }
        let web = record(origin: "web", device: "Browser")
        // Even with this phone's own device name, an origin other than "ios" is not an echo of this phone.
        let future = record(origin: "future-thing", device: "Toby's iPhone")
        let thisPhone = record(origin: "ios", device: "Toby's iPhone")
        h.api.seed(web)
        h.api.seed(future)
        h.api.seed(thisPhone)

        await h.engine.reconcile()

        #expect(h.engine.status.lastError == nil)
        #expect(Set(h.engine.status.pendingFromMac.map(\.id)) == [web.id, future.id])
        #expect(Set(h.engine.status.pendingFromMac.map(\.origin)) == ["web", "future-thing"])
        #expect(try h.library.all().isEmpty, "not accepted yet, so nothing local changed")
    }

    /// A newer record that names this phone's device but carries another
    /// origin is a real remote update (re-tagged), not this phone's own echo.
    @Test func aNewerRecordFromAnUnknownOriginIsAppliedNotTreatedAsAnOwnEcho() async throws {
        let h = makeHarness()
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: TagSet(title: "Old Title", artist: "Old Artist", album: "Old Title"), cover: nil)
        try markSynced(release, in: h.library)
        let callsBefore = h.tagWriter.calls.count

        h.api.seed(SyncRecord(
            id: release.id.uuidString,
            kind: "single",
            title: "Web Title",
            artist: "Old Artist",
            tracks: [SyncTrack(id: release.tracks[0].id.uuidString, title: "Web Title", trackNumber: 1, file: "irrelevant.mp3", bytes: 0, durationSec: nil)],
            origin: "web",
            originDevice: "Toby's iPhone",
            createdAt: release.createdAt,
            updatedAt: release.updatedAt.addingTimeInterval(60)
        ))

        await h.engine.reconcile()

        #expect(h.engine.status.lastError == nil)
        #expect(h.tagWriter.calls.count == callsBefore + 1, "re-tagged, which an own echo never is")
        let stored = try #require(h.library.all().first { $0.id == release.id })
        #expect(stored.title == "Web Title")
        #expect(h.engine.status.pendingFromMac.isEmpty)
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

    /// `coverHash` (`syncVersion` 2) is the change signal that fixes the bug
    /// this plan exists for: a cover replaced on the Mac never updated on
    /// the phone because the wire name (`cover.jpg`) never changes and
    /// `applyRemoteUpdate` used to always re-embed whatever cover was
    /// already saved locally.
    @Test func reconcileDownloadsAndReEmbedsAReplacedCoverWhenTheRemoteCoverHashDiffers() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "Covered", artist: "Artist", album: "Covered")
        let oldCover = Data([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3])
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: oldCover)
        try markSynced(release, in: h.library)
        let callsBefore = h.tagWriter.calls.count

        let newCover = Data([0xFF, 0xD8, 0xFF, 0xE0, 9, 9, 9])
        let record = SyncRecord(
            id: release.id.uuidString,
            kind: "single",
            title: release.title,
            artist: release.artist,
            cover: "cover.jpg",
            coverHash: newCover.sha256Hex,
            tracks: [SyncTrack(id: release.tracks[0].id.uuidString, title: release.title, trackNumber: 1, file: "irrelevant.mp3", bytes: 0, durationSec: nil)],
            origin: "mac",
            originDevice: "Toby's MacBook",
            createdAt: release.createdAt,
            updatedAt: release.updatedAt.addingTimeInterval(60)
        )
        h.api.fileContents["cover.jpg"] = newCover
        h.api.seed(record)

        await h.engine.reconcile()

        #expect(h.engine.status.lastError == nil)
        let newCalls = h.tagWriter.calls.suffix(from: callsBefore)
        #expect(newCalls.count == 1)
        #expect(newCalls.first?.cover == newCover, "re-embeds the newly downloaded cover, not the stale local one")
        #expect(h.coverStore.load(release.id) == newCover, "the new cover bytes are saved to the store")
        #expect(h.engine.status.failedCoverUpdates.isEmpty)
    }

    @Test func reconcileLeavesTheCoverAloneWhenTheRemoteCoverHashMatchesTheLocalOne() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "Covered", artist: "Artist", album: "Covered")
        let cover = Data([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3])
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: cover)
        try markSynced(release, in: h.library)
        let callsBefore = h.tagWriter.calls.count

        let record = SyncRecord(
            id: release.id.uuidString,
            kind: "single",
            title: "Renamed",
            artist: release.artist,
            cover: "cover.jpg",
            coverHash: cover.sha256Hex,
            tracks: [SyncTrack(id: release.tracks[0].id.uuidString, title: "Renamed", trackNumber: 1, file: "irrelevant.mp3", bytes: 0, durationSec: nil)],
            origin: "mac",
            originDevice: "Toby's MacBook",
            createdAt: release.createdAt,
            updatedAt: release.updatedAt.addingTimeInterval(60)
        )
        h.api.seed(record)

        await h.engine.reconcile()

        #expect(h.engine.status.lastError == nil)
        #expect(h.api.downloadFileCalls.isEmpty, "the hash already matches, so no cover download is made")
        let newCalls = h.tagWriter.calls.suffix(from: callsBefore)
        #expect(newCalls.count == 1)
        #expect(newCalls.first?.cover == cover, "still re-embeds the unchanged local cover, same as a text-only edit")
    }

    @Test func reconcileLeavesTheCoverAloneForARecordWithNoCoverHash() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "Covered", artist: "Artist", album: "Covered")
        let cover = Data([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3])
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: cover)
        try markSynced(release, in: h.library)
        let callsBefore = h.tagWriter.calls.count

        // A syncVersion 1 sender: carries `cover` but never a `coverHash`.
        let record = SyncRecord(
            syncVersion: 1,
            id: release.id.uuidString,
            kind: "single",
            title: "Renamed",
            artist: release.artist,
            cover: "cover.jpg",
            coverHash: nil,
            tracks: [SyncTrack(id: release.tracks[0].id.uuidString, title: "Renamed", trackNumber: 1, file: "irrelevant.mp3", bytes: 0, durationSec: nil)],
            origin: "mac",
            originDevice: "Toby's MacBook",
            createdAt: release.createdAt,
            updatedAt: release.updatedAt.addingTimeInterval(60)
        )
        h.api.seed(record)

        await h.engine.reconcile()

        #expect(h.engine.status.lastError == nil)
        #expect(h.api.downloadFileCalls.isEmpty, "a v1 sender's record carries no change signal, so no download is made")
        let newCalls = h.tagWriter.calls.suffix(from: callsBefore)
        #expect(newCalls.count == 1)
        #expect(newCalls.first?.cover == cover, "unchanged behaviour: re-embeds whatever cover is already local")
    }

    /// Mirrors `aFailedAcceptFromMacIsRetriedAndCompletedOnTheNextReconcile`:
    /// the cover's own download can 404 while the sender is still uploading,
    /// and that must retry on the next `reconcile()` rather than being
    /// dropped, even though `account.lastVersion` has already moved past
    /// this record's page.
    @Test func aFailedCoverDownloadIsRetriedAndCompletedOnTheNextReconcile() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "Covered", artist: "Artist", album: "Covered")
        let oldCover = Data([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3])
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: oldCover)
        try markSynced(release, in: h.library)
        let callsBefore = h.tagWriter.calls.count

        let newCover = Data([0xFF, 0xD8, 0xFF, 0xE0, 9, 9, 9])
        let record = SyncRecord(
            id: release.id.uuidString,
            kind: "single",
            title: "New Title",
            artist: release.artist,
            cover: "cover.jpg",
            coverHash: newCover.sha256Hex,
            tracks: [SyncTrack(id: release.tracks[0].id.uuidString, title: "New Title", trackNumber: 1, file: "irrelevant.mp3", bytes: 0, durationSec: nil)],
            origin: "mac",
            originDevice: "Toby's MacBook",
            createdAt: release.createdAt,
            updatedAt: release.updatedAt.addingTimeInterval(60)
        )
        h.api.fileContents["cover.jpg"] = newCover
        h.api.downloadFailCountRemaining["cover.jpg"] = 1
        h.api.seed(record)

        await h.engine.reconcile()

        #expect(h.engine.status.failedCoverUpdates[record.id] != nil, "kept pending after the first, failing download")
        #expect(h.tagWriter.calls.count == callsBefore, "nothing re-tagged yet")
        let storedAfterFailure = try #require(h.library.all().first { $0.id == release.id })
        #expect(storedAfterFailure.title == "Covered", "the text update waits for the cover too, so nothing is half-applied")

        await h.engine.reconcile()

        #expect(h.engine.status.failedCoverUpdates.isEmpty, "the retry at the start of the next reconcile completed it")
        let newCalls = h.tagWriter.calls.suffix(from: callsBefore)
        #expect(newCalls.count == 1)
        #expect(newCalls.first?.cover == newCover)
        #expect(h.coverStore.load(release.id) == newCover)
        let storedAfterRetry = try #require(h.library.all().first { $0.id == release.id })
        #expect(storedAfterRetry.title == "New Title")
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

    // MARK: - Outbox (#19)

    /// A delete made by the user while `reconcile()` is mid-flight (e.g.
    /// suspended fetching the remote page) must still reach the server: the
    /// user's own action enqueues into the same outbox `reconcile()` drains,
    /// rather than being lost because a bare fire-and-forget `Task` from the
    /// old implementation was never awaited.
    @Test func deleteMadeWhileReconcileIsRunningReachesTheServer() async throws {
        let h = makeHarness()
        h.coordinator.syncHook = h.engine
        let tags = TagSet(title: "T", artist: "A", album: "T")
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)
        try markSynced(release, in: h.library)

        let gate = Gate()
        h.api.releasesGate = { await gate.suspend() }

        let reconcileTask = Task { await h.engine.reconcile() }
        await gate.waitUntilEntered()

        try await h.coordinator.deleteRelease(release.id)

        await gate.resume()
        await reconcileTask.value
        await h.engine.drainOutbox()

        #expect(h.api.deleteCalls.contains(release.id.uuidString))
        #expect(try h.outbox.all().isEmpty)
        #expect(try h.library.all().isEmpty)
    }

    /// A delete queued while the network is down must not be lost when the
    /// app restarts: it sits in the (persistent, in production) outbox
    /// until the next `reconcile()` — here simulated with a second engine
    /// built over the same outbox and library.
    @Test func deleteSurvivesAnAppRestartWithTheNetworkDown() async throws {
        let library = InMemoryLibraryStore()
        let outbox = InMemorySyncOutbox()
        let failingApi = FakeSyncApi()
        failingApi.deleteError = SyncApiError.network("offline")
        let h = makeHarness(library: library, outbox: outbox, api: failingApi)
        let tags = TagSet(title: "T", artist: "A", album: "T")
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)
        try markSynced(release, in: h.library)

        await h.engine.tombstone(release.id)

        let queued = try outbox.all()
        #expect(queued.count == 1)
        #expect(queued.first?.operation == .delete)
        #expect(queued.first?.attempts == 1)
        #expect(queued.first?.lastError != nil)

        // "Restart": a fresh engine over the same outbox/library, with a
        // working api this time.
        let restarted = makeHarness(library: library, outbox: outbox, api: FakeSyncApi())

        await restarted.engine.reconcile()

        #expect(restarted.api.deleteCalls.contains(release.id.uuidString))
        #expect(try outbox.all().isEmpty)
    }

    /// A stale `.push` entry left over after the release it names was
    /// deleted (before the drain got to it) is dropped without ever
    /// `PUT`ing anything.
    @Test func aPushEntryForADeletedReleaseSendsNoPutAndIsDropped() async throws {
        let h = makeHarness()
        let releaseId = UUID()
        try h.outbox.enqueue(releaseId, .push)

        await h.engine.drainOutbox()

        #expect(h.api.putCalls.isEmpty)
        #expect(try h.outbox.all().isEmpty)
    }

    /// A delete enqueued while a push for the same id is in-flight must
    /// survive that push finishing: the push only removes its own `.push`
    /// entry (`ifOperation: .push`), so a `.delete` already sitting there
    /// (from a user action that happened meanwhile) is left alone.
    @Test func aDeleteQueuedWhileAPushIsInFlightSurvivesThePushFinishing() throws {
        let outbox = InMemorySyncOutbox()
        let id = UUID()
        try outbox.enqueue(id, .push)
        try outbox.enqueue(id, .delete)

        try outbox.remove(id, ifOperation: .push)

        let entries = try outbox.all()
        #expect(entries.count == 1)
        #expect(entries.first?.releaseId == id)
        #expect(entries.first?.operation == .delete)
    }

    // MARK: - Restart keeps the tray and failed covers (#276)

    private func macRecord(id: UUID = UUID(), cover: String? = nil, source: ReleaseSource? = nil, origin: String = "mac") -> SyncRecord {
        SyncRecord(
            id: id.uuidString,
            kind: "single",
            title: "Mac Song",
            artist: "Mac Artist",
            cover: cover,
            tracks: [SyncTrack(id: UUID().uuidString, title: "Mac Song", trackNumber: 1, file: "Mac Artist - Mac Song - 01.mp3", bytes: 6, durationSec: nil)],
            origin: origin,
            originDevice: "Toby's MacBook",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            updatedAt: Date(timeIntervalSince1970: 1_700_000_000),
            source: source
        )
    }

    /// A second engine over the same account, library, outbox, cover store,
    /// defaults and api: what the app looks like after a restart.
    private func restarted(_ h: Harness) -> Harness {
        makeHarness(library: h.library, outbox: h.outbox, api: h.api, account: h.account, defaults: h.defaults, coverStore: h.coverStore)
    }

    @Test func aRestartKeepsTheDevicesTray() async throws {
        let h = makeHarness()
        let record = macRecord()
        h.api.seed(record)
        await h.engine.reconcile()
        #expect(h.engine.status.pendingFromMac.map(\.id) == [record.id])

        let after = restarted(h)
        #expect(after.engine.status.pendingFromMac.map(\.id) == [record.id])
        #expect(after.engine.status.pendingFromMac.first?.title == "Mac Song")
    }

    @Test func aRestartKeepsFailedAdoptedCoversAndRetriesThemOnTheFirstReconcile() async throws {
        let h = makeHarness()
        let record = macRecord(cover: "cover.jpg", source: .adopted)
        let id = try #require(UUID(uuidString: record.id))
        h.api.seed(record)
        h.api.fileContents["cover.jpg"] = Data([0xFF, 0xD8, 0xFF, 0xE0])
        h.api.downloadFailCountRemaining["cover.jpg"] = 1
        await h.engine.reconcile()
        #expect(h.engine.status.failedCoverUpdates.keys.contains(record.id))
        #expect(h.coverStore.load(id) == nil)

        let after = restarted(h)
        #expect(after.engine.status.failedCoverUpdates.keys.contains(record.id))
        await after.engine.reconcile()
        #expect(after.coverStore.load(id) == Data([0xFF, 0xD8, 0xFF, 0xE0]))
        #expect(after.engine.status.failedCoverUpdates.isEmpty)
        #expect(after.defaults.data(forKey: SyncEngine.failedCoverUpdatesKey) == nil)
    }

    @Test func acceptingAPendingRecordRemovesItFromThePersistedList() async throws {
        let h = makeHarness()
        let record = macRecord()
        h.api.seed(record)
        await h.engine.reconcile()
        #expect(h.defaults.data(forKey: SyncEngine.pendingFromMacKey) != nil)

        await h.engine.acceptFromMac(record.id)
        #expect(h.engine.status.pendingFromMac.isEmpty)

        let after = restarted(h)
        #expect(after.engine.status.pendingFromMac.isEmpty)
        #expect(h.defaults.data(forKey: SyncEngine.pendingFromMacKey) == nil)
    }

    @Test func signOutClearsBothPersistedLists() async throws {
        let h = makeHarness()
        h.api.seed(macRecord())
        h.api.seed(macRecord(cover: "cover.jpg", source: .adopted))
        h.api.downloadFailCountRemaining["cover.jpg"] = 1
        await h.engine.reconcile()
        #expect(h.defaults.data(forKey: SyncEngine.pendingFromMacKey) != nil)
        #expect(h.defaults.data(forKey: SyncEngine.failedCoverUpdatesKey) != nil)

        await h.engine.signOut()

        #expect(h.engine.status.pendingFromMac.isEmpty)
        #expect(h.engine.status.failedCoverUpdates.isEmpty)
        #expect(h.defaults.data(forKey: SyncEngine.pendingFromMacKey) == nil)
        #expect(h.defaults.data(forKey: SyncEngine.failedCoverUpdatesKey) == nil)
    }

    @Test func aRestoredPendingEntryAlreadyInTheLibraryIsDroppedAndABadBlobIsRemoved() async throws {
        let h = makeHarness()
        let record = macRecord()
        h.api.seed(record)
        await h.engine.reconcile()
        await h.engine.acceptFromMac(record.id)
        // Put the accepted record back into the persisted list, as a crash between accept steps would.
        h.defaults.set(try JSONEncoder.syncApi.encode([record]), forKey: SyncEngine.pendingFromMacKey)
        h.defaults.set(Data("not json".utf8), forKey: SyncEngine.failedCoverUpdatesKey)

        let after = restarted(h)

        #expect(after.engine.status.pendingFromMac.isEmpty)
        #expect(after.engine.status.failedCoverUpdates.isEmpty)
        #expect(h.defaults.data(forKey: SyncEngine.failedCoverUpdatesKey) == nil)
    }

    @Test func theV2RefetchPullsFromZeroOnceThenFromLastVersion() async throws {
        let h = makeHarness()
        let tray = macRecord()
        let adopted = macRecord(cover: "cover.jpg", source: .adopted)
        let adoptedId = try #require(UUID(uuidString: adopted.id))
        h.api.seed(tray)
        h.api.seed(adopted)
        h.api.fileContents["cover.jpg"] = Data([0xFF, 0xD8, 0xFF, 0xE0])
        // A phone already past v1: flag set, cursor moved on, tray and cover lost.
        h.defaults.set(true, forKey: SyncEngine.adoptedCoverRefetchKey)
        h.account.lastVersion = 2

        await h.engine.reconcile()

        #expect(h.api.releasesSinceVersions.first == 0)
        #expect(h.engine.status.pendingFromMac.map(\.id) == [tray.id])
        #expect(h.coverStore.load(adoptedId) == Data([0xFF, 0xD8, 0xFF, 0xE0]))
        #expect(h.defaults.bool(forKey: SyncEngine.fullRefetchKey))

        await h.engine.reconcile()
        #expect(h.api.releasesSinceVersions.last == h.account.lastVersion)
        #expect(h.api.releasesSinceVersions.count == 2)
    }

    @Test func theV2FlagIsNotSetWhenThePullFails() async throws {
        let h = makeHarness()
        h.api.seed(macRecord())
        h.api.releasesFailOnCall = (callNumber: 1, error: SyncApiError.network("down"))

        await h.engine.reconcile()
        #expect(!h.defaults.bool(forKey: SyncEngine.fullRefetchKey))

        await h.engine.reconcile()
        #expect(h.api.releasesSinceVersions == [0, 0])
        #expect(h.defaults.bool(forKey: SyncEngine.fullRefetchKey))
        #expect(h.defaults.bool(forKey: SyncEngine.adoptedCoverRefetchKey))
    }

    @Test func signOutEmptiesTheOutbox() async throws {
        let h = makeHarness()
        try h.outbox.enqueue(UUID(), .push)

        await h.engine.signOut()

        #expect(try h.outbox.all().isEmpty)
    }

    @Test func signOutClearsEveryReleasesSyncMarkers() async throws {
        let h = makeHarness()
        let tags = TagSet(title: "My Song", artist: "My Artist", album: "My Album")
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)
        await h.engine.push(release)
        #expect(try h.library.all().first?.syncedUpdatedAt != nil)

        await h.engine.signOut()

        let stored = try h.library.all().first { $0.id == release.id }
        #expect(stored?.syncedUpdatedAt == nil)
        #expect(stored?.uploadedFileNames.isEmpty == true)
    }

    // MARK: - Delete account

    @Test func deleteAccountCallsTheApiWithTheStoredEmailAndClearsLocalState() async throws {
        let h = makeHarness()
        h.account.deviceName = "iPhone 14"
        h.engine.status.deviceName = "iPhone 14"
        try h.outbox.enqueue(UUID(), .push)
        let tags = TagSet(title: "My Song", artist: "My Artist", album: "My Album")
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)
        await h.engine.push(release)
        let filesBefore = try FileManager.default.contentsOfDirectory(atPath: h.folder.directory.path)

        let deleted = await h.engine.deleteAccount()

        #expect(deleted)
        #expect(h.api.deleteAccountCalls == ["toby@example.com"])
        #expect(h.account.email == nil)
        #expect(h.account.deviceToken == nil)
        #expect(try h.outbox.all().isEmpty)
        #expect(h.engine.status.signedIn == false)
        #expect(h.engine.status.email == nil)
        #expect(h.account.deviceName == nil)
        #expect(h.engine.status.deviceName == nil)
        #expect(h.engine.status.lastError == nil)
        let stored = try h.library.all().first { $0.id == release.id }
        #expect(stored?.syncedUpdatedAt == nil)
        #expect(stored?.uploadedFileNames.isEmpty == true)
        let filesAfter = try FileManager.default.contentsOfDirectory(atPath: h.folder.directory.path)
        #expect(Set(filesAfter) == Set(filesBefore))
    }

    @Test func deleteAccountUnauthorizedClearsLocallyLikeSuccess() async throws {
        let h = makeHarness()
        h.api.deleteAccountError = SyncApiError.unauthorized
        try h.outbox.enqueue(UUID(), .push)
        let tags = TagSet(title: "My Song", artist: "My Artist", album: "My Album")
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)
        await h.engine.push(release)

        let deleted = await h.engine.deleteAccount()

        #expect(deleted)
        #expect(h.account.email == nil)
        #expect(try h.outbox.all().isEmpty)
        #expect(h.engine.status.signedIn == false)
        let stored = try h.library.all().first { $0.id == release.id }
        #expect(stored?.syncedUpdatedAt == nil)
    }

    @Test func deleteAccountNetworkFailureKeepsTheAccountOutboxAndMarkers() async throws {
        let h = makeHarness()
        h.api.deleteAccountError = SyncApiError.network("offline")
        try h.outbox.enqueue(UUID(), .push)
        let tags = TagSet(title: "My Song", artist: "My Artist", album: "My Album")
        let release = try await h.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)
        await h.engine.push(release)
        let outboxCountBefore = try h.outbox.all().count

        let deleted = await h.engine.deleteAccount()

        #expect(deleted == false)
        #expect(h.account.email == "toby@example.com")
        #expect(try h.outbox.all().count == outboxCountBefore)
        #expect(h.engine.status.signedIn == true)
        #expect(h.engine.status.lastError != nil)
        let stored = try h.library.all().first { $0.id == release.id }
        #expect(stored?.syncedUpdatedAt != nil)
    }

    // MARK: - Pagination (#30)

    /// A minimal remote record with no local counterpart and a non-"mac"
    /// origin, so `process(_:)` is a no-op (see its `guard record.origin ==
    /// "mac"` branch) — these tests are about the paging loop advancing
    /// `account.lastVersion`, not about applying content.
    private func makeRemoteRecordRequest(title: String) -> SyncRecord {
        SyncRecord(
            id: UUID().uuidString,
            kind: "single",
            title: title,
            artist: "Artist",
            tracks: [],
            origin: "ios",
            originDevice: "Some Other Device",
            createdAt: Date(),
            updatedAt: Date()
        )
    }

    /// Seeds `count` releases directly into the fake "server" via
    /// `putRelease`, so each gets a distinct, increasing `version`.
    private func seedRemoteReleases(_ count: Int, in api: FakeSyncApi) async throws {
        for i in 0..<count {
            _ = try await api.putRelease(makeRemoteRecordRequest(title: "Release \(i)"))
        }
    }

    @Test func reconcilePullsALargeRemoteLibraryCompletelyInOneReconcile() async throws {
        let h = makeHarness()
        try await seedRemoteReleases(450, in: h.api)

        await h.engine.reconcile()

        #expect(h.engine.status.lastError == nil)
        #expect(h.account.lastVersion == 450)
        // 200 + 200 + 50, per `syncReleasesPageLimit`.
        #expect(h.api.releasesCallCount == 3)
    }

    @Test func reconcileAppliesThePriorPagesAndResumesFromThereAfterAMidPullFailure() async throws {
        let h = makeHarness()
        try await seedRemoteReleases(450, in: h.api)
        h.api.releasesFailOnCall = (callNumber: 2, error: SyncApiError.network("offline"))

        await h.engine.reconcile()

        #expect(h.engine.status.lastError != nil)
        // Page 1 (versions 1...200) was applied and persisted before page 2
        // failed; `lastVersion` stops there rather than staying at 0.
        #expect(h.account.lastVersion == 200)

        // The next reconcile resumes from `lastVersion`, unaffected by the
        // one-shot failure already consumed above.
        await h.engine.reconcile()

        #expect(h.engine.status.lastError == nil)
        #expect(h.account.lastVersion == 450)
    }

    @Test func reconcileTreatsAPageWithoutHasMoreAsTheLastPage() async throws {
        let h = makeHarness()
        try await seedRemoteReleases(450, in: h.api)
        // Simulates decoding an older server's response, where a missing
        // `hasMore` key becomes `false` (see `HttpSyncApi.releases`):  a
        // single page that claims to be final even though more exist.
        h.api.releasesOverride = SyncReleasesPage(
            releases: [makeRemoteRecordRequest(title: "Only one")],
            nextVersion: 999,
            hasMore: false
        )

        await h.engine.reconcile()

        #expect(h.engine.status.lastError == nil)
        #expect(h.account.lastVersion == 999)
        // The loop stopped after the one page instead of fetching another.
        #expect(h.api.releasesCallCount == 1)
    }

    @Test func reconcileStopsAndSetsLastErrorOnANonAdvancingCursor() async throws {
        let h = makeHarness()
        h.api.releasesOverride = SyncReleasesPage(releases: [], nextVersion: 0, hasMore: true)

        await h.engine.reconcile()

        #expect(h.engine.status.lastError != nil)
        #expect(h.account.lastVersion == 0)
        // Stopped after the first (non-advancing) page rather than looping.
        #expect(h.api.releasesCallCount == 1)
    }

    // MARK: - Device name (#38)

    @Test func verifyPersistsTheDeviceNameAndAFreshEngineRestoresItWithoutSigningInAgain() async throws {
        let h = makeHarness()
        h.account.clear()
        h.engine.status.signedIn = false
        h.engine.status.email = nil
        h.engine.status.deviceName = nil
        h.api.verifyResult = .success(
            SyncVerifyResult(token: "test-token", userId: "user-1", email: "toby@example.com", deviceId: "device-1", deviceName: "iPhone 14")
        )

        try await h.engine.verify(email: "toby@example.com", code: "123456")

        #expect(h.account.deviceName == "iPhone 14")
        #expect(h.engine.status.deviceName == "iPhone 14")
        #expect(h.api.verifyCalls.first?.deviceName == "Toby's iPhone")

        let restarted = makeHarness(library: h.library, outbox: h.outbox, api: FakeSyncApi(), account: h.account)
        #expect(restarted.engine.status.deviceName == "iPhone 14")
        #expect(restarted.api.verifyCalls.isEmpty)
        #expect(restarted.api.meCallCount == 0)
    }

    @Test func reconcileBackfillsAMissingDeviceNameFromMe() async throws {
        let h = makeHarness()
        h.api.meResult = .success(
            SyncMeResult(email: "toby@example.com", deviceId: "device-1", deviceName: "iPhone", quota: SyncQuota(usedBytes: 0, limitBytes: 1_073_741_824))
        )

        await h.engine.reconcile()

        #expect(h.account.deviceName == "iPhone")
        #expect(h.engine.status.deviceName == "iPhone")
    }

    @Test func reconcileDoesNotOverwriteAStoredDeviceName() async throws {
        let h = makeHarness()
        h.account.deviceName = "iPhone 14"
        h.engine.status.deviceName = "iPhone 14"
        h.api.meResult = .success(
            SyncMeResult(email: "toby@example.com", deviceId: "device-1", deviceName: "iPhone", quota: SyncQuota(usedBytes: 0, limitBytes: 1_073_741_824))
        )

        await h.engine.reconcile()

        #expect(h.account.deviceName == "iPhone 14")
        #expect(h.engine.status.deviceName == "iPhone 14")
    }

    @Test func reconcileDoesNotBackfillTheDeviceNameAfterASignOutDuringMe() async throws {
        let h = makeHarness()
        h.api.meResult = .success(
            SyncMeResult(email: "toby@example.com", deviceId: "device-1", deviceName: "iPhone", quota: SyncQuota(usedBytes: 0, limitBytes: 1_073_741_824))
        )
        h.api.onMe = { await h.engine.signOut() }

        await h.engine.reconcile()

        #expect(h.api.meCallCount == 1)
        #expect(h.engine.status.signedIn == false)
        #expect(h.account.deviceName == nil)
        #expect(h.engine.status.deviceName == nil)
        #expect(h.engine.status.quota == nil)
    }

    @Test func signOutClearsThePersistedDeviceName() async throws {
        let h = makeHarness()
        h.account.deviceName = "iPhone 14"
        h.engine.status.deviceName = "iPhone 14"

        await h.engine.signOut()

        #expect(h.account.deviceName == nil)
        #expect(h.engine.status.deviceName == nil)
    }

    // MARK: - Missing files self-heal (#171)

    /// A settable clock for the 6-hour spacing.
    private final class TestClock {
        var current: Date
        init(_ start: Date) { current = start }
        func advance(hours: Double = 0, minutes: Double = 0) {
            current = current.addingTimeInterval(hours * 3600 + minutes * 60)
        }
    }

    private let healStart = Date(timeIntervalSince1970: 1_790_000_000)

    /// A two-track album with a cover, pushed in full: the fake server has the
    /// record and every marker is set, as on a phone that finished its upload.
    private func pushedAlbum(_ h: Harness, title: String = "Album") async throws -> (release: Release, first: String, second: String) {
        let album = AlbumDraft(title: title, artist: "Artist", year: "2026", genre: "Rock", tracks: [
            TrackDraft(title: "First"), TrackDraft(title: "Second")
        ])
        let files = try [makeSourceFile(named: "one.mp3"), makeSourceFile(named: "two.mp3")]
        let release = try await h.coordinator.importAlbum(files: files, album: album, cover: Data([0xFF, 0xD8, 0xFF, 0xE0, 1]))
        await h.engine.push(release)
        let first = (release.tracks[0].filePath as NSString).lastPathComponent
        let second = (release.tracks[1].filePath as NSString).lastPathComponent
        let stored = try #require(h.library.all().first { $0.id == release.id })
        #expect(Set(stored.uploadedFileNames) == [first, second, "cover.jpg"])
        return (release, first, second)
    }

    private func missing(_ entries: (id: String, names: [String])...) -> Result<SyncMissingFiles, Error> {
        .success(SyncMissingFiles(releases: entries.map { SyncMissingRelease(id: $0.id, missing: $0.names) }))
    }

    private func me(resyncRequestedAt: Date?) -> Result<SyncMeResult, Error> {
        .success(SyncMeResult(
            email: "toby@example.com", deviceId: "device-1", deviceName: "Test Device",
            quota: SyncQuota(usedBytes: 0, limitBytes: 1_073_741_824), resyncRequestedAt: resyncRequestedAt
        ))
    }

    @Test func theMissingListClearsOnlyThoseNamesMarkersAndQueuesOneRePush() async throws {
        let h = makeHarness(now: { self.healStart })
        let (release, first, second) = try await pushedAlbum(h)
        // The re-push is made to fail so the state it leaves behind can be read.
        h.api.uploadFailCountRemaining[second] = 1
        h.api.missingFilesResult = missing((release.id.uuidString, [second, "cover.jpg"]))
        let putsBefore = h.api.putCalls.count

        await h.engine.reconcile()

        #expect(h.api.missingFilesCallCount == 1)
        let stored = try #require(h.library.all().first { $0.id == release.id })
        #expect(stored.uploadedFileNames == [first], "only the listed names lost their marker")
        #expect(h.api.putCalls.count == putsBefore + 1, "exactly one re-push")
        #expect(h.api.requestUploadsCalls.last?.files.map(\.name) == [second, "cover.jpg"], "tickets asked for only the missing files")
        let queued = try h.outbox.all()
        #expect(queued.map(\.releaseId) == [release.id])
        #expect(queued.first?.operation == .push)
        #expect(h.engine.status.lastError == nil)
    }

    @Test func theRePushUploadsOnlyTheMissingFilesAndRestoresTheMarkers() async throws {
        let h = makeHarness(now: { self.healStart })
        let (release, first, second) = try await pushedAlbum(h)
        let uploadsBefore = h.api.uploadedFileNames
        h.api.missingFilesResult = missing((release.id.uuidString, [second]))

        await h.engine.reconcile()

        #expect(Array(h.api.uploadedFileNames.dropFirst(uploadsBefore.count)) == [second])
        #expect(h.api.uploadedFileNames.filter { $0 == first }.count == 1, "a file the server holds is never sent again")
        let stored = try #require(h.library.all().first { $0.id == release.id })
        #expect(Set(stored.uploadedFileNames) == [first, second, "cover.jpg"])
        #expect(try h.outbox.all().isEmpty)
    }

    @Test func aReleaseThePhoneDoesNotOwnIsLeftAloneAndOwnedOnesAreNotTouchedUnlessListed() async throws {
        let h = makeHarness(now: { self.healStart })
        let (listed, _, listedSecond) = try await pushedAlbum(h, title: "Listed")
        let (other, _, _) = try await pushedAlbum(h, title: "Not listed")
        let otherBefore = try #require(h.library.all().first { $0.id == other.id })
        let strangerId = UUID().uuidString
        h.api.missingFilesResult = missing(
            (strangerId, ["x.mp3"]),
            ("not-a-uuid", ["y.mp3"]),
            (listed.id.uuidString, [listedSecond])
        )
        let putsBefore = h.api.putCalls.count

        await h.engine.reconcile()

        #expect(h.api.putCalls.count == putsBefore + 1)
        #expect(h.api.putCalls.last?.id == listed.id.uuidString)
        #expect(!h.api.putCalls.contains { $0.id == strangerId || $0.id == "not-a-uuid" })
        let otherAfter = try #require(h.library.all().first { $0.id == other.id })
        #expect(otherAfter == otherBefore)
        #expect(try h.library.all().count == 2, "no release was created for the stranger")
        #expect(try h.outbox.all().isEmpty)
        #expect(h.engine.status.lastError == nil)
    }

    @Test func aHealthyAccountDoesNothing() async throws {
        let clock = TestClock(healStart)
        let h = makeHarness(now: { clock.current })
        let (release, _, _) = try await pushedAlbum(h)
        let before = try #require(h.library.all().first { $0.id == release.id })
        let putsBefore = h.api.putCalls.count
        h.api.missingFilesResult = .success(SyncMissingFiles(releases: []))

        await h.engine.reconcile()

        #expect(h.api.missingFilesCallCount == 1)
        #expect(h.api.putCalls.count == putsBefore)
        #expect(try h.library.all().first { $0.id == release.id } == before)
        #expect(try h.outbox.all().isEmpty)
        #expect(h.engine.status.lastError == nil)
        #expect(h.account.lastMissingFilesCheckAt == healStart, "a healthy answer still counts as a check")
    }

    @Test func theCheckRunsAtMostOnceEverySixHours() async throws {
        let clock = TestClock(healStart)
        let h = makeHarness(now: { clock.current })

        await h.engine.reconcile()
        #expect(h.api.missingFilesCallCount == 1)

        clock.advance(hours: 5, minutes: 59)
        await h.engine.reconcile()
        #expect(h.api.missingFilesCallCount == 1, "still inside the 6 hours")

        clock.advance(minutes: 1)
        await h.engine.reconcile()
        #expect(h.api.missingFilesCallCount == 2)
        #expect(h.account.lastMissingFilesCheckAt == clock.current)
    }

    @Test func aNewerResyncRequestBypassesTheSpacingOnce() async throws {
        let clock = TestClock(healStart)
        let h = makeHarness(now: { clock.current })
        await h.engine.reconcile()
        #expect(h.api.missingFilesCallCount == 1)

        clock.advance(hours: 1)
        let nudge = healStart.addingTimeInterval(30 * 60)
        h.api.meResult = me(resyncRequestedAt: nudge)
        await h.engine.reconcile()
        #expect(h.api.missingFilesCallCount == 2, "the Mac asked after the last check")

        clock.advance(minutes: 1)
        await h.engine.reconcile()
        #expect(h.api.missingFilesCallCount == 2, "the same request is not newer than the check it caused")
    }

    @Test func anOlderResyncRequestDoesNotBypassTheSpacing() async throws {
        let clock = TestClock(healStart)
        let h = makeHarness(now: { clock.current })
        await h.engine.reconcile()

        clock.advance(hours: 1)
        h.api.meResult = me(resyncRequestedAt: healStart.addingTimeInterval(-600))
        await h.engine.reconcile()
        #expect(h.api.missingFilesCallCount == 1)

        h.api.meResult = me(resyncRequestedAt: healStart)
        await h.engine.reconcile()
        #expect(h.api.missingFilesCallCount == 1, "a request made at the moment of the last check is not newer")
    }

    @Test func aResyncRequestAheadOfThePhonesClockStillSettlesAfterOneCheck() async throws {
        let clock = TestClock(healStart)
        let h = makeHarness(now: { clock.current })
        await h.engine.reconcile()

        clock.advance(minutes: 10)
        h.api.meResult = me(resyncRequestedAt: clock.current.addingTimeInterval(120))
        await h.engine.reconcile()
        #expect(h.api.missingFilesCallCount == 2)

        clock.advance(minutes: 1)
        await h.engine.reconcile()
        #expect(h.api.missingFilesCallCount == 2, "a few minutes of clock skew does not make every reconcile check again")
    }

    @Test func aNotFoundIsASilentSkipThatWaitsForTheNextWindow() async throws {
        let clock = TestClock(healStart)
        let h = makeHarness(now: { clock.current })
        let (release, _, _) = try await pushedAlbum(h)
        let before = try #require(h.library.all().first { $0.id == release.id })
        let putsBefore = h.api.putCalls.count
        h.api.missingFilesResult = .failure(SyncApiError.notFound)

        await h.engine.reconcile()

        #expect(h.api.missingFilesCallCount == 1)
        #expect(h.engine.status.lastError == nil)
        #expect(h.engine.status.lastRunAt != nil)
        #expect(h.api.putCalls.count == putsBefore)
        #expect(try h.library.all().first { $0.id == release.id } == before)
        #expect(try h.outbox.all().isEmpty)

        clock.advance(hours: 1)
        await h.engine.reconcile()
        #expect(h.api.missingFilesCallCount == 1, "an old API is not asked again every reconcile")

        clock.advance(hours: 5)
        await h.engine.reconcile()
        #expect(h.api.missingFilesCallCount == 2)
    }

    @Test func aRateLimitIsASilentSkipRetriedOnEachReconcileWithoutResettingTheTimer() async throws {
        let clock = TestClock(healStart)
        let h = makeHarness(now: { clock.current })
        let (release, first, second) = try await pushedAlbum(h)
        h.api.missingFilesResult = .failure(SyncApiError.rateLimited)

        await h.engine.reconcile()
        #expect(h.api.missingFilesCallCount == 1)
        #expect(h.engine.status.lastError == nil)
        #expect(h.account.lastMissingFilesCheckAt == nil, "a 429 does not start the 6 hours")

        clock.advance(minutes: 1)
        await h.engine.reconcile()
        #expect(h.api.missingFilesCallCount == 2, "once per reconcile, not in a loop")

        h.api.missingFilesResult = missing((release.id.uuidString, [second]))
        clock.advance(minutes: 1)
        await h.engine.reconcile()
        #expect(h.api.missingFilesCallCount == 3)
        #expect(h.account.lastMissingFilesCheckAt == clock.current)
        let stored = try #require(h.library.all().first { $0.id == release.id })
        #expect(Set(stored.uploadedFileNames) == [first, second, "cover.jpg"])
    }

    @Test func aFailedCheckOtherThanNotFoundOrRateLimitedIsRetriedNextReconcileAndStaysQuiet() async throws {
        let h = makeHarness(now: { self.healStart })
        h.api.missingFilesResult = .failure(SyncApiError.network("offline"))

        await h.engine.reconcile()
        await h.engine.reconcile()

        #expect(h.api.missingFilesCallCount == 2)
        #expect(h.account.lastMissingFilesCheckAt == nil)
        #expect(h.engine.status.lastError == nil)
    }

    @Test func aSignOutWhileMeIsInFlightSkipsTheCheck() async throws {
        let h = makeHarness(now: { self.healStart })
        h.api.onMe = { await h.engine.signOut() }

        await h.engine.reconcile()

        #expect(h.api.missingFilesCallCount == 0)
        #expect(h.account.lastMissingFilesCheckAt == nil)
    }

    @Test func aSignOutWhileTheCheckIsInFlightQueuesAndWritesNothing() async throws {
        let h = makeHarness(now: { self.healStart })
        let (release, _, second) = try await pushedAlbum(h)
        h.api.missingFilesResult = missing((release.id.uuidString, [second]))
        h.api.onMissingFiles = { await h.engine.signOut() }
        let putsBefore = h.api.putCalls.count

        await h.engine.reconcile()

        #expect(h.api.missingFilesCallCount == 1)
        #expect(h.api.putCalls.count == putsBefore, "nothing is pushed for an account that was signed out")
        #expect(try h.outbox.all().isEmpty)
        #expect(h.account.lastMissingFilesCheckAt == nil)
    }

    @Test func signOutForgetsTheLastCheckSoTheNextAccountIsCheckedAtOnce() async throws {
        let h = makeHarness(now: { self.healStart })
        await h.engine.reconcile()
        #expect(h.account.lastMissingFilesCheckAt == healStart)

        await h.engine.signOut()

        #expect(h.account.lastMissingFilesCheckAt == nil)
    }
}

/// A two-stage gate for suspending an async call mid-flight and resuming it
/// from elsewhere: `suspend()` marks itself entered (releasing anyone
/// waiting in `waitUntilEntered()`) and then blocks until `resume()` is
/// called.
private actor Gate {
    private var entered = false
    private var enteredContinuation: CheckedContinuation<Void, Never>?
    private var resumeContinuation: CheckedContinuation<Void, Never>?

    func suspend() async {
        entered = true
        enteredContinuation?.resume()
        enteredContinuation = nil
        await withCheckedContinuation { continuation in
            resumeContinuation = continuation
        }
    }

    func waitUntilEntered() async {
        if entered { return }
        await withCheckedContinuation { continuation in
            enteredContinuation = continuation
        }
    }

    func resume() {
        resumeContinuation?.resume()
        resumeContinuation = nil
    }
}
