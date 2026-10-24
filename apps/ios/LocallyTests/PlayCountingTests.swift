import Testing
import Foundation
@testable import Locally

// Counting plays in Locally's own player and pushing them (#337).

struct PlayCounterTests {
    /// Plays `seconds` in half-second ticks from `start`, returning how many plays counted and when (seconds into this run).
    private func play(_ counter: inout PlayCounter, from start: Double = 0, seconds: Double, duration: Double, playing: Bool = true, clock: inout Double) -> [Double] {
        var counted: [Double] = []
        var elapsed = 0.0
        var position = start
        // The first sample of a run sets the baseline.
        if counter.push(PlaySample(at: clock, playing: playing, positionSec: position, durationSec: duration)) { counted.append(elapsed) }
        while elapsed < seconds {
            elapsed += 0.5
            clock += 0.5
            if playing { position += 0.5 }
            if counter.push(PlaySample(at: clock, playing: playing, positionSec: position, durationSec: duration)) { counted.append(elapsed) }
        }
        return counted
    }

    @Test func aPlayCountsAtThirtySeconds() {
        var counter = PlayCounter()
        var clock = 0.0
        #expect(play(&counter, seconds: 29.5, duration: 200, clock: &clock).isEmpty)
        var fresh = PlayCounter()
        clock = 0
        #expect(play(&fresh, seconds: 40, duration: 200, clock: &clock) == [30])
    }

    @Test func aShortTrackCountsAtNinetyPercent() {
        var counter = PlayCounter()
        var clock = 0.0
        // 20 s long: 18 s is the threshold, not 30.
        #expect(play(&counter, seconds: 17.5, duration: 20, clock: &clock).isEmpty)
        var fresh = PlayCounter()
        clock = 0
        #expect(play(&fresh, seconds: 19, duration: 20, clock: &clock) == [18])
    }

    @Test func aPlayCountsOncePerSession() {
        var counter = PlayCounter()
        var clock = 0.0
        #expect(play(&counter, seconds: 120, duration: 200, clock: &clock) == [30])
    }

    @Test func pausingAndResumingNeitherRestartsNorRecounts() {
        var counter = PlayCounter()
        var clock = 0.0
        #expect(play(&counter, seconds: 20, duration: 200, clock: &clock).isEmpty)
        // Paused for a minute: no listening, no count.
        #expect(play(&counter, from: 20, seconds: 60, duration: 200, playing: false, clock: &clock).isEmpty)
        // Resumed: 10 more seconds make 30 listened, so it counts once, then never again.
        #expect(play(&counter, from: 20, seconds: 10, duration: 200, clock: &clock).count == 1)
        #expect(play(&counter, from: 30, seconds: 20, duration: 200, playing: false, clock: &clock).isEmpty)
        #expect(play(&counter, from: 30, seconds: 60, duration: 200, clock: &clock).isEmpty)
    }

    @Test func replayingFromTheStartAfterItCountedIsANewPlay() {
        var counter = PlayCounter()
        var clock = 0.0
        #expect(play(&counter, seconds: 40, duration: 200, clock: &clock) == [30])
        // Back to 0:00 (a jump of more than 3 seconds), then another 30 s.
        #expect(play(&counter, from: 0, seconds: 40, duration: 200, clock: &clock) == [30])
    }

    @Test func aSeekForwardIsNotListening() {
        var counter = PlayCounter()
        var clock = 0.0
        _ = play(&counter, seconds: 5, duration: 200, clock: &clock)
        // Jumps from 5 s to 100 s in half a second: no credit.
        clock += 0.5
        #expect(counter.push(PlaySample(at: clock, playing: true, positionSec: 100, durationSec: 200)) == false)
        #expect(play(&counter, from: 100, seconds: 20, duration: 200, clock: &clock).isEmpty)
    }
}

