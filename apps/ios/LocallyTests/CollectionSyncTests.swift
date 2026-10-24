import Foundation
import SwiftData
import Testing
@testable import Locally

/// Collection sync (#350) against the fake API: the outbox's puts and deletes, the order, the 404 / 429 / 409 /
/// pruned / too-many paths, and the pull.
@MainActor
struct CollectionSyncTests {
    private struct Harness {
        let engine: SyncEngine
        let api: FakeSyncApi
        let account: InMemorySyncAccountStore
        let outbox: InMemorySyncOutbox
        let collections: InMemoryCollectionStore
        let library: InMemoryLibraryStore
    }

    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    private func makeHarness(api: FakeSyncApi = FakeSyncApi()) -> Harness {
        let folder = FakeSpotifyFolder(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true))
        let library = InMemoryLibraryStore()
        let tagWriter = FakeTagWriter()
        let coverStore = FakeCoverStore()
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(), transcoder: FakeTranscoder(), m4aTagWriter: tagWriter, id3TagWriter: tagWriter,
            folder: folder, library: library, coverStore: coverStore, durationReader: FakeDurationReader()
        )
        let account = InMemorySyncAccountStore()
        account.save(email: "toby@example.com", deviceToken: "t", deviceId: "d")
        let outbox = InMemorySyncOutbox()
        let collections = InMemoryCollectionStore()
        let engine = SyncEngine(
            api: api, account: account, library: library, coordinator: coordinator, coverStore: coverStore, outbox: outbox,
            deviceName: { "Toby's iPhone" }, defaults: UserDefaults(suiteName: UUID().uuidString)!, collections: collections
        )
        return Harness(engine: engine, api: api, account: account, outbox: outbox, collections: collections, library: library)
    }

    private func collection(_ name: String = "Mix", items: [CollectionItem] = [], updatedAt: Date? = nil) -> MusicCollection {
        MusicCollection(id: UUID(), name: name, items: items, origin: "ios", originDevice: "Toby's iPhone", createdAt: t0, updatedAt: updatedAt ?? t0)
    }

    private func queue(_ h: Harness, _ c: MusicCollection, _ op: SyncOutboxEntry.Operation = .push) throws {
        try h.collections.upsert(c)
        try h.outbox.enqueueCollection(c.id, op)
    }

    // MARK: Push

    @Test func aQueuedPutSendsTheRecordAndLeavesTheOutbox() async throws {
        let h = makeHarness()
        let item = CollectionItem.release(UUID())
        let c = collection("Late drives", items: [item])
        try queue(h, c)

        await h.engine.drainOutbox()

        let sent = try #require(h.api.collectionPutCalls.first)
        #expect(sent.id == c.id.uuidString.lowercased())
        #expect(sent.name == "Late drives")
        #expect(sent.items == [item])
        #expect(sent.origin == "ios")
        #expect(sent.deleted == false)
        #expect(try h.outbox.collectionEntries().isEmpty)
    }

    @Test func aDeleteSendsTheTombstone() async throws {
        let h = makeHarness()
        let id = UUID()
        try h.outbox.enqueueCollection(id, .delete)

        await h.engine.drainOutbox()

        #expect(h.api.collectionDeleteCalls == [id.uuidString.lowercased()])
        #expect(try h.outbox.collectionEntries().isEmpty)
    }

    @Test func a404DeleteIsDroppedOnceTheRouteHasBeenSeen() async throws {
        let h = makeHarness()
        await h.engine.reconcile()
        #expect(h.account.collectionsRouteSeen)
        try h.outbox.enqueueCollection(UUID(), .delete)
        h.api.collectionDeleteError = SyncApiError.notFound

        await h.engine.reconcile()

        #expect(try h.outbox.collectionEntries().isEmpty)
    }

    @Test func a404DeleteStaysQueuedWhenTheRouteWasNeverSeen() async throws {
        let h = makeHarness()
        h.api.collectionsError = SyncApiError.notFound
        try h.outbox.enqueueCollection(UUID(), .delete)

        await h.engine.reconcile()

        #expect(!h.account.collectionsRouteSeen)
        #expect(try h.outbox.collectionEntries().count == 1)
    }

    @Test func signingOutClearsTheRouteSeenFlag() async throws {
        let h = makeHarness()
        await h.engine.reconcile()
        #expect(h.account.collectionsRouteSeen)

        await h.engine.signOut()

        #expect(!h.account.collectionsRouteSeen)
    }

    @Test func releasesGoFirstThenChangedCollectionsThenDeletes() async throws {
        let h = makeHarness()
        let release = Release(kind: .single, title: "S", artist: "A", folderPath: "/f", tracks: [Track(title: "S", trackNumber: 1, filePath: "/f/s.mp3", originalName: "s.mp3")])
        try h.library.upsert(release)
        try h.outbox.enqueue(release.id, .push)
        try h.outbox.enqueueCollection(UUID(), .delete)
        try queue(h, collection())

        await h.engine.drainOutbox()

        let writes = h.api.callOrder.filter { ["putRelease", "putCollection", "deleteCollection"].contains($0) }
        #expect(writes == ["putRelease", "putCollection", "deleteCollection"])
    }

    @Test(arguments: [SyncApiError.notFound, SyncApiError.rateLimited])
    func a404Or429IsSkippedQuietlyAndRetriedNextTime(_ error: SyncApiError) async throws {
        let h = makeHarness()
        let c = collection()
        try queue(h, c)
        h.api.collectionsError = error

        await h.engine.reconcile()

        #expect(h.engine.status.lastError == nil)
        let entry = try #require(try h.outbox.collectionEntries().first)
        #expect(entry.operation == .push)
        #expect(entry.attempts == 0)
        // The rest of the reconcile still ran.
        #expect(h.api.releasesCallCount > 0)

        h.api.collectionsError = nil
        await h.engine.reconcile()
        #expect(h.api.collectionPutCalls.count == 1)
        #expect(try h.outbox.collectionEntries().isEmpty)
    }

    @Test func a409TakesTheNewerServerCopy() async throws {
        let h = makeHarness()
        let c = collection("Mine", updatedAt: t0)
        try queue(h, c)
        var theirs = SyncCollection(c)
        theirs.name = "Theirs"
        theirs.updatedAt = t0.addingTimeInterval(60)
        theirs.originDevice = "Toby's MacBook"
        h.api.seedCollection(theirs)

        await h.engine.drainOutbox()

        #expect(try h.collections.get(c.id)?.name == "Theirs")
        #expect(try h.outbox.collectionEntries().isEmpty)
    }

    @Test func prunedPullsTheServersCopyBack() async throws {
        let h = makeHarness()
        let keep = CollectionItem.release(UUID())
        let dropped = CollectionItem.release(UUID())
        let c = collection(items: [keep, dropped])
        try queue(h, c)
        h.api.collectionPrunedOnNextPut = 1

        await h.engine.drainOutbox()

        #expect(try h.collections.get(c.id)?.items == [keep])
        #expect(try h.outbox.collectionEntries().isEmpty)
    }

    @Test func tooManyCollectionsStaysQueuedWithThePlansWording() async throws {
        let h = makeHarness()
        let c = collection()
        try queue(h, c)
        h.api.collectionPutError = SyncApiError.tooManyCollections

        await h.engine.reconcile()

        let entry = try #require(try h.outbox.collectionEntries().first)
        #expect(entry.operation == .push)
        #expect(entry.attempts == 1)
        #expect(h.engine.status.lastError == Copy.Collections.tooMany)
        // The next reconcile tries again and succeeds.
        await h.engine.reconcile()
        #expect(try h.outbox.collectionEntries().isEmpty)
    }

    @Test func aPutForACollectionDeletedMeanwhileIsDropped() async throws {
        let h = makeHarness()
        try h.outbox.enqueueCollection(UUID(), .push)
        await h.engine.drainOutbox()
        #expect(h.api.collectionPutCalls.isEmpty)
        #expect(try h.outbox.collectionEntries().isEmpty)
    }

    @Test func aDeleteReplacesAQueuedPut() throws {
        let h = makeHarness()
        let id = UUID()
        try h.outbox.enqueueCollection(id, .push)
        try h.outbox.enqueueCollection(id, .push)
        try h.outbox.enqueueCollection(id, .delete)
        try h.outbox.enqueueCollection(id, .push)
        #expect(try h.outbox.collectionEntries().map(\.operation) == [.delete])
    }

    @Test func anEditMadeWhileThePutIsInFlightStaysQueuedAndGoesOutNext() async throws {
        let h = makeHarness()
        let c = collection("Before", updatedAt: t0)
        try queue(h, c)
        var suspended: CheckedContinuation<Void, Never>?
        h.api.onPutCollection = { await withCheckedContinuation { suspended = $0 } }

        let drain = Task { await h.engine.drainOutbox() }
        while suspended == nil { await Task.yield() }
        var edited = c
        edited.name = "After"
        edited.updatedAt = t0.addingTimeInterval(10)
        try h.collections.upsert(edited)
        try h.outbox.enqueueCollection(c.id, .push)
        h.api.onPutCollection = nil
        suspended?.resume()
        await drain.value

        #expect(h.api.collectionPutCalls.first?.name == "Before")
        // The entry survived the first put; the same drain pass does not resend it, the next reconcile does.
        #expect(try h.outbox.collectionEntries().count == 1)
        await h.engine.reconcile()
        #expect(h.api.collectionPutCalls.last?.name == "After")
        #expect(h.api.storedCollection(c.id.uuidString.lowercased())?.name == "After")
        #expect(try h.outbox.collectionEntries().isEmpty)
    }

    @Test func a409AfterAnEditMadeInFlightKeepsTheEntryForcesNothingAndTheNextReconcileSendsTheEdit() async throws {
        let h = makeHarness()
        let c = collection("Before", updatedAt: t0)
        try queue(h, c)
        var suspended: CheckedContinuation<Void, Never>?
        h.api.onPutCollection = { await withCheckedContinuation { suspended = $0 } }

        let drain = Task { await h.engine.drainOutbox() }
        while suspended == nil { await Task.yield() }
        // The edit lands while the put is in flight, and the server holds a copy newer than the one being sent
        // (but older than the edit), so the put answers 409.
        var edited = c
        edited.name = "After"
        edited.updatedAt = t0.addingTimeInterval(10)
        try h.collections.upsert(edited)
        try h.outbox.enqueueCollection(c.id, .push)
        var theirs = SyncCollection(c)
        theirs.name = "Theirs"
        theirs.updatedAt = t0.addingTimeInterval(5)
        h.api.seedCollection(theirs)
        h.api.onPutCollection = nil
        suspended?.resume()
        await drain.value

        #expect(h.api.collectionPutCalls.first?.name == "Before")
        #expect(try h.outbox.collectionEntries().count == 1)
        // Nothing was forced: the local edit is still the stored copy.
        #expect(try h.collections.get(c.id)?.name == "After")

        await h.engine.reconcile()
        #expect(h.api.collectionPutCalls.last?.name == "After")
        #expect(h.api.storedCollection(c.id.uuidString.lowercased())?.name == "After")
        #expect(try h.outbox.collectionEntries().isEmpty)
    }

    // MARK: Pull

    @Test func aRecordThatCannotBeStoredStopsThePullAndKeepsTheCursor() async throws {
        let h = makeHarness()
        let remote = collection("From the Mac", items: [.release(UUID())])
        h.api.seedCollection(SyncCollection(remote))
        h.collections.upsertError = CocoaError(.fileWriteUnknown)

        await h.engine.reconcile()

        #expect(h.account.lastCollectionVersion == 0)
        #expect(h.engine.status.lastError != nil)
        #expect(try h.collections.get(remote.id) == nil)

        await h.engine.reconcile()

        #expect(try h.collections.get(remote.id)?.name == "From the Mac")
        #expect(h.account.lastCollectionVersion > 0)
    }

    @Test func aForcedCollectionStaysForcedUntilItIsStored() async throws {
        let h = makeHarness()
        let keep = CollectionItem.release(UUID())
        let dropped = CollectionItem.release(UUID())
        let c = collection(items: [keep, dropped])
        try queue(h, c)
        // A phone that has pulled before (no first-sign-in back-fill of every collection).
        let earlier = h.api.seedCollection(SyncCollection(collection("Earlier")))
        h.account.lastCollectionVersion = earlier
        h.api.collectionPrunedOnNextPut = 1
        // The server's pruned copy is not stored the first time.
        h.api.onPutCollection = { h.collections.upsertError = CocoaError(.fileWriteUnknown) }

        await h.engine.drainOutbox()
        #expect(try h.collections.get(c.id)?.items == [keep, dropped])
        #expect(h.account.lastCollectionVersion == earlier)

        h.api.onPutCollection = nil
        await h.engine.reconcile()
        #expect(try h.collections.get(c.id)?.items == [keep])
    }

    @Test func reconcilePullsAfterReleasesAndStoresTheCursor() async throws {
        let h = makeHarness()
        let remote = collection("From the Mac", items: [.release(UUID())])
        h.api.seedCollection(SyncCollection(remote))

        await h.engine.reconcile()

        let order = h.api.callOrder
        let releasesAt = try #require(order.firstIndex(of: "releases"))
        let collectionsAt = try #require(order.firstIndex(of: "collections"))
        #expect(releasesAt < collectionsAt)
        #expect(try h.collections.get(remote.id)?.name == "From the Mac")
        #expect(h.account.lastCollectionVersion > 0)
        await h.engine.reconcile()
        #expect(h.api.collectionsSinceVersions.last == h.account.lastCollectionVersion)
    }

    @Test func aPulledTombstoneRemovesTheLocalCollection() async throws {
        let h = makeHarness()
        let c = collection()
        try h.collections.upsert(c)
        h.account.lastCollectionVersion = 1
        var gone = SyncCollection(c, deleted: true)
        gone.updatedAt = t0.addingTimeInterval(5)
        h.api.seedCollection(gone)
        h.api.seedCollection(gone)

        await h.engine.reconcile()

        #expect(try h.collections.get(c.id) == nil)
    }

    @Test func aNewerLocalCopyIsNotOverwrittenByAnOlderRemoteOne() async throws {
        let h = makeHarness()
        let c = collection("Newer", updatedAt: t0.addingTimeInterval(100))
        try h.collections.upsert(c)
        var older = SyncCollection(c)
        older.name = "Older"
        older.updatedAt = t0
        h.api.seedCollection(older)

        await h.engine.reconcile()

        #expect(try h.collections.get(c.id)?.name == "Newer")
    }

    @Test func anOlderApiLeavesPullQuietAndReleasesWorking() async throws {
        let h = makeHarness()
        h.api.collectionsError = SyncApiError.notFound
        await h.engine.reconcile()
        #expect(h.engine.status.lastError == nil)
        #expect(h.account.lastCollectionVersion == 0)
    }

    @Test func anUnknownItemSurvivesAPullAndTheNextPush() async throws {
        let h = makeHarness()
        let record = try JSONDecoder.syncApi.decode(SyncCollection.self, from: try CollectionFixtureTests.data("unknown-kind.json"))
        h.api.seedCollection(record)

        await h.engine.reconcile()
        let id = try #require(UUID(uuidString: record.id))
        var local = try #require(try h.collections.get(id))
        #expect(local.items.count == 2)

        local.name = "Renamed here"
        local.updatedAt = local.updatedAt.addingTimeInterval(60)
        try queue(h, local)
        await h.engine.drainOutbox()

        let stored = try #require(h.api.storedCollection(record.id))
        #expect(stored.name == "Renamed here")
        #expect(stored.items == record.items)
    }
}

