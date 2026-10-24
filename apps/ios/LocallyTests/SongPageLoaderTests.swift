import Foundation
import Testing
@testable import Locally

/// Reading the song page's plays and file (#365): the plays go through the stats service, cached and never forced;
/// signed out or offline hides them; an adopted song's file is never read.
@MainActor
struct SongPageLoaderTests {
    private static let releaseID = UUID(uuidString: "00000000-0000-0000-0000-0000000000a1")!
    private static let trackID = UUID(uuidString: "00000000-0000-0000-0000-0000000000b1")!

    private static func release(adopted: Bool = false) -> Release {
        Release(id: releaseID, kind: .single, title: "Paper Moon", artist: "Mira", folderPath: "/f",
                tracks: [Track(id: trackID, title: "Paper Moon", trackNumber: 1, filePath: "/f/a.m4a", originalName: "a.m4a")],
                source: adopted ? .adopted : nil)
    }

    private static func count(_ plays: Int, day: String?) -> PlayCount {
        PlayCount(trackId: trackID.uuidString.lowercased(), releaseId: releaseID.uuidString.lowercased(), plays: plays, lastPlayedDay: day)
    }

    @Test func playsAndLastPlayedComeFromTheRangedSummary() async {
        let stats = FakePlayStats(result: .ok(PlaysSummary(tracks: [Self.count(3, day: "2025-10-23")], allTime: [Self.count(9, day: nil)])))
        let loader = SongPageLoader(stats: stats)
        await loader.load(release: Self.release(), trackID: Self.trackID)
        let day: String = "2025-10-23"
        #expect(loader.plays?.total == 9)
        #expect(loader.plays?.lastPlayedDay == day)
        #expect(loader.plays?.byPeriod.count == 5)
    }

    @Test func eachReadUsesTheCacheAndIsNeverForced() async {
        let stats = FakePlayStats()
        let loader = SongPageLoader(stats: stats)
        await loader.load(release: Self.release(), trackID: Self.trackID)
        #expect(stats.calls.count == 5)
        #expect(stats.calls.allSatisfy { !$0.force })
    }

    @Test func signedOutHidesThePlays() async {
        let loader = SongPageLoader(stats: FakePlayStats(result: .signedOut))
        await loader.load(release: Self.release(), trackID: Self.trackID)
        #expect(loader.plays == nil)
        let page = SongPageModel(release: Self.release(), trackID: Self.trackID, plays: loader.plays)
        #expect(page?.playsTotal == nil)
    }

    @Test func offlineOrBusyHidesThePlaysToo() async {
        for result in [PlayStatsRead.failed, .busy] {
            let loader = SongPageLoader(stats: FakePlayStats(result: result))
            await loader.load(release: Self.release(), trackID: Self.trackID)
            #expect(loader.plays == nil)
        }
    }

    @Test func theFileIsReadForAPhoneSongAndNeverForAnAdoptedOne() async {
        var reads = 0
        let loader = SongPageLoader(stats: nil) { _, _ in
            reads += 1
            return SongFileFacts(size: 8_400_000, duration: 65)
        }
        await loader.load(release: Self.release(adopted: true), trackID: Self.trackID)
        #expect(reads == 0)
        #expect(loader.fileSize == nil)
        await loader.load(release: Self.release(), trackID: Self.trackID)
        #expect(reads == 1)
        #expect(loader.fileSize == 8_400_000)
        #expect(loader.readLength == 65)
    }
}

/// The sleeve's tap (#365) and its fit (#369, shared): pure helpers.
struct SongSleeveTests {
    @Test func aSongThisPhoneDoesNotHoldIsInert() {
        #expect(SongSleeveAction.resolve(canPlay: false, isCurrent: true, isPlaying: true) == .inert)
        let label: String = "Tide, only on your Mac"
        #expect(SongSleeveAction.inert.label(title: "Tide") == label)
        #expect(SongSleeveAction.inert.hint.isEmpty)
    }

    @Test func aTapStartsPausesAndResumes() {
        #expect(SongSleeveAction.resolve(canPlay: true, isCurrent: false, isPlaying: true) == .start)
        #expect(SongSleeveAction.resolve(canPlay: true, isCurrent: true, isPlaying: true) == .pause)
        #expect(SongSleeveAction.resolve(canPlay: true, isCurrent: true, isPlaying: false) == .resume)
    }

    @Test func labelsNameTheSong() {
        let play: String = "Play Paper Moon"
        let pause: String = "Pause Paper Moon"
        let resume: String = "Resume Paper Moon"
        #expect(SongSleeveAction.start.label(title: "Paper Moon") == play)
        #expect(SongSleeveAction.pause.label(title: "Paper Moon") == pause)
        #expect(SongSleeveAction.resume.label(title: "Paper Moon") == resume)
    }

    @Test func theSharedSleeveFitMatchesTheCollectionsOne() {
        #expect(SpinningSleeveFit.fittedSide(200, availableWidth: .infinity) == 200)
        #expect(SpinningSleeveFit.fittedSide(200, availableWidth: 280) == CollectionSleeveView.fittedSide(200, availableWidth: 280))
        #expect(SpinningSleeveFit.fittedSide(200, availableWidth: 0) == 200)
    }
}