@MainActor
struct PlayCountStoreTests {
    private let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        return c
    }()
    private let release = UUID()
    private let track = UUID()

    private func tempFile() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true).appendingPathComponent("plays.json")
    }

    private func date(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }

    @Test func playsAddUpAndFillThePhonesLocalDayBuckets() {
        let store = FilePlayCountStore(url: tempFile(), calendar: calendar)
        // 02:00 UTC on 24 Oct is still 23 Oct in Los Angeles.
        store.increment(releaseId: release, trackId: track, at: date("2026-10-24T02:00:00Z"))
        store.increment(releaseId: release, trackId: track, at: date("2026-10-24T05:00:00Z"))
        store.increment(releaseId: release, trackId: track, at: date("2026-10-24T20:00:00Z"))
        #expect(store.count(releaseId: release, trackId: track) == 3)
        let pending = store.pending()
        #expect(pending == [SyncPlayCount(releaseId: release, trackId: track, count: 3, days: [SyncPlayDay(day: "2026-10-23", count: 2), SyncPlayDay(day: "2026-10-24", count: 1)])])
    }

    @Test func daysAreKept400DaysAndTheCountIsKeptForever() {
        let store = FilePlayCountStore(url: tempFile(), calendar: calendar)
        store.increment(releaseId: release, trackId: track, at: date("2025-01-01T20:00:00Z"))
        store.increment(releaseId: release, trackId: track, at: date("2026-10-24T20:00:00Z"))
        let entry = store.pending().first
        #expect(entry?.count == 2)
        #expect(entry?.days == [SyncPlayDay(day: "2026-10-24", count: 1)])
    }

    @Test func countsSurviveARestartAndAreWrittenToTheFile() throws {
        let url = tempFile()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let store = FilePlayCountStore(url: url, calendar: calendar)
        store.increment(releaseId: release, trackId: track, at: date("2026-10-24T20:00:00Z"))
        store.markPushed(store.pending())
        let reopened = FilePlayCountStore(url: url, calendar: calendar)
        #expect(reopened.count(releaseId: release, trackId: track) == 1)
        #expect(reopened.pending().isEmpty)
    }

    @Test func onlyWhatIsAheadOfThePushIsPending() {
        let store = FilePlayCountStore(url: tempFile(), calendar: calendar)
        store.increment(releaseId: release, trackId: track, at: date("2026-10-23T20:00:00Z"))
        let sent = store.pending()
        // A play counted while the request was in flight stays pending.
        store.increment(releaseId: release, trackId: track, at: date("2026-10-24T20:00:00Z"))
        store.markPushed(sent)
        let rest = store.pending()
        #expect(rest == [SyncPlayCount(releaseId: release, trackId: track, count: 2, days: [SyncPlayDay(day: "2026-10-24", count: 1)])])
        store.markPushed(rest)
        #expect(store.pending().isEmpty)
    }

    @Test func clearingTheMarkersKeepsTheCountsAndMakesEverythingPendingAgain() {
        let store = FilePlayCountStore(url: tempFile(), calendar: calendar)
        store.increment(releaseId: release, trackId: track, at: date("2026-10-24T20:00:00Z"))
        store.markPushed(store.pending())
        store.clearPushedMarkers()
        #expect(store.count(releaseId: release, trackId: track) == 1)
        #expect(store.pending().count == 1)
    }

    @Test func aRequestHoldsAtMost500EntriesAnd2000DayRows() {
        let store = FilePlayCountStore(url: tempFile(), calendar: calendar)
        for _ in 0..<1200 { store.increment(releaseId: UUID(), trackId: UUID(), at: date("2026-10-24T20:00:00Z")) }
        #expect(store.pending().count == 500)
        // One day row per entry here, so 3 rows allow 3 entries.
        #expect(store.pending(maxEntries: 500, maxDayRows: 3).count == 3)
    }

    @Test func dayKeysAreGregorianUnderOtherCalendars() {
        let instant = date("2026-10-24T20:00:00Z")
        for identifier in [Calendar.Identifier.buddhist, .japanese, .islamicUmmAlQura, .gregorian] {
            var other = Calendar(identifier: identifier)
            other.timeZone = TimeZone(identifier: "America/Los_Angeles")!
            let store = FilePlayCountStore(url: tempFile(), calendar: other)
            store.increment(releaseId: release, trackId: track, at: date("2025-01-01T20:00:00Z"))
            store.increment(releaseId: release, trackId: track, at: instant)
            let entry = store.pending().first
            #expect(entry?.days == [SyncPlayDay(day: "2026-10-24", count: 1)], "\(identifier)")
            #expect(entry?.count == 2, "\(identifier)")
        }
    }

    @Test func theLiteralPutBodyDecodesAndEncodesBack() throws {
        let literal = #"{"counts":[{"releaseId":"6f1c2a9e-3b4d-4c5e-8f70-1a2b3c4d5e6f","trackId":"0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d","count":3,"source":"locally","days":[{"day":"2026-10-23","count":2}]}]}"#
        let body = try JSONDecoder().decode(SyncPlayCountsBody.self, from: Data(literal.utf8))
        #expect(body.counts == [SyncPlayCount(
            releaseId: UUID(uuidString: "6f1c2a9e-3b4d-4c5e-8f70-1a2b3c4d5e6f")!, trackId: UUID(uuidString: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d")!,
            count: 3, source: "locally", days: [SyncPlayDay(day: "2026-10-23", count: 2)]
        )])
        let encoded = try JSONEncoder.syncApi.encode(body)
        let expected = try JSONSerialization.jsonObject(with: Data(literal.utf8)) as? NSDictionary
        let actual = try JSONSerialization.jsonObject(with: encoded) as? NSDictionary
        #expect(actual == expected)
        // Entries built here are lowercase, say "locally", and leave out an absent `days`.
        let plain = try JSONEncoder.syncApi.encode(SyncPlayCount(releaseId: UUID(), trackId: UUID(), count: 1))
        let text = String(decoding: plain, as: UTF8.self)
        #expect(text.contains(#""source":"locally""#))
        #expect(!text.contains("days"))
        let object = try #require(try JSONSerialization.jsonObject(with: plain) as? [String: Any])
        let ids = [object["releaseId"], object["trackId"]].compactMap { $0 as? String }
        #expect(ids.count == 2)
        #expect(ids.allSatisfy { $0 == $0.lowercased() })
    }
}