/// The additive models open with the others and keep their rows (the real SwiftData store, in memory).
struct CollectionStoreTests {
    @MainActor
    @Test func theCollectionModelsOpenBesideTheLibraryAndRoundTrip() throws {
        let container = try ModelStore.open(at: nil)
        let store = SwiftDataCollectionStore(context: container.mainContext)
        let outbox = SwiftDataSyncOutbox(context: container.mainContext)
        let unknown = CollectionItem.unknown(.object(["kind": .string("tape-side"), "side": .string("B")]))
        let c = MusicCollection(id: UUID(), name: "Mix", items: [.release(UUID()), unknown], origin: "mac", originDevice: "Mac", createdAt: Date(timeIntervalSince1970: 10), updatedAt: Date(timeIntervalSince1970: 20))

        try store.upsert(c)
        #expect(try store.get(c.id) == c)
        var renamed = c
        renamed.name = "Renamed"
        try store.upsert(renamed)
        #expect(try store.all() == [renamed])

        try outbox.enqueueCollection(c.id, .push)
        try outbox.enqueueCollection(c.id, .push)
        #expect(try outbox.collectionEntries().count == 1)
        try outbox.recordCollectionFailure(c.id, error: "x")
        #expect(try outbox.collectionEntries().first?.attempts == 1)
        try outbox.enqueueCollection(c.id, .delete)
        try outbox.removeCollection(c.id, ifOperation: .push)
        #expect(try outbox.collectionEntries().count == 1)
        try outbox.removeCollection(c.id, ifOperation: .delete)
        #expect(try outbox.collectionEntries().isEmpty)

        try store.delete(id: c.id)
        #expect(try store.all().isEmpty)
    }
}
