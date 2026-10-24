import Testing
import Foundation
@testable import Locally

@MainActor
struct PlaybackServiceTests {
    let engine = FakePlaybackEngine()
    let access = FakePlaybackAccess()
    let session = FakePlaybackSession()
    let nowPlaying = FakeNowPlaying()
    let remote = FakeRemoteCommands()
    let service: PlaybackService

    init() {
        service = PlaybackService(
            engine: engine, access: access, session: session, nowPlaying: nowPlaying, remote: remote,
            coverData: { _ in Data([1, 2, 3]) }
        )
    }

    /// A release whose `tracks` array is deliberately not in play order.
    private func release(adopted: Bool = false) -> Release {
        func track(_ n: Int, disc: Int?) -> Track {
            Track(id: UUID(), title: "Song \(n)", trackNumber: n, discNumber: disc, filePath: "t\(n).mp3", originalName: "t\(n).mp3", durationSec: 200)
        }
        var release = Release(
            kind: .album, title: "Album", artist: "Artist", folderPath: "/lib",
            tracks: [track(3, disc: 2), track(1, disc: 1), track(4, disc: 2), track(2, disc: 1)]
        )
        if adopted { release.source = .adopted }
        return release
    }

    private func id(_ release: Release, _ n: Int) -> UUID {
        release.tracks.first { $0.trackNumber == n }!.id
    }

    /// Lets the run loop's task take its turns.
    /// Yields until `condition` holds (up to a generous limit), so a test waits for an event, not a time.
    private func waitUntil(_ condition: () -> Bool) async {
        for _ in 0..<2000 where !condition() { await Task.yield(); try? await Task.sleep(for: .milliseconds(1)) }
    }

    private func settle() async {
        for _ in 0..<30 { await Task.yield() }
        try? await Task.sleep(for: .milliseconds(20))
    }

    @Test func queueIsDiscThenTrackFromTheTappedRow() async {
        let r = release()
        service.play(release: r, startingAt: id(r, 2))
        await settle()
        #expect(service.queue?.items == [2, 3, 4].map { QueueItem(releaseId: r.id, trackId: id(r, $0)) })
        #expect(service.queue?.context == .release(r.id))
        #expect(engine.played.map(\.lastPathComponent) == ["t2.mp3"])
        #expect(service.currentTrack?.trackNumber == 2)
        #expect(session.activations == 1)
        #expect(service.isPlaying)
    }

    @Test func playingEveryItemWalksTheQueueThenClearsIt() async {
        let r = release()
        service.play(release: r, startingAt: id(r, 1))
        for _ in 0..<4 {
            await settle()
            engine.end(.finished)
        }
        await settle()
        #expect(engine.played.map(\.lastPathComponent) == ["t1.mp3", "t2.mp3", "t3.mp3", "t4.mp3"])
        #expect(service.hasQueue == false)
        #expect(nowPlaying.published.last! == nil)
        #expect(session.deactivations == 1)
    }

    @Test func accessOpensAndClosesOncePerItem() async {
        let r = release()
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        #expect(access.opened.count == 1)
        #expect(access.isOpen.count == 1)
        engine.end(.finished)
        await settle()
        #expect(access.closed.count == 1)
        #expect(access.opened.count == 2)
        #expect(access.isOpen.count == 1)
        service.next()
        await settle()
        #expect(access.closed.count == 2)
        #expect(access.opened.count == 3)
        service.stop()
        await settle()
        #expect(access.opened.count == 3)
        #expect(access.closed.count == 3)
        #expect(access.isOpen.isEmpty)
    }

    @Test func accessClosesWhenAnItemFails() async {
        let r = release()
        service.play(release: r, startingAt: id(r, 4))
        await settle()
        engine.end(.failed)
        await settle()
        #expect(access.opened == access.closed)
        #expect(access.isOpen.isEmpty)
        #expect(service.hasQueue == false)
    }

    @Test func aMissingFileIsSkippedAndTheQueueMovesOn() async {
        let r = release()
        access.missing = [id(r, 2)]
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        engine.end(.finished)
        await settle()
        #expect(service.missingTrackIDs == [id(r, 2)])
        #expect(service.currentTrack?.trackNumber == 3)
        #expect(engine.played.map(\.lastPathComponent) == ["t1.mp3", "t3.mp3"])
        #expect(access.opened == access.closed + Array(access.isOpen))
    }

