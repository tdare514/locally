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
    private func settle() async {
        for _ in 0..<30 { await Task.yield() }
        try? await Task.sleep(for: .milliseconds(20))
    }

    @Test func queueIsDiscThenTrackFromTheTappedRow() async {
        let r = release()
        service.play(release: r, startingAt: id(r, 2))
        await settle()
        #expect(service.queue?.tracks.map(\.trackNumber) == [2, 3, 4])
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
}
