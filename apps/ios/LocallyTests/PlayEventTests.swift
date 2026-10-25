import Testing
import Foundation
@testable import Locally

// Play events (#397, plan 368): the store, recording at the count point, the push and the readers.

@MainActor
struct PlayEventStoreTests {
    private let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        return c
    }()
    private let release = UUID()
    private let track = UUID()

    private func tempFile() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true).appendingPathComponent("play-events.json")
    }

    private func date(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }

    private func store(url: URL? = nil, now: String = "2026-10-24T20:00:00Z") -> FilePlayEventStore {
        FilePlayEventStore(url: url ?? tempFile(), calendar: calendar, now: { date(now) })
    }

    @Test func appendStoresTheFieldsWithTheLocalDayAndMilliseconds() {
        let store = store()
        // 02:00 UTC on 24 Oct is still 23 Oct in Los Angeles.
        let id = store.append(releaseId: release, trackId: track, startedAt: Date(timeIntervalSince1970: 1_792_807_200.25))
        let event = store.events.first
        #expect(store.events.count == 1)
        #expect(event?.id == id)
        #expect(event?.startedAt == 1_792_807_200_250)
        #expect(event?.day == "2026-10-23")
        #expect(event?.listenedMs == 0)
        #expect(event?.pushedListenedMs == nil)
    }

    @Test func updateRaisesListenedMsAndNeverLowersOrExceedsADay() {
        let store = store()
        let id = store.append(releaseId: release, trackId: track, startedAt: date("2026-10-24T19:00:00Z"))
        store.updateListened(id: id, listenedMs: 40_000)
        store.updateListened(id: id, listenedMs: 10_000)
        #expect(store.events[0].listenedMs == 40_000)
        store.updateListened(id: id, listenedMs: 999_999_999)
        #expect(store.events[0].listenedMs == 86_400_000)
    }

    @Test func pendingIsNeverPushedOrHeardLongerSinceAndMarkingOnlyCoversWhatWasSent() {
        let store = store()
        let id = store.append(releaseId: release, trackId: track, startedAt: date("2026-10-24T19:00:00Z"))
        store.updateListened(id: id, listenedMs: 30_000)
        let sent = store.pending(liveReleases: nil, max: 500)
        #expect(sent.map(\.id) == [id])
        // More listening while the request was in flight.
        store.updateListened(id: id, listenedMs: 50_000)
        store.markPushed(sent)
        #expect(store.events[0].pushedListenedMs == 30_000)
        let again = store.pending(liveReleases: nil, max: 500)
        #expect(again.map(\.listenedMs) == [50_000])
        store.markPushed(again)
        #expect(store.pending(liveReleases: nil, max: 500).isEmpty)
    }

    @Test func pendingSkipsReleasesNotLiveAndHonoursTheBatchSizeOldestFirst() {
        let store = store()
        let other = UUID()
        _ = store.append(releaseId: other, trackId: track, startedAt: date("2026-10-24T10:00:00Z"))
        let second = store.append(releaseId: release, trackId: track, startedAt: date("2026-10-24T12:00:00Z"))
        let first = store.append(releaseId: release, trackId: track, startedAt: date("2026-10-24T11:00:00Z"))
        #expect(store.pending(liveReleases: [release], max: 500).map(\.id) == [first, second])
        #expect(store.pending(liveReleases: [release], max: 1).map(\.id) == [first])
    }

    @Test func eventsPast400DaysArePruned() {
        // just inside 400 days stays; just past it goes, on the append that adds it.
        let store = store(now: "2026-10-24T20:00:00Z")
        let kept = store.append(releaseId: release, trackId: track, startedAt: date("2025-09-20T20:00:00Z"))
        _ = store.append(releaseId: release, trackId: track, startedAt: date("2025-09-18T20:00:00Z"))
        let recent = store.append(releaseId: release, trackId: track, startedAt: date("2026-10-24T19:00:00Z"))
        #expect(store.events.map(\.id) == [kept, recent])
    }

    @Test func overTheCapTheOldestPushedGoFirstThenTheOldestUnpushed() {
        let url = tempFile()
        let base = date("2026-10-01T00:00:00Z")
        let old = (0..<FilePlayEventStore.maxEvents).map { i in
            PlayEvent(
                id: UUID(), releaseId: release, trackId: track, startedAt: Int64(base.timeIntervalSince1970 * 1000) + Int64(i) * 1000,
                day: "2026-10-01", listenedMs: 1000, pushedListenedMs: i == 5 ? nil : 1000
            )
        }
        let file = ["version": 1, "events": try! JSONSerialization.jsonObject(with: JSONEncoder().encode(old))] as [String: Any]
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? JSONSerialization.data(withJSONObject: file).write(to: url)
        let store = store(url: url)
        #expect(store.events.count == FilePlayEventStore.maxEvents)
        // The unpushed event 5 is older than most pushed ones but survives; the oldest pushed one (0) goes.
        let added = store.append(releaseId: release, trackId: track, startedAt: date("2026-10-24T19:00:00Z"))
        #expect(store.events.count == FilePlayEventStore.maxEvents)
        #expect(!store.events.contains { $0.id == old[0].id })
        #expect(store.events.contains { $0.id == old[5].id })
        #expect(store.events.contains { $0.id == added })
        #expect(store.events.contains { $0.id == old[1].id })
    }

    @Test func eventsSurviveARestartAndClearingMarkersMakesThemPendingAgain() {
        let url = tempFile()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let first = store(url: url)
        let id = first.append(releaseId: release, trackId: track, startedAt: date("2026-10-24T19:00:00Z"))
        first.updateListened(id: id, listenedMs: 12_000)
        first.markPushed(first.pending(liveReleases: nil, max: 500))
        let reopened = store(url: url)
        #expect(reopened.events.first?.listenedMs == 12_000)
        #expect(reopened.pending(liveReleases: nil, max: 500).isEmpty)
        reopened.clearPushedMarkers()
        #expect(reopened.pending(liveReleases: nil, max: 500).count == 1)
    }
}

