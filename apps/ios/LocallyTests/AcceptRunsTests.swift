import Foundation
import Testing
@testable import Locally

/// #296: the tray's Add all (ready rows only), Try all again (the failed ids as pressed) and the
/// per-id guard in `acceptFromMac`.
@MainActor
struct AcceptRunsTests {
    private struct Harness {
        let library: InMemoryLibraryStore
        let api: FakeSyncApi
        let engine: SyncEngine
    }

    private func makeHarness() -> Harness {
        let library = InMemoryLibraryStore()
        let api = FakeSyncApi()
        let folder = FakeSpotifyFolder(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true))
        let tagWriter = FakeTagWriter()
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(), transcoder: FakeTranscoder(), m4aTagWriter: tagWriter, id3TagWriter: tagWriter,
            folder: folder, library: library, coverStore: FakeCoverStore(), durationReader: FakeDurationReader()
        )
        let account = InMemorySyncAccountStore()
        account.save(email: "toby@example.com", deviceToken: "test-token", deviceId: "device-1")
        let engine = SyncEngine(api: api, account: account, library: library, coordinator: coordinator, coverStore: FakeCoverStore(), outbox: InMemorySyncOutbox(), deviceName: { "Test Phone" }, defaults: UserDefaults(suiteName: UUID().uuidString)!)
        return Harness(library: library, api: api, engine: engine)
    }

    private func record(_ name: String) -> SyncRecord {
        SyncRecord(
            id: UUID().uuidString, kind: "single", title: name, artist: "Artist",
            tracks: [SyncTrack(id: UUID().uuidString, title: name, trackNumber: 1, file: "\(name).mp3", bytes: 6, durationSec: nil)],
            origin: "mac", originDevice: "Mac", createdAt: Date(), updatedAt: Date()
        )
    }

    @Test func addAllTakesOnlyTheReadyRecords() async throws {
        let h = makeHarness()
        let ready = record("ready"), failed = record("failed")
        h.engine.status.pendingFromMac = [ready, failed]
        h.engine.status.failedAcceptIds = [failed.id]

        let result = await h.engine.acceptReadyFromMac()
        #expect(result == SyncEngine.AcceptRunResult(added: 1, failed: 0))

        #expect(h.engine.status.pendingFromMac.map(\.id) == [failed.id], "the failed one is not the ready section's")
        #expect(h.api.downloadFileCalls == ["ready.mp3"])
        #expect(try h.library.all().count == 1)
        #expect(h.engine.status.acceptingIds.isEmpty, "every reservation ends with its turn")
    }

    @Test func aSecondAcceptOfTheSameIdWhileOneRunsDoesNothing() async throws {
        let h = makeHarness()
        let one = record("one")
        h.engine.status.pendingFromMac = [one]
        var gateCalls = 0
        var release: CheckedContinuation<Void, Never>?
        h.api.downloadGate = {
            gateCalls += 1
            await withCheckedContinuation { release = $0 }
        }

        let first = Task { await h.engine.acceptFromMac(one.id) }
        while release == nil { await Task.yield() }
        #expect(h.engine.status.acceptingIds == [one.id])

        await h.engine.acceptFromMac(one.id)   // from any control: does nothing
        await h.engine.acceptReadyFromMac()      // nothing ready: it is being sent
        #expect(gateCalls == 1)

        release?.resume()
        await first.value
        #expect(h.api.downloadFileCalls == ["one.mp3"], "downloaded once")
        #expect(try h.library.all().count == 1)
        #expect(h.engine.status.acceptingIds.isEmpty)
    }

    @Test func aRunReservesEveryIdAtOnceAndRefusesOtherAsksUntilItsTurnEnds() async throws {
        let h = makeHarness()
        let a = record("a"), b = record("b")
        h.engine.status.pendingFromMac = [a, b]
        var release: CheckedContinuation<Void, Never>?
        h.api.downloadGate = { await withCheckedContinuation { release = $0 } }

        let run = Task { await h.engine.acceptReadyFromMac() }
        while release == nil { await Task.yield() }
        #expect(h.engine.status.acceptingIds == [a.id, b.id], "b is reserved while a downloads")

        await h.engine.acceptFromMac(b.id)       // b's own control: refused, it is reserved
        #expect(h.api.downloadFileCalls == ["a.mp3"])

        h.api.downloadGate = nil
        release?.resume()
        await run.value
        #expect(h.api.downloadFileCalls == ["a.mp3", "b.mp3"], "each downloaded once")
        #expect(h.engine.status.pendingFromMac.isEmpty)
        #expect(h.engine.status.acceptingIds.isEmpty)
    }

    @Test func tryAllAgainRetriesTheFailedIdsAsTheyWerePressed() async throws {
        let h = makeHarness()
        let failedOne = record("f1"), failedTwo = record("f2"), ready = record("r")
        h.engine.status.pendingFromMac = [failedOne, ready, failedTwo]
        h.engine.status.failedAcceptIds = [failedOne.id, failedTwo.id]
        h.api.downloadFailCountRemaining["f2.mp3"] = 1   // f2 fails again

        let result = await h.engine.retryFailedAcceptsFromMac()
        #expect(result == SyncEngine.AcceptRunResult(added: 1, failed: 1))

        #expect(Set(h.engine.status.pendingFromMac.map(\.id)) == [ready.id, failedTwo.id], "r was not in the snapshot")
        #expect(h.engine.status.failedAcceptIds == [failedTwo.id], "f1 is done, f2 failed again")
        #expect(h.api.downloadFileCalls == ["f1.mp3", "f2.mp3"])
    }
}
