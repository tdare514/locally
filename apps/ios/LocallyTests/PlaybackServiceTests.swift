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

        // A collection's context is a no-op for now; a release's opens its page.
        counting.openContext()
        #expect(counting.openReleaseRequest == nil)
        let single = release()
        counting.play(release: single, startingAt: id(single, 1))
        await settle()
        counting.openContext()
        #expect(counting.openReleaseRequest == single.id)
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
}