    @Test func aCorruptFileIsRecordedAsFailedNotMissingAndTheQueueMovesOn() async {
        let r = release()
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        engine.end(.failed)
        await settle()
        #expect(service.failedTrackIDs == [id(r, 1)])
        #expect(service.missingTrackIDs.isEmpty)
        #expect(service.currentTrack?.trackNumber == 2)
    }

    @Test func anUnreachableFolderSkipsTheItemToo() async {
        let r = release()
        access.unreachable = [id(r, 1)]
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        #expect(service.currentTrack?.trackNumber == 2)
        #expect(service.missingTrackIDs == [id(r, 1)])
    }

    @Test func interruptionPausesAndResumesOnlyWhenTheSystemSays() async {
        let r = release()
        service.play(release: r, startingAt: id(r, 1))
        await settle()

        service.handle(InterruptionEvent.began)
        #expect(!service.isPlaying)
        service.handle(InterruptionEvent.ended(shouldResume: true))
        #expect(service.isPlaying)

        service.handle(InterruptionEvent.began)
        service.handle(InterruptionEvent.ended(shouldResume: false))
        #expect(!service.isPlaying)
        // A later "should resume" from an interruption that began while paused does nothing.
        service.handle(InterruptionEvent.began)
        service.handle(InterruptionEvent.ended(shouldResume: true))
        #expect(!service.isPlaying)
    }

    @Test func theSessionEventsReachTheService() async {
        let r = release()
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        session.onInterruption?(.began)
        #expect(!service.isPlaying)
        session.onInterruption?(.ended(shouldResume: true))
        #expect(service.isPlaying)
        session.onRouteChange?(.builtInSpeaker)
        #expect(!service.isPlaying)
    }

    @Test func routeChangeToTheSpeakerPausesAndOtherRoutesDoNot() async {
        let r = release()
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        service.handle(RouteChangeEvent.other)
        #expect(service.isPlaying)
        service.handle(RouteChangeEvent.builtInSpeaker)
        #expect(!service.isPlaying)
        #expect(engine.pauseCount == 1)
    }

    @Test func remoteCommandsMapToTheService() async {
        let r = release()
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        let send = remote.handler!

        send(.pause)
        #expect(!service.isPlaying)
        send(.play)
        #expect(service.isPlaying)
        send(.toggle)
        #expect(!service.isPlaying)
        send(.toggle)
        #expect(service.isPlaying)
        send(.seek(42))
        #expect(engine.seeks == [42])
        #expect(service.elapsed == 42)
        send(.next)
        await settle()
        #expect(service.currentTrack?.trackNumber == 2)
        send(.previous)
        await settle()
        #expect(service.currentTrack?.trackNumber == 1)
    }

    @Test func theLockScreenShowsTheTrackAndTheCover() async {
        let r = release()
        service.play(release: r, startingAt: id(r, 2))
        await settle()
        let info = nowPlaying.published.compactMap { $0 }.last
        #expect(info?.title == "Song 2")
        #expect(info?.artist == "Artist")
        #expect(info?.album == "Album")
        #expect(info?.artwork == Data([1, 2, 3]))
        #expect(info?.duration == 200)
        #expect(info?.isPlaying == true)
    }

    @Test func tappingTheRowOfThePlayingTrackPausesAndResumes() async {
        let r = release()
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        service.tapRow(release: r, trackID: id(r, 1))
        #expect(!service.isPlaying)
        service.tapRow(release: r, trackID: id(r, 1))
        #expect(service.isPlaying)
    }

    @Test func anAdoptedReleaseHasNoPlayAction() async {
        let r = release(adopted: true)
        #expect(service.playAction(release: r, trackID: id(r, 1)) == nil)
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        #expect(!service.hasQueue)
        #expect(engine.played.isEmpty)
        #expect(access.opened.isEmpty)
        #expect(session.activations == 0)

        let own = release()
        #expect(service.playAction(release: own, trackID: id(own, 1)) != nil)
    }