@MainActor
struct PlayEventRecordingTests {
    let engine = FakePlaybackEngine()
    let access = FakePlaybackAccess()
    let session = FakePlaybackSession()
    let nowPlaying = FakeNowPlaying()
    let remote = FakeRemoteCommands()
    let events: FilePlayEventStore
    let counts = FakePlayCounts()
    let service: PlaybackService
    /// Boxed so the service's clock and the test move together.
    final class Clock { var now = Date(timeIntervalSince1970: 1_000_000) }
    let clock = Clock()

    init() {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true).appendingPathComponent("play-events.json")
        events = FilePlayEventStore(url: url, now: { Date(timeIntervalSince1970: 1_000_000) })
        let clock = self.clock
        service = PlaybackService(
            engine: engine, access: access, session: session, nowPlaying: nowPlaying, remote: remote,
            playCounts: counts, playEvents: events, now: { clock.now }
        )
    }

    private func release() -> Release {
        let tracks = (1...2).map {
            Track(id: UUID(), title: "Song \($0)", trackNumber: $0, discNumber: nil, filePath: "t\($0).mp3", originalName: "t\($0).mp3", durationSec: 200)
        }
        return Release(kind: .album, title: "Album", artist: "Artist", folderPath: "/lib", tracks: tracks)
    }

    private func settle() async {
        for _ in 0..<30 { await Task.yield() }
        try? await Task.sleep(for: .milliseconds(20))
    }

    /// One progress tick at `t` seconds after the clock's start, with the player at `position`.
    private func tick(_ t: Double, position: Double? = nil) {
        clock.now = Date(timeIntervalSince1970: 1_000_000 + t)
        engine.onProgress?(position ?? t, 200)
    }

    /// Half-second ticks from `from` to `through`, position following the clock.
    private func play(_ from: Double, _ through: Double, positionOffset: Double = 0) {
        for t in stride(from: from, through: through, by: 0.5) { tick(t, position: t + positionOffset) }
    }

    private func start() async -> Release {
        let r = release()
        service.play(release: r, startingAt: r.tracks[0].id)
        await settle()
        return r
    }

    @Test func anEventIsAppendedAtTheCountPointWithTheSessionStart() async {
        let r = await start()
        play(0, 29.5)
        #expect(events.events.isEmpty)
        play(30, 31)
        #expect(counts.increments.count == 1)
        #expect(events.events.count == 1)
        let event = events.events[0]
        // The session began at the first playing tick (clock 1,000,000 s), not at the count point.
        #expect(event.startedAt == 1_000_000_000)
        #expect(event.releaseId == r.id && event.trackId == r.tracks[0].id)
        #expect(event.pushedListenedMs == nil)
        // More ticks never add a second event.
        play(32, 50)
        #expect(events.events.count == 1)
    }

    @Test func listenedMsIsWrittenOnPauseAndExcludesPausedTime() async {
        _ = await start()
        play(0, 35)
        service.pause()
        #expect(events.events[0].listenedMs == 35_000)
        // A minute paused: ticks with the player still, clock moving.
        for t in stride(from: 36.0, through: 96, by: 0.5) { tick(t, position: 35) }
        service.resume()
        play(97, 107, positionOffset: 35 - 97)
        service.pause()
        // 35 s + 10 s heard; the 60 s paused add nothing.
        #expect(events.events[0].listenedMs == 45_000)
    }

    @Test func aSeekForwardAddsNothing() async {
        _ = await start()
        play(0, 35)
        // The listener drags to 100 s: one tick with a big jump, then playback goes on from there.
        tick(35.5, position: 100)
        play(36, 46, positionOffset: 100 - 36)
        service.pause()
        // 35 s before the seek and 10 s after it; the 65 s jump is not listening.
        #expect(events.events[0].listenedMs == 45_000)
    }

    @Test func aJumpBackOfMoreThanThreeSecondsStartsASecondEventAndTheFirstKeepsItsTime() async {
        _ = await start()
        play(0, 40)
        // Back to 0:00 at clock 41; 31 s later it counts again.
        tick(41, position: 0)
        play(41.5, 72, positionOffset: -41)
        #expect(counts.increments.count == 2)
        #expect(events.events.count == 2)
        #expect(events.events[0].listenedMs == 40_000)
        #expect(events.events[1].startedAt == 1_000_041_000)
        service.stop()
        #expect(events.events[1].listenedMs == 31_000)
    }

    @Test func skipStopFinishAndBackgroundAllWriteTheTime() async {
        let r = await start()
        play(0, 33)
        // The app goes to the background while playing.
        service.flushListened()
        #expect(events.events[0].listenedMs == 33_000)
        play(34, 37)
        // A skip to the next song writes what the first had.
        service.next()
        await settle()
        #expect(events.events[0].listenedMs == 37_000)
        #expect(service.currentItem?.trackId == r.tracks[1].id)
        // The second song plays to its end.
        clock.now = Date(timeIntervalSince1970: 2_000_000)
        for t in stride(from: 0.0, through: 45, by: 0.5) {
            clock.now = Date(timeIntervalSince1970: 2_000_000 + t)
            engine.onProgress?(t, 200)
        }
        #expect(events.events.count == 2)
        engine.end(.finished)
        await settle()
        #expect(events.events[1].listenedMs == 45_000)
        #expect(events.events[1].trackId == r.tracks[1].id)
    }

    @Test func aPlayThatNeverCountsLeavesNoEvent() async {
        _ = await start()
        play(0, 20)
        service.stop()
        #expect(events.events.isEmpty)
    }
}

