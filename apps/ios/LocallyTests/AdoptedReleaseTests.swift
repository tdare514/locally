import Foundation
import Testing
@testable import Locally

@MainActor
struct AdoptedReleaseTests {
    private struct Harness {
        let library: InMemoryLibraryStore
        let tagWriter: FakeTagWriter
        let coverStore: FakeCoverStore
        let api: FakeSyncApi
        let coordinator: ReleaseCoordinator
        let engine: SyncEngine
        let account: InMemorySyncAccountStore
        let defaults: UserDefaults
    }

    private func makeHarness() -> Harness {
        let folderDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let library = InMemoryLibraryStore()
        let tagWriter = FakeTagWriter()
        let coverStore = FakeCoverStore()
        let api = FakeSyncApi()
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: FakeSpotifyFolder(directory: folderDir),
            library: library,
            coverStore: coverStore,
            durationReader: FakeDurationReader()
        )
        let account = InMemorySyncAccountStore()
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        account.save(email: "toby@example.com", deviceToken: "test-token", deviceId: "device-1")
        let engine = SyncEngine(api: api, account: account, library: library, coordinator: coordinator, coverStore: coverStore, outbox: InMemorySyncOutbox(), now: { Date() }, deviceName: { "Toby's iPhone" }, defaults: defaults)
        return Harness(library: library, tagWriter: tagWriter, coverStore: coverStore, api: api, coordinator: coordinator, engine: engine, account: account, defaults: defaults)
    }

    private let coverBytes = Data([0xFF, 0xD8, 0xFF, 0xE0, 9, 9, 9])

    private func adoptedRecord(id: UUID = UUID(), title: String = "Night Drive", updatedAt: Date = Date(), deleted: Bool = false) -> SyncRecord {
        SyncRecord(
            id: id.uuidString,
            kind: "album",
            title: title,
            artist: "Chromatics",
            cover: "cover.jpg",
            coverHash: coverBytes.sha256Hex,
            tracks: [SyncTrack(id: UUID().uuidString, title: "Intro", trackNumber: 1, file: "01 - Intro.mp3", bytes: 100)],
            origin: "mac",
            originDevice: "Toby's MacBook",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            updatedAt: updatedAt,
            deleted: deleted,
            source: .adopted
        )
    }

    // MARK: - Decoding

    private func decode(sourceJSON: String) throws -> SyncRecord {
        let json = """
        {"syncVersion": 2, "id": "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90", "kind": "album", "title": "T", "artist": "A",
         "year": null, "genre": null, "cover": null, "tracks": [], "origin": "mac", "originDevice": "M",
         "createdAt": "2026-09-27T20:00:00Z", "updatedAt": "2026-09-27T20:00:00Z", "deleted": false\(sourceJSON)}
        """
        return try JSONDecoder.syncApi.decode(SyncRecord.self, from: Data(json.utf8))
    }

    @Test func adoptedSourceDecodesAndAbsentOrUnknownReadsAsNil() throws {
        #expect(try decode(sourceJSON: ", \"source\": \"adopted\"").source == .adopted)
        #expect(try decode(sourceJSON: "").source == nil)
        #expect(try decode(sourceJSON: ", \"source\": \"future-thing\"").source == nil)
        #expect(try decode(sourceJSON: ", \"source\": 7").source == nil)
        #expect(try decode(sourceJSON: ", \"source\": null").source == nil)
    }

    @Test func sourceEncodesWhenAdoptedAndIsOmittedOtherwise() throws {
        let adopted = try JSONEncoder.syncApi.encode(adoptedRecord())
        #expect(String(decoding: adopted, as: UTF8.self).contains("\"source\":\"adopted\""))
        var plain = adoptedRecord()
        plain.source = nil
        #expect(!String(decoding: try JSONEncoder.syncApi.encode(plain), as: UTF8.self).contains("source"))
    }

    // MARK: - Pull

    @Test func anAdoptedRecordGoesIntoTheLibraryNotTheInboxWithItsCoverAndNoFiles() async throws {
        let h = makeHarness()
        let record = adoptedRecord()
        h.api.fileContents["cover.jpg"] = coverBytes
        h.api.seed(record)

        await h.engine.reconcile()

        #expect(h.engine.status.lastError == nil)
        #expect(h.engine.status.pendingFromMac.isEmpty, "never offered for Send")
        let stored = try #require(h.library.all().first { $0.id.uuidString == record.id })
        #expect(stored.isAdopted)
        #expect(stored.title == "Night Drive")
        #expect(stored.tracks.map(\.title) == ["Intro"])
        #expect(h.api.downloadFileCalls == ["cover.jpg"], "the cover only, no track file")
        #expect(h.coverStore.load(stored.id) == coverBytes)
        #expect(h.tagWriter.calls.isEmpty)
    }

    @Test func anAdoptedReleaseIsNeverPushed() async throws {
        let h = makeHarness()
        let record = adoptedRecord()
        h.api.seed(record)
        await h.engine.reconcile()
        let stored = try #require(h.library.all().first)

        await h.engine.push(stored)
        h.engine.pushAfterChange(stored)
        await h.engine.reconcile()

        #expect(h.api.putCalls.isEmpty)
        #expect(h.api.requestUploadsCalls.isEmpty)
    }

    @Test func aLaterUpdateChangesTheDetailsWithoutTagging() async throws {
        let h = makeHarness()
        let id = UUID()
        h.api.seed(adoptedRecord(id: id))
        await h.engine.reconcile()

        h.api.seed(adoptedRecord(id: id, title: "Night Drive II", updatedAt: Date().addingTimeInterval(60)))
        await h.engine.reconcile()

        #expect(try h.library.all().map(\.title) == ["Night Drive II"])
        #expect(try h.library.all().first?.isAdopted == true)
        #expect(h.tagWriter.calls.isEmpty)
        #expect(h.api.putCalls.isEmpty)
    }

    @Test func aLaterTombstoneRemovesIt() async throws {
        let h = makeHarness()
        let id = UUID()
        h.api.seed(adoptedRecord(id: id))
        await h.engine.reconcile()
        #expect(try h.library.all().count == 1)

        h.api.seed(adoptedRecord(id: id, updatedAt: Date().addingTimeInterval(60), deleted: true))
        await h.engine.reconcile()

        #expect(try h.library.all().isEmpty)
        #expect(h.coverStore.deletedIds.contains(id))
    }

    @Test func aFailedCoverDownloadKeepsTheDetailsAndRetriesTheCover() async throws {
        let h = makeHarness()
        h.api.fileContents["cover.jpg"] = coverBytes
        h.api.downloadFailCountRemaining["cover.jpg"] = 1
        let record = adoptedRecord()
        h.api.seed(record)

        await h.engine.reconcile()
        let id = try #require(UUID(uuidString: record.id))
        #expect(try h.library.all().contains { $0.id == id })
        #expect(h.coverStore.load(id) == nil)

        await h.engine.reconcile()
        #expect(h.coverStore.load(id) == coverBytes)
        #expect(h.engine.status.failedCoverUpdates.isEmpty)
    }

    // MARK: - Missing covers (#266)

    private func importWithoutCover(_ h: Harness, _ record: SyncRecord) async throws {
        // Cover download fails the first time, as it did while server storage was broken.
        await h.engine.reconcile()
        let id = try #require(UUID(uuidString: record.id))
        try h.coverStore.delete(id)
        h.engine.status.failedCoverUpdates.removeAll()
    }

    @Test func aSameUpdatedAtAdoptedRecordWithAMissingCoverDownloadsAndStoresIt() async throws {
        let h = makeHarness()
        let record = adoptedRecord()
        h.api.seed(record)
        try await importWithoutCover(h, record)
        let id = try #require(UUID(uuidString: record.id))
        #expect(h.coverStore.load(id) == nil)
        h.api.fileContents["cover.jpg"] = coverBytes

        let before = h.api.downloadFileCalls.count
        h.defaults.set(true, forKey: SyncEngine.adoptedCoverRefetchKey)
        h.account.lastVersion = 0
        await h.engine.reconcile()

        #expect(h.coverStore.load(id) == coverBytes)
        #expect(h.api.downloadFileCalls.count == before + 1)
    }

    @Test func anAdoptedReleaseWithItsCoverAlreadyStoredIsNotDownloadedAgain() async throws {
        let h = makeHarness()
        let record = adoptedRecord()
        h.api.fileContents["cover.jpg"] = coverBytes
        h.api.seed(record)
        await h.engine.reconcile()
        #expect(h.api.downloadFileCalls == ["cover.jpg"])

        h.account.lastVersion = 0
        await h.engine.reconcile()

        #expect(h.api.downloadFileCalls == ["cover.jpg"])
    }

    @Test func theAdoptedCoverRefetchResetsLastVersionOnceAndOnlyWhenACoverIsMissing() async throws {
        let h = makeHarness()
        let record = adoptedRecord()
        h.api.fileContents["cover.jpg"] = coverBytes
        h.api.seed(record)
        await h.engine.reconcile()
        // Cover present: no refetch, flag stays unset.
        #expect(!h.defaults.bool(forKey: SyncEngine.adoptedCoverRefetchKey))

        let id = try #require(UUID(uuidString: record.id))
        try h.coverStore.delete(id)
        let before = h.api.downloadFileCalls.count
        await h.engine.reconcile()
        // The re-pull from 0 fetched the missing cover and set the flag.
        #expect(h.defaults.bool(forKey: SyncEngine.adoptedCoverRefetchKey))
        #expect(h.coverStore.load(id) == coverBytes)
        #expect(h.api.downloadFileCalls.count == before + 1)

        // Flag set: a missing cover no longer triggers a re-pull from 0.
        try h.coverStore.delete(id)
        await h.engine.reconcile()
        #expect(h.coverStore.load(id) == nil)
    }
}