    @Test func aStopWhileTheFileIsOpeningNeverStartsAudio() async {
        let r = release()
        access.delayMilliseconds = 100
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        service.stop()
        try? await Task.sleep(for: .milliseconds(250))
        await settle()
        #expect(engine.played.isEmpty)
        #expect(!service.hasQueue)
        #expect(!service.isPlaying)
        #expect(access.isOpen.isEmpty)
        #expect(access.opened == access.closed)
    }

    @Test func aNewPlayWhileTheOldFileIsOpeningOnlyPlaysTheNewOne() async {
        let r = release()
        access.delayMilliseconds = 100
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        service.play(release: r, startingAt: id(r, 3))
        try? await Task.sleep(for: .milliseconds(300))
        await settle()
        #expect(engine.played.map(\.lastPathComponent) == ["t3.mp3"])
        #expect(service.currentTrack?.trackNumber == 3)
    }

    @Test func aSkipWhileTheFileIsOpeningPlaysOnlyTheTarget() async {
        let r = release()
        access.delayMilliseconds = 100
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        service.next()
        try? await Task.sleep(for: .milliseconds(400))
        await settle()
        #expect(engine.played.map(\.lastPathComponent) == ["t2.mp3"])
    }

    @Test func aFailedActivationClearsTheOldQueueAndSaysSo() async {
        let r = release()
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        #expect(service.hasQueue)
        session.failsActivation = true
        service.play(release: r, startingAt: id(r, 2))
        await settle()
        #expect(!service.hasQueue)
        #expect(!service.isPlaying)
        #expect(service.startError == Copy.Playback.couldntStart)
        #expect(access.isOpen.isEmpty)
        // A later play that works clears the line.
        session.failsActivation = false
        service.play(release: r, startingAt: id(r, 2))
        await settle()
        #expect(service.startError == nil)
        #expect(service.isPlaying)
    }

    /// Starts a play whose file takes 100 ms to open, runs `during` while it is opening, then waits it out.
    private func playOpening(during: () -> Void) async -> Release {
        let r = release()
        access.delayMilliseconds = 100
        service.play(release: r, startingAt: id(r, 2))
        await settle()
        during()
        try? await Task.sleep(for: .milliseconds(300))
        await settle()
        return r
    }

    @Test func aPauseWhileTheFileIsOpeningLoadsItPausedThenResumePlaysIt() async {
        let r = await playOpening { service.pause() }
        #expect(engine.played.isEmpty)
        #expect(!service.isPlaying)
        #expect(service.currentTrack?.id == id(r, 2))
        #expect(service.hasQueue)
        service.resume()
        await settle()
        #expect(engine.played.map(\.lastPathComponent) == ["t2.mp3"])
        #expect(service.isPlaying)
    }

    @Test func anInterruptionWhileTheFileIsOpeningLoadsItPaused() async {
        let r = await playOpening { service.handle(InterruptionEvent.began) }
        #expect(engine.played.isEmpty)
        #expect(!service.isPlaying)
        #expect(service.currentTrack?.id == id(r, 2))
        // The system says to resume when it ends: now it plays.
        service.handle(InterruptionEvent.ended(shouldResume: true))
        await settle()
        #expect(engine.played.map(\.lastPathComponent) == ["t2.mp3"])
        #expect(service.isPlaying)
    }

    @Test func headphonesOutWhileTheFileIsOpeningLoadsItPausedAndStaysPaused() async {
        let r = await playOpening { service.handle(RouteChangeEvent.builtInSpeaker) }
        #expect(engine.played.isEmpty)
        #expect(!service.isPlaying)
        #expect(service.currentTrack?.id == id(r, 2))
        service.handle(InterruptionEvent.ended(shouldResume: true))
        await settle()
        #expect(engine.played.isEmpty)
        #expect(!service.isPlaying)
    }

    @Test func aRemotePauseWhileOpeningAndThenStopClosesTheWaitingItem() async {
        _ = await playOpening { remote.handler?(.pause) }
        #expect(access.isOpen.count == 1)
        service.stop()
        await settle()
        #expect(access.isOpen.isEmpty)
        #expect(engine.played.isEmpty)
    }