extension SyncEngineTests {
    private func tempStore() -> FilePlayCountStore {
        FilePlayCountStore(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true).appendingPathComponent("plays.json"))
    }

    /// A library of `n` releases the service already has (pushed, so `syncedUpdatedAt` is set).
    private func syncedLibrary(_ n: Int, synced: Bool = true) -> (InMemoryLibraryStore, [UUID]) {
        let library = InMemoryLibraryStore()
        var ids: [UUID] = []
        for _ in 0..<n {
            var release = Release(kind: .single, title: "T", artist: "A", folderPath: "/lib", tracks: [])
            if synced { release.syncedUpdatedAt = release.updatedAt }
            try? library.upsert(release)
            ids.append(release.id)
        }
        return (library, ids)
    }

    private func counts(_ n: Int, releases: [UUID], store: FilePlayCountStore) {
        for i in 0..<n { store.increment(releaseId: releases[i % releases.count], trackId: UUID(), at: Date()) }
    }

    @Test func reconcilePushesPlaysInBatchesOf500AndNothingTwice() async {
        let store = tempStore()
        let (library, ids) = syncedLibrary(12)
        counts(1200, releases: ids, store: store)
        let h = makeHarness(library: library, playCounts: store)
        await h.engine.reconcile()
        #expect(h.api.putPlaysCalls.map(\.count) == [500, 500, 200])
        #expect(h.api.putPlaysCalls.flatMap { $0 }.allSatisfy { $0.source == "locally" })
        await h.engine.reconcile()
        #expect(h.api.putPlaysCalls.count == 3)
    }

    @Test func aFailedPushStaysPendingAndGoesOutNextTime() async {
        let store = tempStore()
        let (library, ids) = syncedLibrary(1)
        counts(3, releases: ids, store: store)
        let h = makeHarness(library: library, playCounts: store)
        h.api.putPlaysResults = [.failure(SyncApiError.network("offline"))]
        await h.engine.reconcile()
        #expect(h.api.putPlaysCalls.count == 1)
        #expect(store.pending().count == 3)
        await h.engine.reconcile()
        #expect(h.api.putPlaysCalls.count == 2)
        #expect(h.api.putPlaysCalls[1].count == 3)
        #expect(store.pending().isEmpty)
    }

    @Test func playsOfAReleaseNotYetOnTheServiceStayPendingUntilItIs() async throws {
        let store = tempStore()
        let (library, ids) = syncedLibrary(1, synced: false)
        let track = UUID()
        store.increment(releaseId: ids[0], trackId: track, at: Date())
        store.increment(releaseId: ids[0], trackId: track, at: Date())
        let h = makeHarness(library: library, playCounts: store)
        // Not uploaded: the push sends nothing and the plays stay pending.
        await h.engine.pushPlays()
        #expect(h.api.putPlaysCalls.isEmpty)
        #expect(store.pending().count == 1)
        // Uploaded: the next push sends them with their days.
        var release = try #require(try library.all().first)
        release.syncedUpdatedAt = release.updatedAt
        try library.upsert(release)
        await h.engine.pushPlays()
        #expect(h.api.putPlaysCalls.count == 1)
        let sent = try #require(h.api.putPlaysCalls.first?.first)
        #expect(sent.count == 2)
        #expect(sent.days?.map(\.count) == [2])
        #expect(store.pending().isEmpty)
    }

    @Test func signOutKeepsTheCountsAndClearsTheMarkers() async {
        let store = tempStore()
        let (library, ids) = syncedLibrary(1)
        let track = UUID()
        store.increment(releaseId: ids[0], trackId: track, at: Date())
        let h = makeHarness(library: library, playCounts: store)
        await h.engine.reconcile()
        #expect(store.pending().isEmpty)
        await h.engine.signOut()
        #expect(store.count(releaseId: ids[0], trackId: track) == 1)
        #expect(store.pending().count == 1)
    }

    @Test func deletingTheAccountKeepsTheCountsAndClearsTheMarkers() async {
        let store = tempStore()
        let (library, ids) = syncedLibrary(1)
        let track = UUID()
        store.increment(releaseId: ids[0], trackId: track, at: Date())
        let h = makeHarness(library: library, playCounts: store)
        await h.engine.reconcile()
        let deleted = await h.engine.deleteAccount()
        #expect(deleted)
        #expect(store.count(releaseId: ids[0], trackId: track) == 1)
        #expect(store.pending().count == 1)
    }
}

