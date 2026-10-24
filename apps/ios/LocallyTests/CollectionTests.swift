import Foundation
import Testing
@testable import Locally

/// Collections (#350): the wire fixtures every app parses, the queue a collection plays, the edit logic and the
/// model's saves. Plain fakes, no network.
struct CollectionFixtureTests {
    private static let dir: URL = {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { url.deleteLastPathComponent() }
        return url.appendingPathComponent("spec").appendingPathComponent("fixtures").appendingPathComponent("collections")
    }()

    static func data(_ name: String) throws -> Data {
        try Data(contentsOf: dir.appendingPathComponent(name))
    }

    private func decode(_ name: String) throws -> SyncCollection {
        try JSONDecoder.syncApi.decode(SyncCollection.self, from: try Self.data(name))
    }

    @Test func validFixtureDecodesWithItsTwoItems() throws {
        let record = try decode("valid.json")
        #expect(record.syncVersion == 1)
        #expect(record.name == "Late drives")
        #expect(record.origin == "mac")
        #expect(record.deleted == false)
        #expect(record.items == [
            .release(UUID(uuidString: "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90")!),
            .track(releaseId: UUID(uuidString: "7a0d4c52-1e3b-4f68-8a9d-2c5b7e1f4a63")!, trackId: UUID(uuidString: "c41e8b27-6d95-4a30-b1f2-9e7a3c5d8f04")!),
        ])
    }

    @Test func missingTrackFixtureIsValidOnTheWireAndShowsNoRow() throws {
        let record = try decode("missing-track.json")
        let releaseId = UUID(uuidString: "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90")!
        let release = Release(id: releaseId, kind: .single, title: "T", artist: "A", folderPath: "/f", tracks: [Track(title: "x", trackNumber: 1, filePath: "/f/x.mp3", originalName: "x.mp3")])
        #expect(CollectionQueue.rows(record.items, releases: [releaseId: release]).isEmpty)
    }

    @Test func unknownKindIsKeptAndRePushedKeyForKey() throws {
        let record = try decode("unknown-kind.json")
        #expect(record.items.count == 2)
        guard case .unknown = record.items[1] else { Issue.record("expected an unknown item"); return }
        // It is never shown or played.
        #expect(CollectionQueue.rows(record.items, releases: [:]).isEmpty)

        let reencoded = try JSONEncoder.syncApi.encode(record)
        let sent = try #require(try JSONSerialization.jsonObject(with: reencoded) as? [String: Any])
        let original = try #require(try JSONSerialization.jsonObject(with: try Self.data("unknown-kind.json")) as? [String: Any])
        let sentItems = try #require(sent["items"] as? [[String: Any]])
        let originalItems = try #require(original["items"] as? [[String: Any]])
        #expect(NSArray(array: sentItems).isEqual(to: originalItems))
        #expect(sentItems[1]["note"] as? String == "kept as sent")
        #expect(sent["version"] == nil)
    }

    @Test func invalidKnownItemIsRejectedLocally() throws {
        #expect(throws: (any Error).self) { try decode("invalid-known-item.json") }
    }

    @Test func aPageDropsAMalformedRecordWithoutFailingTheRest() throws {
        let good = String(decoding: try Self.data("valid.json"), as: UTF8.self)
        let bad = String(decoding: try Self.data("invalid-known-item.json"), as: UTF8.self)
        let page = Data("{\"collections\":[\(bad),\(good)],\"nextVersion\":4,\"hasMore\":false}".utf8)
        struct Response: Decodable { let collections: [SyncCollectionPageElement] }
        let decoded = try JSONDecoder.syncApi.decode(Response.self, from: page)
        #expect(decoded.collections.compactMap(\.collection).map(\.name) == ["Late drives"])
    }

    @Test func extraOrMissingKeysOnAKnownItemAreRefused() throws {
        let id = "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90"
        for json in [
            "{\"kind\":\"release\",\"releaseId\":\"\(id)\",\"extra\":1}",
            "{\"kind\":\"release\"}",
            "{\"kind\":\"track\",\"releaseId\":\"\(id)\",\"trackId\":\"nope\"}",
            "{\"releaseId\":\"\(id)\"}",
        ] {
            #expect(throws: (any Error).self) { try JSONDecoder().decode(CollectionItem.self, from: Data(json.utf8)) }
        }
    }
}