    @Test func resumeThenPauseBackToBackOnAWaitingItemNeverPlays() async {
        let r = await playOpening { service.pause() }
        #expect(engine.played.isEmpty)
        service.resume()
        service.pause()
        await settle()
        #expect(engine.played.isEmpty)
        #expect(!service.isPlaying)
        #expect(service.currentTrack?.id == id(r, 2))
        service.resume()
        await settle()
        #expect(engine.played.map(\.lastPathComponent) == ["t2.mp3"])
        #expect(service.isPlaying)
    }

    @Test func resumeThenHeadphonesOutOnAWaitingItemNeverPlays() async {
        let r = await playOpening { service.pause() }
        service.resume()
        service.handle(RouteChangeEvent.builtInSpeaker)
        await settle()
        #expect(engine.played.isEmpty)
        #expect(!service.isPlaying)
        #expect(service.currentTrack?.id == id(r, 2))
        service.resume()
        await settle()
        #expect(engine.played.count == 1)
    }

    @Test func resumeThenInterruptionOnAWaitingItemNeverPlays() async {
        _ = await playOpening { service.pause() }
        service.resume()
        service.handle(InterruptionEvent.began)
        await settle()
        #expect(engine.played.isEmpty)
        #expect(!service.isPlaying)
    }

    @Test func anExplicitPauseCancelsTheResumeAfterAnInterruption() async {
        let r = release()
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        service.handle(InterruptionEvent.began)
        remote.handler?(.pause)
        service.handle(InterruptionEvent.ended(shouldResume: true))
        await settle()
        #expect(!service.isPlaying)
        #expect(engine.resumeCount == 0)
    }

    @Test func anExplicitPauseDuringTheOpenCancelsTheResumeAfterAnInterruption() async {
        _ = await playOpening {
            service.handle(InterruptionEvent.began)
            remote.handler?(.pause)
            service.handle(InterruptionEvent.ended(shouldResume: true))
        }
        #expect(engine.played.isEmpty)
        #expect(!service.isPlaying)
    }

    @Test func aQueueFromTwoReleasesResolvesEachItemFromItsOwnRelease() async {
        var first = release()
        first.title = "First Album"
        first.artist = "First Artist"
        var second = release()
        second.title = "Second Album"
        second.artist = "Second Artist"
        let counts = FakePlayCounts()
        var clock = Date(timeIntervalSince1970: 1_000_000)
        let counting = PlaybackService(
            engine: engine, access: access, session: session, nowPlaying: nowPlaying, remote: remote,
            playCounts: counts, now: { clock }
        )
        let items = [QueueItem(releaseId: first.id, trackId: id(first, 1)), QueueItem(releaseId: second.id, trackId: id(second, 2))]
        let collection = QueueContext(kind: .collection, id: UUID())
        counting.play(items: items, releases: [first, second], context: collection)
        await settle()
        #expect(nowPlaying.published.compactMap { $0 }.last?.title == "Song 1")
        #expect(nowPlaying.published.compactMap { $0 }.last?.album == "First Album")
        #expect(counting.currentRelease?.id == first.id)

        // 31 seconds of the first item (half-second ticks) counts against the first release.
        for tick in 0...62 {
            clock = Date(timeIntervalSince1970: 1_000_000 + Double(tick) / 2)
            engine.onProgress?(Double(tick) / 2, 200)
        }
        #expect(counts.increments == [items[0]])

        engine.end(.finished)
        await settle()
        let info = nowPlaying.published.compactMap { $0 }.last
        #expect(info?.title == "Song 2")
        #expect(info?.artist == "Second Artist")
        #expect(info?.album == "Second Album")
        #expect(counting.currentRelease?.id == second.id)
        #expect(access.opened.last == id(second, 2))

        for tick in 0...62 {
            clock = Date(timeIntervalSince1970: 2_000_000 + Double(tick) / 2)
            engine.onProgress?(Double(tick) / 2, 200)
        }
        #expect(counts.increments == items)

        // A collection's context asks for its page, not a release's; a release's opens its page.
        counting.openContext()
        #expect(counting.openReleaseRequest == nil)
        #expect(counting.openCollectionRequest == collection.id)
        counting.openCollectionRequest = nil
        let single = release()
        counting.play(release: single, startingAt: id(single, 1))
        await settle()
        counting.openContext()
        #expect(counting.openReleaseRequest == single.id)
    }