extension SyncEngineTests {
    private func eventsStore() -> FilePlayEventStore {
        FilePlayEventStore(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true).appendingPathComponent("play-events.json"))
    }

    private func eventsLibrary(synced: Bool = true) -> (InMemoryLibraryStore, UUID) {
        let library = InMemoryLibraryStore()
        var release = Release(kind: .single, title: "T", artist: "A", folderPath: "/lib", tracks: [])
        if synced { release.syncedUpdatedAt = release.updatedAt }
        try? library.upsert(release)
        return (library, release.id)
    }

    @Test func reconcilePushesEventsInBatchesOf500AndNothingTwice() async {
        let store = eventsStore()
        let (library, release) = eventsLibrary()
        for _ in 0..<1200 { store.append(releaseId: release, trackId: UUID(), startedAt: Date()) }
        let h = makeHarness(library: library, playEvents: store)
        await h.engine.reconcile()
        #expect(h.api.putPlayEventsCalls.map(\.count) == [500, 500, 200])
        #expect(store.pending(liveReleases: nil, max: 5000).isEmpty)
        await h.engine.reconcile()
        #expect(h.api.putPlayEventsCalls.count == 3)
    }

    @Test func anEventHeardLongerSinceItWasPushedGoesOutAgain() async {
        let store = eventsStore()
        let (library, release) = eventsLibrary()
        let id = store.append(releaseId: release, trackId: UUID(), startedAt: Date())
        store.updateListened(id: id, listenedMs: 30_000)
        let h = makeHarness(library: library, playEvents: store)
        await h.engine.pushPlayEvents()
        store.updateListened(id: id, listenedMs: 90_000)
        await h.engine.pushPlayEvents()
        #expect(h.api.putPlayEventsCalls.map { $0.map(\.listenedMs) } == [[30_000], [90_000]])
    }

    @Test func a404LeavesEventsPendingWithNoErrorLineAndHoldsOffTheNextPush() async {
        let store = eventsStore()
        let (library, release) = eventsLibrary()
        store.append(releaseId: release, trackId: UUID(), startedAt: Date())
        let h = makeHarness(library: library, playEvents: store)
        h.api.putPlayEventsResults = [.failure(SyncApiError.notFound)]
        await h.engine.pushPlayEvents()
        #expect(h.api.putPlayEventsCalls.count == 1)
        #expect(store.pending(liveReleases: nil, max: 500).count == 1)
        #expect(h.engine.status.lastError == nil)
        await h.engine.pushPlayEvents()
        #expect(h.api.putPlayEventsCalls.count == 1)
    }

    @Test func a429AndAnyOtherFailureLeaveEventsPendingQuietly() async {
        for failure in [SyncApiError.rateLimited, SyncApiError.network("offline")] {
            let store = eventsStore()
            let (library, release) = eventsLibrary()
            store.append(releaseId: release, trackId: UUID(), startedAt: Date())
            let h = makeHarness(library: library, playEvents: store)
            h.api.putPlayEventsResults = [.failure(failure)]
            await h.engine.reconcile()
            #expect(store.pending(liveReleases: nil, max: 500).count == 1)
            #expect(h.engine.status.lastError == nil)
        }
    }

    @Test func eventsOfAReleaseNotYetOnTheServiceStayPending() async {
        let store = eventsStore()
        let (library, release) = eventsLibrary(synced: false)
        store.append(releaseId: release, trackId: UUID(), startedAt: Date())
        let h = makeHarness(library: library, playEvents: store)
        await h.engine.pushPlayEvents()
        #expect(h.api.putPlayEventsCalls.isEmpty)
        #expect(store.pending(liveReleases: nil, max: 500).count == 1)
    }

    @Test func eventsAreSentRightAfterTheCounts() async {
        let counts = FilePlayCountStore(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true).appendingPathComponent("plays.json"))
        let store = eventsStore()
        let (library, release) = eventsLibrary()
        let track = UUID()
        counts.increment(releaseId: release, trackId: track, at: Date())
        store.append(releaseId: release, trackId: track, startedAt: Date())
        let h = makeHarness(library: library, playCounts: counts, playEvents: store)
        await h.engine.reconcile()
        #expect(h.api.putPlaysCalls.count == 1)
        #expect(h.api.putPlayEventsCalls.count == 1)
        #expect(h.api.putPlayEventsCalls[0][0].trackId == track)
    }
}