struct CollectionQueueTests {
    private func release(_ title: String, tracks: [(String, Int, Int?)], adopted: Bool = false) -> Release {
        Release(
            kind: .album, title: title, artist: "Artist \(title)", folderPath: "/f",
            tracks: tracks.map { Track(title: $0.0, trackNumber: $0.1, discNumber: $0.2, filePath: "/f/\($0.0).mp3", originalName: "\($0.0).mp3") },
            source: adopted ? .adopted : nil
        )
    }

    @Test func aReleaseExpandsToItsTracksByDiscThenNumber() {
        let r = release("A", tracks: [("c", 3, 2), ("a", 1, 1), ("d", 4, 2), ("b", 2, 1)])
        let queue = CollectionQueue.items([.release(r.id)], releases: [r.id: r])
        let titles = queue.map { id in r.tracks.first { $0.id == id.trackID }!.title }
        #expect(titles == ["a", "b", "c", "d"])
        #expect(queue.allSatisfy { $0.releaseID == r.id })
    }

    @Test func aTrackItemIsItselfAndOrderFollowsTheItems() {
        let r = release("A", tracks: [("a", 1, nil), ("b", 2, nil)])
        let s = release("S", tracks: [("s", 1, nil)])
        let queue = CollectionQueue.items([.track(releaseId: r.id, trackId: r.tracks[1].id), .release(s.id), .release(r.id)], releases: [r.id: r, s.id: s])
        #expect(queue.map(\.trackID) == [r.tracks[1].id, s.tracks[0].id, r.tracks[0].id, r.tracks[1].id])
    }

    @Test func skipsWhatThisPhoneCantPlay() {
        let held = release("Held", tracks: [("h", 1, nil)])
        let adopted = release("Mac", tracks: [("m", 1, nil)], adopted: true)
        let items: [CollectionItem] = [
            .release(UUID()),                                               // release unknown
            .track(releaseId: held.id, trackId: UUID()),                    // track gone
            .release(adopted.id),                                           // not held on this phone
            .unknown(.object(["kind": .string("tape-side")])),              // a kind this build doesn't know
            .release(held.id),
        ]
        let releases = [held.id: held, adopted.id: adopted]
        #expect(CollectionQueue.items(items, releases: releases).map(\.trackID) == [held.tracks[0].id])
        // The adopted release still shows, marked as not on this phone.
        let rows = CollectionQueue.rows(items, releases: releases)
        #expect(rows.map(\.isHeld) == [false, true])
        #expect(rows.map(\.title) == ["m", "h"])
    }

    @Test func playlistGuideListsHeldTracksInOrderAndCountsTheRest() {
        let r = release("A", tracks: [("c", 3, 2), ("a", 1, 1), ("b", 2, 1)])
        let adopted = release("Mac", tracks: [("m1", 1, nil), ("m2", 2, nil)], adopted: true)
        let items: [CollectionItem] = [
            .track(releaseId: r.id, trackId: r.tracks[0].id),
            .release(adopted.id),
            .release(r.id),
            .track(releaseId: r.id, trackId: r.tracks[0].id),
        ]
        let guide = CollectionQueue.playlistGuide(items, releases: [r.id: r, adopted.id: adopted])
        #expect(guide.titles == ["c", "a", "b", "c", "c"])
        #expect(guide.leftOut == 2)
        #expect(Copy.Collections.leftOutOfGuide(2) == "2 tracks aren't on this iPhone.")
        #expect(Copy.Collections.leftOutOfGuide(1) == "1 track isn't on this iPhone.")
        #expect(CollectionQueue.playlistGuide(items, releases: [:]).titles.isEmpty)
    }