    @Test func openingAReleaseContextAsksForTheTrackThatIsPlaying() async {
        let r = release()
        service.play(release: r, startingAt: id(r, 2))
        await settle()
        service.openContext()
        #expect(service.openReleaseRequest == r.id)
        #expect(service.openReleaseTrackRequest == id(r, 2))
    }

    @Test func aPlayingItemFromAnotherReleaseGivesNoTrackRequest() async {
        let r = release()
        let other = release()
        let items = [QueueItem(releaseId: other.id, trackId: id(other, 1))]
        service.play(items: items, releases: [other], context: .release(r.id))
        await settle()
        service.openContext()
        #expect(service.openReleaseRequest == r.id)
        #expect(service.openReleaseTrackRequest == nil)
    }

    @Test func aCollectionContextLeavesTheTrackRequestNil() async {
        let a = release()
        let b = release()
        let items = [QueueItem(releaseId: a.id, trackId: id(a, 1)), QueueItem(releaseId: b.id, trackId: id(b, 2))]
        service.play(items: items, releases: [a, b], context: QueueContext(kind: .collection, id: UUID()))
        await settle()
        service.openContext()
        #expect(service.openReleaseRequest == nil)
        #expect(service.openReleaseTrackRequest == nil)
    }

    @Test func startingAtAnIndexPlaysThatItemAndKeepsTheOrderAroundIt() async {
        let r = release()
        let gone = QueueItem(releaseId: UUID(), trackId: UUID())
        let items = [QueueItem(releaseId: r.id, trackId: id(r, 1)), gone, QueueItem(releaseId: r.id, trackId: id(r, 2)), QueueItem(releaseId: r.id, trackId: id(r, 1))]
        let context = QueueContext(kind: .collection, id: UUID())

        // Index 2 of the full list is the second playable item; the unplayable one before it is filtered out.
        service.play(items: items, releases: [r], context: context, startingAt: 2)
        await settle()
        #expect(service.queue?.items == [items[0], items[2], items[3]])
        #expect(service.queue?.index == 1)
        #expect(service.currentItem == items[2])
        #expect(access.opened.last == id(r, 2))

        // The same track twice: the later position is the one playing.
        service.play(items: items, releases: [r], context: context, startingAt: 3)
        await settle()
        #expect(service.queue?.index == 2)

        // An index on an unplayable item starts the next playable one; one past the end starts the first.
        service.play(items: items, releases: [r], context: context, startingAt: 1)
        await settle()
        #expect(service.queue?.index == 1)
        service.play(items: items, releases: [r], context: context, startingAt: 99)
        await settle()
        #expect(service.queue?.index == 0)

        // Callers that don't pass an index start at the first item.
        service.play(items: items, releases: [r], context: context)
        await settle()
        #expect(service.queue?.index == 0)
    }

    @Test func aTickFromACancelledRunNeverCounts() async {
        let r = release()
        let counts = FakePlayCounts()
        var clock = Date(timeIntervalSince1970: 1_000_000)
        let counting = PlaybackService(
            engine: engine, access: access, session: session, nowPlaying: nowPlaying, remote: remote,
            playCounts: counts, now: { clock }
        )
        counting.play(release: r, startingAt: id(r, 1))
        await settle()
        for tick in 0...50 {
            clock = Date(timeIntervalSince1970: 1_000_000 + Double(tick) / 2)
            engine.onProgress?(Double(tick) / 2, 200)
        }
        counting.stop()
        // The player reports late ticks after the stop; none of them counts.
        for tick in 51...130 {
            clock = Date(timeIntervalSince1970: 1_000_000 + Double(tick) / 2)
            engine.onProgress?(Double(tick) / 2, 200)
        }
        #expect(counts.increments.isEmpty)
    }