struct PlayEventReadingTests {
    private let gb = Locale(identifier: "en_GB")
    private var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Europe/London")!
        return c
    }
    private func ms(_ iso: String) -> Int64 { Int64(ISO8601DateFormatter().date(from: iso)!.timeIntervalSince1970 * 1000) }
    private func at(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }

    @Test func lastPlayedReadsTodayYesterdayAndTheDateWithTheTime() {
        // 24 Oct 2026 is in BST (UTC+1): 20:14Z is 21:14.
        let now = at("2026-10-24T22:00:00Z")
        func label(_ iso: String) -> String { Copy.Stats.lastPlayedAtLabel(ms(iso), now: now, calendar: calendar, locale: gb) }
        #expect(label("2026-10-24T20:14:00Z") == "Today at 21:14")
        #expect(label("2026-10-23T08:02:00Z") == "Yesterday at 09:02")
        #expect(label("2026-10-12T17:30:00Z") == "12 Oct at 18:30")
        #expect(label("2025-03-02T10:00:00Z") == "2 Mar 2025 at 10:00")
        #expect(Copy.Stats.lastPlayedAtLabel(ms("2026-10-24T20:14:00Z"), now: now, calendar: calendar, locale: gb, lowercaseDay: true) == "today at 21:14")
    }

    @Test func theTimeZoneDecidesWhichDayItWas() {
        // London is UTC+1 in October: 23:30Z on 23 Oct is already 00:30 on 24 Oct there.
        let now = at("2026-10-24T12:00:00Z")
        #expect(Copy.Stats.lastPlayedAtLabel(ms("2026-10-23T23:30:00Z"), now: now, calendar: calendar, locale: gb) == "Today at 00:30")
    }

    @Test func aRowUsesTheTimeWhenThereIsOneAndTheDayLabelOtherwise() {
        var item = StatItem(id: "a", rank: 1, title: "T", subtitle: "A", plays: 3, lastPlayedDay: "2026-10-24", releaseId: nil, trackId: nil, coverPath: nil, medal: nil)
        let now = at("2026-10-24T22:00:00Z")
        #expect(Copy.Stats.lastPlayedLabel(item, today: "2026-10-24", now: now, calendar: calendar, locale: gb) == "Today")
        item.lastPlayedAt = ms("2026-10-24T20:14:00Z")
        #expect(Copy.Stats.lastPlayedLabel(item, today: "2026-10-24", now: now, calendar: calendar, locale: gb) == "Today at 21:14")
    }

    @Test func minutesAreListenedTimePlusTheLengthOfPlaysWithoutAnEvent() {
        var release = Release(kind: .single, title: "S", artist: "A", folderPath: "/lib", tracks: [])
        release.tracks = [Track(id: UUID(), title: "S", trackNumber: 1, discNumber: nil, filePath: "s.mp3", originalName: "s.mp3", durationSec: 200)]
        let track = release.tracks[0]
        func seconds(plays: Int, listenedMs: Int?, events: Int?) -> Double {
            let count = PlayCount(trackId: track.id.uuidString.lowercased(), releaseId: release.id.uuidString.lowercased(), plays: plays, lastPlayedDay: "2026-10-24", lastPlayedAt: 5, listenedMs: listenedMs, events: events)
            return PlayStats.aggregate(releases: [release], counts: [count]).tracks[0].seconds
        }
        // 5 plays, 3 with events heard 600 s in all: 600 s + 2 x 200 s.
        #expect(seconds(plays: 5, listenedMs: 600_000, events: 3) == 1000)
        // An older server sends no fields: plays x length, as before.
        #expect(seconds(plays: 5, listenedMs: nil, events: nil) == 1000)
        // More events than plays never goes negative.
        #expect(seconds(plays: 2, listenedMs: 300_000, events: 4) == 300)
        #expect(PlayStats.aggregate(releases: [release], counts: [PlayCount(trackId: track.id.uuidString, releaseId: release.id.uuidString, plays: 2, lastPlayedDay: nil, lastPlayedAt: 7, listenedMs: 0, events: 2)]).tracks[0].lastPlayedAt == 7)
    }

    @Test func theSongPageShowsTheTimeWhenTheServiceSentOne() throws {
        let release = Release(kind: .single, title: "S", artist: "A", folderPath: "/lib", tracks: [
            Track(id: UUID(), title: "S", trackNumber: 1, discNumber: nil, filePath: "s.mp3", originalName: "s.mp3", durationSec: 200),
        ])
        let track = release.tracks[0]
        let count = PlayCount(trackId: track.id.uuidString.lowercased(), releaseId: release.id.uuidString.lowercased(), plays: 3, lastPlayedDay: "2026-10-24", lastPlayedAt: ms("2026-10-24T20:14:00Z"), listenedMs: 1, events: 1)
        let plays = SongPlays.make(trackID: track.id, releaseID: release.id, total: 3, reads: [.today: PlaysSummary(tracks: [count], allTime: [])])
        #expect(plays.lastPlayedAt == ms("2026-10-24T20:14:00Z"))
        let model = try #require(SongPageModel(release: release, trackID: track.id, plays: plays, today: "2026-10-24", locale: gb, now: at("2026-10-24T22:00:00Z"), calendar: calendar))
        #expect(model.lastPlayedText == "today at 21:14")
        // Without the time, the day-level text stays.
        let oldPlays = SongPlays(total: 3, lastPlayedDay: "2026-10-23", byPeriod: [])
        let old = try #require(SongPageModel(release: release, trackID: track.id, plays: oldPlays, today: "2026-10-24", locale: gb, now: at("2026-10-24T22:00:00Z"), calendar: calendar))
        #expect(old.lastPlayedText == "yesterday")
    }
}