    @Test func aTrackFromAReleaseThatIsAlsoAnItemPlaysTwice() {
        let r = release("A", tracks: [("a", 1, nil)])
        let rows = CollectionQueue.rows([.release(r.id), .track(releaseId: r.id, trackId: r.tracks[0].id)], releases: [r.id: r])
        #expect(rows.count == 2)
        #expect(Set(rows.map(\.id)).count == 2)
    }
}

struct CollectionEditTests {
    private func items(_ n: Int) -> [CollectionItem] { (0..<n).map { _ in .release(UUID()) } }

    @Test func movesWithOnMoveOffsets() {
        let a = items(4)
        let visible = [0, 1, 2, 3]
        #expect(CollectionEdit.moved(a, visible: visible, from: [0], to: 3) == [a[1], a[2], a[0], a[3]])
        #expect(CollectionEdit.moved(a, visible: visible, from: [3], to: 0) == [a[3], a[0], a[1], a[2]])
        #expect(CollectionEdit.moved(a, visible: visible, from: [1, 2], to: 4) == [a[0], a[3], a[1], a[2]])
    }

    @Test func moveUpAndDownStepOnePlaceAndStopAtTheEnds() {
        let a = items(3)
        let visible = [0, 1, 2]
        #expect(CollectionEdit.moved(a, visible: visible, position: 1, by: -1) == [a[1], a[0], a[2]])
        #expect(CollectionEdit.moved(a, visible: visible, position: 1, by: 1) == [a[0], a[2], a[1]])
        #expect(CollectionEdit.moved(a, visible: visible, position: 0, by: -1) == a)
        #expect(CollectionEdit.moved(a, visible: visible, position: 2, by: 1) == a)
    }

    @Test func hiddenItemsKeepTheirSlotsWhenTheShownOnesMove() {
        let unknown = CollectionItem.unknown(.object(["kind": .string("tape-side")]))
        let a = items(3)
        let all = [a[0], unknown, a[1], a[2]]
        let visible = [0, 2, 3]
        #expect(CollectionEdit.moved(all, visible: visible, position: 2, by: -1) == [a[0], unknown, a[2], a[1]])
        #expect(CollectionEdit.removed(all, visible: visible, position: 1) == [a[0], unknown, a[2]])
    }

    @Test func visibleHidesWhatDoesNotResolve() {
        let r = Release(kind: .single, title: "T", artist: "A", folderPath: "/f", tracks: [Track(title: "x", trackNumber: 1, filePath: "/f/x", originalName: "x")])
        let all: [CollectionItem] = [.release(r.id), .release(UUID()), .track(releaseId: r.id, trackId: r.tracks[0].id), .track(releaseId: r.id, trackId: UUID()), .unknown(.null)]
        #expect(CollectionEdit.visible(all, releases: [r.id: r]) == [0, 2])
    }

    @Test func appendingSkipsDuplicatesAndStopsAtTheCap() {
        let a = items(2)
        let result = CollectionEdit.appended([a[0]], [a[0], a[1], a[1]])
        #expect(result.items == [a[0], a[1]])
        #expect(result.added == 1)
        let full = CollectionEdit.appended(items(MusicCollection.maxItems), [.release(UUID())])
        #expect(full.added == 0)
        #expect(full.items.count == MusicCollection.maxItems)
    }

    @Test func nameRulesTrimAndLimit() {
        #expect(MusicCollection.validName("  Late drives  ") == "Late drives")
        #expect(MusicCollection.validName("   ") == nil)
        #expect(MusicCollection.validName(String(repeating: "x", count: 100)) != nil)
        #expect(MusicCollection.validName(String(repeating: "x", count: 101)) == nil)
        #expect(MusicCollection.validName("bad\u{0007}name") == nil)
    }
}

@MainActor
struct CollectionsModelTests {
    private struct Setup {
        let model: CollectionsModel
        let store: InMemoryCollectionStore
        let library: InMemoryLibraryStore
        let hook: FakeCollectionSyncHook
        let release: Release
    }