    @Test func aPlayLoadedPausedCountsFromWhenItActuallyPlays() async {
        let r = release()
        let counts = FakePlayCounts()
        var clock = Date(timeIntervalSince1970: 1_000_000)
        let counting = PlaybackService(
            engine: engine, access: access, session: session, nowPlaying: nowPlaying, remote: remote,
            playCounts: counts, now: { clock }
        )
        func tick(_ t: Double) {
            clock = Date(timeIntervalSince1970: 1_000_000 + t)
            engine.onProgress?(t, 200)
        }
        // The file open is held at a gate the test opens itself, not by timing.
        access.holdsOpens = true
        counting.play(release: r, startingAt: id(r, 1))
        await waitUntil { access.heldCount == 1 }
        #expect(access.heldCount == 1)
        // Paused while the file opens: it loads paused at 0 and waits.
        counting.pause()
        access.releaseHeldOpens()
        await settle()
        #expect(engine.played.isEmpty)
        // Ticks while it waits, or while paused, never count.
        for t in stride(from: 0.0, through: 60, by: 0.5) { tick(t) }
        #expect(counts.increments.isEmpty)

        counting.resume()
        await waitUntil { engine.played.count == 1 }
        #expect(engine.played.count == 1)
        // Then 30 s of real playback, and 30 more: counted once.
        for t in stride(from: 100.0, through: 160, by: 0.5) { tick(t - 100) }
        #expect(counts.increments == [QueueItem(releaseId: r.id, trackId: id(r, 1))])
    }

    // MARK: Play next and add to queue (#364)

    private func items(_ r: Release, _ numbers: [Int]) -> [QueueItem] {
        numbers.map { QueueItem(releaseId: r.id, trackId: id(r, $0)) }
    }

    @Test func playNextInsertsRightAfterThePlayingItemAndPlaysItWhenTheCurrentOneEnds() async {
        let r = release()
        let other = release()
        service.play(release: r, startingAt: id(r, 1))
        await waitUntil { engine.played.count == 1 }
        let outcome = service.playNext(items(other, [4]), releases: [other])
        let expectedOutcome: QueueAddOutcome = QueueAddOutcome(added: 1, leftOut: 0, started: false)
        #expect(outcome == expectedOutcome)
        let expectedItems: [QueueItem] = items(r, [1]) + items(other, [4]) + items(r, [2, 3, 4])
        #expect(service.queue?.items == expectedItems)
        // The current track is neither restarted nor interrupted.
        #expect(engine.played.count == 1)
        #expect(service.currentTrack?.trackNumber == 1)
        engine.end(.finished)
        await waitUntil { engine.played.count == 2 }
        let expectedItem: QueueItem = items(other, [4])[0]
        #expect(service.currentItem == expectedItem)
        #expect(service.currentRelease?.id == other.id)
        engine.end(.finished)
        await waitUntil { engine.played.count == 3 }
        let expectedItem2: QueueItem = items(r, [2])[0]
        #expect(service.currentItem == expectedItem2)
    }

    @Test func playNextKeepsTheOrderWithinOneBatch() async {
        let r = release()
        service.play(release: r, startingAt: id(r, 4))
        await settle()
        _ = service.playNext(items(r, [1, 2]), releases: [r])
        let expectedItems: [QueueItem] = items(r, [4, 1, 2])
        #expect(service.queue?.items == expectedItems)
        #expect(service.queue?.index == 0)
    }

    @Test func theMostRecentPlayNextPlaysNext() async {
        let r = release()
        let a = release()
        let b = release()
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        _ = service.playNext(items(a, [1]), releases: [a])
        _ = service.playNext(items(b, [1]), releases: [b])
        let expectedItems: [QueueItem] = items(r, [1]) + items(b, [1]) + items(a, [1]) + items(r, [2, 3, 4])
        #expect(service.queue?.items == expectedItems)
    }

    @Test func addToQueueTwiceIsFirstInFirstOut() async {
        let r = release()
        let a = release()
        let b = release()
        service.play(release: r, startingAt: id(r, 3))
        await settle()
        _ = service.addToQueue(items(a, [1]), releases: [a])
        _ = service.addToQueue(items(b, [1]), releases: [b])
        let expectedItems: [QueueItem] = items(r, [3, 4]) + items(a, [1]) + items(b, [1])
        #expect(service.queue?.items == expectedItems)
    }