/// An in-memory install id: made on first use, then the same.
final class InMemoryInstallIdStore: InstallIdStoring {
    private var stored: UUID?
    private(set) var created = 0
    func installId() -> UUID {
        if let stored { return stored }
        created += 1
        let made = UUID()
        stored = made
        return made
    }
}

extension SyncEngineTests {
    @Test func theInstallIdIsMadeOnceAndSentAtEverySignIn() async throws {
        let ids = InMemoryInstallIdStore()
        let account = InMemorySyncAccountStore()
        let h = makeHarness(api: FakeSyncApi(), account: account, installIds: ids)
        try await h.engine.verify(email: "toby@example.com", code: "123456")
        await h.engine.signOut()
        try await h.engine.verify(email: "toby@example.com", code: "123456")
        let sent = h.api.verifyCalls.map(\.installId)
        #expect(sent.count == 2)
        #expect(sent[0] != nil)
        #expect(sent[0] == sent[1])
        #expect(sent[0] == ids.installId().uuidString.lowercased())
        #expect(ids.created == 1)
    }

    @Test func aSignInWithoutAnInstallIdStoreSendsNone() async throws {
        let h = makeHarness()
        try await h.engine.verify(email: "toby@example.com", code: "123456")
        #expect(h.api.verifyCalls.first?.installId == nil)
    }
}

struct SignInBodyTests {
    @Test func theLiteralSignInBodyWithAnInstallIdDecodesAndEncodesBack() throws {
        let literal = #"{"email":"toby@example.com","code":"123456","deviceName":"Toby's iPhone","platform":"ios","installId":"0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"}"#
        let body = try JSONDecoder().decode(SyncVerifyRequest.self, from: Data(literal.utf8))
        #expect(body == SyncVerifyRequest(email: "toby@example.com", code: "123456", deviceName: "Toby's iPhone", platform: "ios", installId: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"))
        let encoded = try JSONEncoder().encode(body)
        #expect(try JSONSerialization.jsonObject(with: encoded) as? NSDictionary == JSONSerialization.jsonObject(with: Data(literal.utf8)) as? NSDictionary)
        // Without an id the key is left out.
        let plain = try JSONEncoder().encode(SyncVerifyRequest(email: "a@b.c", code: "1", deviceName: "d", platform: "ios", installId: nil))
        #expect(!String(decoding: plain, as: UTF8.self).contains("installId"))
    }
}