    private func setup(now: @escaping () -> Date = { Date() }) throws -> Setup {
        let store = InMemoryCollectionStore()
        let library = InMemoryLibraryStore()
        let hook = FakeCollectionSyncHook()
        let release = Release(kind: .album, title: "Album", artist: "Artist", folderPath: "/f", tracks: [
            Track(title: "one", trackNumber: 1, filePath: "/f/1", originalName: "1"),
            Track(title: "two", trackNumber: 2, filePath: "/f/2", originalName: "2"),
        ])
        try library.upsert(release)
        let model = CollectionsModel(store: store, library: library, hook: hook, deviceName: { "Toby's iPhone" }, now: now)
        model.reload()
        return Setup(model: model, store: store, library: library, hook: hook, release: release)
    }

    @Test func createSavesTrimsTellsSyncAndRefusesBadNames() throws {
        let s = try setup()
        #expect(try s.model.create(name: "   ") == nil)
        let id = try #require(try s.model.create(name: "  Late drives ", items: [.release(s.release.id), .release(s.release.id)]))
        let saved = try #require(try s.store.get(id))
        #expect(saved.name == "Late drives")
        #expect(saved.origin == "ios")
        #expect(saved.originDevice == "Toby's iPhone")
        #expect(saved.items == [.release(s.release.id)])
        #expect(s.hook.changed == [id])
        #expect(s.model.trackCount(of: saved) == 2)
    }

    @Test func editsBumpUpdatedAtAndQueueSync() throws {
        let s = try setup()
        let id = try #require(try s.model.create(name: "Mix"))
        let created = try #require(try s.store.get(id)).updatedAt
        #expect(try s.model.add([.track(releaseId: s.release.id, trackId: s.release.tracks[0].id), .release(s.release.id)], to: id) == 2)
        #expect(try s.model.add([.release(s.release.id)], to: id) == 0)
        #expect(try s.model.rename(id, to: "Mixtape"))
        #expect(try !s.model.rename(id, to: ""))
        try s.model.move(id, position: 1, by: -1)
        let saved = try #require(try s.store.get(id))
        #expect(saved.name == "Mixtape")
        #expect(saved.items == [.release(s.release.id), .track(releaseId: s.release.id, trackId: s.release.tracks[0].id)])
        #expect(saved.updatedAt > created)
        #expect(s.hook.changed.count == 4)
        try s.model.remove(id, position: 0)
        #expect(try s.store.get(id)?.items.count == 1)
    }

    @Test func deleteRemovesAndQueuesATombstone() throws {
        let s = try setup()
        let id = try #require(try s.model.create(name: "Mix"))
        try s.model.delete(id)
        #expect(try s.store.get(id) == nil)
        #expect(s.hook.deleted == [id])
        #expect(s.model.collections.isEmpty)
    }

    @Test func everyEditThrowsWhenTheStoreCannotSaveAndChangesNothing() throws {
        let s = try setup()
        let a = CollectionItem.release(s.release.id)
        let b = CollectionItem.track(releaseId: s.release.id, trackId: s.release.tracks[0].id)
        let id = try #require(try s.model.create(name: "Mix", items: [a, b]))
        s.hook.reset()
        let before = try #require(try s.store.get(id))
        let failure = CocoaError(.fileWriteUnknown)

        s.store.upsertError = failure
        #expect(throws: (any Error).self) { try s.model.rename(id, to: "Other") }
        s.store.upsertError = failure
        #expect(throws: (any Error).self) { try s.model.move(id, position: 1, by: -1) }
        s.store.upsertError = failure
        #expect(throws: (any Error).self) { try s.model.move(id, from: [0], to: 2) }
        s.store.upsertError = failure
        #expect(throws: (any Error).self) { try s.model.remove(id, position: 0) }
        s.store.deleteError = failure
        #expect(throws: (any Error).self) { try s.model.delete(id) }

        #expect(s.model.failure != nil)
        #expect(try s.store.get(id) == before)
        #expect(s.hook.changed.isEmpty)
        #expect(s.hook.deleted.isEmpty)
        // Try again works once the store does.
        try s.model.delete(id)
        #expect(s.hook.deleted == [id])
    }