    @Test func addToQueueAppendsAndPlaysAfterThePreviousLastItem() async {
        let r = release()
        let other = release()
        service.play(release: r, startingAt: id(r, 3))
        await settle()
        let outcome = service.addToQueue(items(other, [1, 2]), releases: [other])
        let expectedOutcome: QueueAddOutcome = QueueAddOutcome(added: 2, leftOut: 0, started: false)
        #expect(outcome == expectedOutcome)
        let expectedItems: [QueueItem] = items(r, [3, 4]) + items(other, [1, 2])
        #expect(service.queue?.items == expectedItems)
        engine.end(.finished)
        await settle()
        engine.end(.finished)
        await settle()
        let expectedItem: QueueItem = items(other, [1])[0]
        #expect(service.currentItem == expectedItem)
        #expect(service.currentRelease?.id == other.id)
    }

    @Test func addingWhileTheLastItemPlaysContinuesIntoTheNewItems() async {
        let r = release()
        service.play(release: r, startingAt: id(r, 4))
        await settle()
        _ = service.addToQueue(items(r, [1]), releases: [r])
        engine.end(.finished)
        await settle()
        #expect(service.hasQueue)
        let expectedItem: QueueItem = items(r, [1])[0]
        #expect(service.currentItem == expectedItem)
    }

    @Test func aReleaseContextStaysForAddsFromThatReleaseAndBecomesMixedForAnother() async {
        let r = release()
        let other = release()
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        _ = service.addToQueue(items(r, [2]), releases: [r])
        let expectedContext: QueueContext = .release(r.id)
        #expect(service.queue?.context == expectedContext)
        _ = service.playNext(items(r, [3]), releases: [r])
        let expectedContext2: QueueContext = .release(r.id)
        #expect(service.queue?.context == expectedContext2)
        _ = service.addToQueue(items(r, [2]) + items(other, [1]), releases: [r, other])
        let expectedContext3: QueueContext = QueueContext(kind: .mixed, id: r.id)
        #expect(service.queue?.context == expectedContext3)
        // Mixed stays mixed.
        _ = service.addToQueue(items(r, [1]), releases: [r])
        #expect(service.queue?.context.kind == .mixed)
    }

    @Test func aCollectionContextBecomesMixedOnAnyAdd() async {
        let r = release()
        service.play(items: items(r, [1, 2]), releases: [r], context: QueueContext(kind: .collection, id: UUID()))
        await settle()
        _ = service.addToQueue(items(r, [3]), releases: [r])
        let expectedContext: QueueContext = QueueContext(kind: .mixed, id: r.id)
        #expect(service.queue?.context == expectedContext)
    }

    @Test func aMixedContextIdFollowsTheCurrentItemAtTheTimeOfTheAdd() async {
        let r = release()
        let other = release()
        service.play(items: items(other, [1]) + items(r, [1]), releases: [r, other], context: QueueContext(kind: .collection, id: UUID()))
        await settle()
        engine.end(.finished)
        await settle()
        _ = service.addToQueue(items(r, [2]), releases: [r])
        let expectedContext: QueueContext = QueueContext(kind: .mixed, id: r.id)
        #expect(service.queue?.context == expectedContext)
    }

    @Test func adoptedItemsAreLeftOutAndCounted() async {
        let r = release()
        let adopted = release(adopted: true)
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        let outcome = service.addToQueue(items(adopted, [1, 2]) + items(r, [2]), releases: [adopted, r])
        let expectedOutcome: QueueAddOutcome = QueueAddOutcome(added: 1, leftOut: 2, started: false)
        #expect(outcome == expectedOutcome)
        let expectedItems: [QueueItem] = items(r, [1, 2, 3, 4, 2])
        #expect(service.queue?.items == expectedItems)
        // Nothing but adopted: nothing changes, and a release context is not turned mixed.
        let none = service.playNext(items(adopted, [1]), releases: [adopted])
        let expectedOutcome2: QueueAddOutcome = QueueAddOutcome(added: 0, leftOut: 1, started: false)
        #expect(none == expectedOutcome2)
        let expectedContext: QueueContext = .release(r.id)
        #expect(service.queue?.context == expectedContext)
    }

    @Test func anItemWhoseReleaseIsMissingIsLeftOut() async {
        let r = release()
        let stranger = release()
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        let outcome = service.addToQueue(items(stranger, [1]), releases: [r])
        let expectedOutcome: QueueAddOutcome = QueueAddOutcome(added: 0, leftOut: 1, started: false)
        #expect(outcome == expectedOutcome)
    }