    @Test func thePlayPillAndRowsSpeakTheSameStateAsTheirGlyphs() {
        #expect(CollectionPlayState.pillLabel(isCurrentQueue: false, isPlaying: true) == Copy.Collections.play)
        #expect(CollectionPlayState.pillLabel(isCurrentQueue: true, isPlaying: false) == Copy.Collections.play)
        #expect(CollectionPlayState.pillLabel(isCurrentQueue: true, isPlaying: true) == Copy.Collections.pause)
        #expect(CollectionPlayState.rowLabel("A, B", isCurrentRow: true, isPlaying: true) == "Pause A, B")
        #expect(CollectionPlayState.rowLabel("A, B", isCurrentRow: true, isPlaying: false) == "Play A, B")
        #expect(CollectionPlayState.rowLabel("A, B", isCurrentRow: false, isPlaying: true) == "Play A, B")
        #expect(CollectionPlayState.rowValue(isCurrentRow: true, isPlaying: true) == "Playing")
        #expect(CollectionPlayState.rowValue(isCurrentRow: true, isPlaying: false) == "Paused")
        #expect(CollectionPlayState.rowValue(isCurrentRow: false, isPlaying: true).isEmpty)
        #expect(CollectionPlayState.rowValue(isCurrentRow: false, isPlaying: false).isEmpty)
    }

    @Test func aFailedSaveThrowsAndQueuesNothing() throws {
        let s = try setup()
        let id = try #require(try s.model.create(name: "Mix"))
        s.hook.reset()
        s.store.upsertError = CocoaError(.fileWriteUnknown)
        #expect(throws: (any Error).self) { try s.model.add([.release(s.release.id)], to: id) }
        #expect(s.model.failure != nil)
        #expect(s.hook.changed.isEmpty)
        #expect(try s.store.get(id)?.items.isEmpty == true)
        s.store.upsertError = CocoaError(.fileWriteUnknown)
        #expect(throws: (any Error).self) { try s.model.create(name: "Other") }
        // The next save works and clears the failure.
        #expect(try s.model.add([.release(s.release.id)], to: id) == 1)
        #expect(s.model.failure == nil)
    }

    @Test func anUnreadableStoreIsAReadFailureNotAnEmptyLibrary() throws {
        let s = try setup()
        s.store.allError = CocoaError(.fileReadUnknown)
        s.model.reload()
        #expect(s.model.readFailure != nil)
        s.store.allError = nil
        s.model.reload()
        #expect(s.model.readFailure == nil)
    }

    @Test func theLengthIsTheTracksThisPhoneCanPlay() throws {
        let s = try setup()
        var held = s.release
        held.tracks[0].durationSec = 120
        held.tracks[1].durationSec = 60
        try s.library.upsert(held)
        let macOnly = Release(kind: .single, title: "M", artist: "A", folderPath: "/m", tracks: [Track(title: "m", trackNumber: 1, filePath: "", originalName: "", durationSec: 999)], source: .adopted)
        try s.library.upsert(macOnly)
        let id = try #require(try s.model.create(name: "Mix", items: [.release(held.id), .release(macOnly.id)]))
        let collection = try #require(s.model.collection(id))
        #expect(s.model.playableDuration(of: collection) == 180)
        #expect(TrackLength.spokenTotal(1920) == "32 minutes")
        #expect(Copy.Collections.rowLabel(name: "Late drives", tracks: 8, length: "32 minutes") == "Late drives, 8 tracks, 32 minutes")
        #expect(Copy.Collections.rowLabel(name: "Late drives", tracks: 8) == "Late drives, 8 tracks")
        #expect(Copy.Collections.addSheetTitle == "Add to collection")
    }

    @Test func coverIsTheFirstFourDifferentCoversOnly() throws {
        let s = try setup()
        var covered = s.release
        covered.coverPath = "/c.jpg"
        try s.library.upsert(covered)
        let id = try #require(try s.model.create(name: "Mix", items: [.release(covered.id), .track(releaseId: covered.id, trackId: covered.tracks[0].id)]))
        let collection = try #require(s.model.collection(id))
        #expect(s.model.coverReleaseIDs(of: collection) == [covered.id])
    }
}