    @Test func withNoQueueAddingStartsPlayingTheItems() async {
        let r = release()
        let outcome = service.addToQueue(items(r, [2, 3]), releases: [r])
        await settle()
        let expectedOutcome: QueueAddOutcome = QueueAddOutcome(added: 2, leftOut: 0, started: true)
        #expect(outcome == expectedOutcome)
        let expectedContext: QueueContext = .release(r.id)
        #expect(service.queue?.context == expectedContext)
        #expect(service.currentTrack?.trackNumber == 2)
        #expect(service.isPlaying)
    }

    @Test func withNoQueueItemsFromTwoReleasesStartAMixedQueue() async {
        let r = release()
        let other = release()
        let outcome = service.playNext(items(r, [1]) + items(other, [1]), releases: [r, other])
        await settle()
        #expect(outcome.started)
        let expectedContext: QueueContext = QueueContext(kind: .mixed, id: r.id)
        #expect(service.queue?.context == expectedContext)
    }

    @Test func withNoQueueAndNothingPlayableNothingChanges() async {
        let adopted = release(adopted: true)
        let outcome = service.playNext(items(adopted, [1]), releases: [adopted])
        let expectedOutcome: QueueAddOutcome = QueueAddOutcome(added: 0, leftOut: 1, started: false)
        #expect(outcome == expectedOutcome)
        #expect(!service.hasQueue)
        #expect(session.activations == 0)
    }

    @Test func openingAMixedContextOpensTheCurrentItemsRelease() async {
        let r = release()
        let other = release()
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        _ = service.addToQueue(items(other, [1]), releases: [other])
        service.openContext()
        #expect(service.openReleaseRequest == r.id)
        #expect(service.openCollectionRequest == nil)
        service.next()
        await settle()
        service.openContext()
        #expect(service.openReleaseRequest == r.id)
    }

    @Test func openingAMixedContextFollowsTheItemThatPlaysNow() async {
        let r = release()
        let other = release()
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        _ = service.playNext(items(other, [2]), releases: [other])
        service.next()
        await settle()
        service.openContext()
        #expect(service.openReleaseRequest == other.id)
    }

    @Test func nextAndPreviousStillWalkAroundInsertedItems() async {
        let r = release()
        let other = release()
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        _ = service.playNext(items(other, [1]), releases: [other])
        service.next()
        await settle()
        let expectedItem: QueueItem = items(other, [1])[0]
        #expect(service.currentItem == expectedItem)
        service.next()
        await settle()
        let expectedItem2: QueueItem = items(r, [2])[0]
        #expect(service.currentItem == expectedItem2)
        service.previous()
        await settle()
        let expectedItem3: QueueItem = items(other, [1])[0]
        #expect(service.currentItem == expectedItem3)
        service.previous()
        await settle()
        let expectedItem4: QueueItem = items(r, [1])[0]
        #expect(service.currentItem == expectedItem4)
    }

    @Test func insertingWhileTheCurrentFileIsStillOpeningDoesNotRestartIt() async {
        let r = release()
        let other = release()
        access.delayMilliseconds = 80
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        _ = service.playNext(items(other, [3]), releases: [other])
        try? await Task.sleep(for: .milliseconds(250))
        await settle()
        let expectedNames: [String] = ["t1.mp3"]
        #expect(engine.played.map(\.lastPathComponent) == expectedNames)
        #expect(service.currentTrack?.trackNumber == 1)
        access.delayMilliseconds = 0
        engine.end(.finished)
        await settle()
        let expectedItem: QueueItem = items(other, [3])[0]
        #expect(service.currentItem == expectedItem)
    }

    @Test func insertingDuringASkipKeepsTheSkipTargetAndPlaysTheInsertedItemAfterIt() async {
        let r = release()
        let other = release()
        service.play(release: r, startingAt: id(r, 1))
        await settle()
        service.next()
        // No await yet: the skip target (track 2) has not become the current item.
        _ = service.playNext(items(other, [1]), releases: [other])
        await settle()
        let expectedItem: QueueItem = items(r, [2])[0]
        #expect(service.currentItem == expectedItem)
        engine.end(.finished)
        await settle()
        let expectedItem2: QueueItem = items(other, [1])[0]
        #expect(service.currentItem == expectedItem2)
    }
}
