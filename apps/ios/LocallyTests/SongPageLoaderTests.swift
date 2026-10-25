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

    private static func total(_ value: Int?) -> (Release, UUID) async -> Int? { { _, _ in value } }

    @Test func playsAndLastPlayedComeFromTheRangedSummaryAndTheTotalFromTheReleaseRead() async {
        let stats = FakePlayStats(result: .ok(PlaysSummary(tracks: [Self.count(3, day: "2025-10-23")], allTime: [Self.count(999, day: nil)])))
        let loader = SongPageLoader(stats: stats, allTimePlays: Self.total(9))
        await loader.load(release: Self.release(), trackID: Self.trackID)
        let day: String = "2025-10-23"
        #expect(loader.plays?.total == 9)
        #expect(loader.plays?.lastPlayedDay == day)
        #expect(loader.plays?.byPeriod.count == 5)
    }

    @Test func onlyFourRangedReadsAreMadeEachCachedAndNeverForced() async {
        let stats = FakePlayStats()
        let loader = SongPageLoader(stats: stats, allTimePlays: Self.total(1))
        // A Wednesday mid-month on a Monday-first calendar, so today, the week, the month and the year are four
        // different ranges (on the first day of a week, today and the week are the same range).
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        calendar.firstWeekday = 2
        let wednesday = calendar.date(from: DateComponents(year: 2026, month: 10, day: 21, hour: 12))!
        await loader.load(release: Self.release(), trackID: Self.trackID, now: wednesday, calendar: calendar)
        #expect(stats.calls.count == 4)
        #expect(Set(stats.calls.map { "\($0.from)/\($0.to)" }).count == 4)
        #expect(stats.calls.allSatisfy { !$0.force })
    }

    @Test func signedOutHidesThePlays() async {
        let loader = SongPageLoader(stats: FakePlayStats(result: .signedOut), allTimePlays: Self.total(9))
        await loader.load(release: Self.release(), trackID: Self.trackID)
        #expect(loader.plays == nil)
        let page = SongPageModel(release: Self.release(), trackID: Self.trackID, plays: loader.plays)
        #expect(page?.playsTotal == nil)
    }

    @Test func aFailedReleaseReadHidesThePlays() async {
        let loader = SongPageLoader(stats: FakePlayStats(), allTimePlays: Self.total(nil))
        await loader.load(release: Self.release(), trackID: Self.trackID)
        #expect(loader.plays == nil)
    }

    @Test func aFailedOrBusyRangedReadLeavesThatPeriodOutButKeepsTheTotal() async {
        for result in [PlayStatsRead.failed, .busy] {
            let loader = SongPageLoader(stats: FakePlayStats(result: result), allTimePlays: Self.total(4))
            await loader.load(release: Self.release(), trackID: Self.trackID)
            #expect(loader.plays?.total == 4)
            #expect(loader.plays?.byPeriod.map(\.kind) == [.all])
        }
    }

    @Test func theTotalIsThisTracksFromTheReleasePlaysRead() async {
        let api = FakeSyncApi()
        let other = UUID().uuidString
        api.releasePlaysResult = .success(SyncReleasePlays(tracks: [
            SyncTrackPlays(trackId: Self.trackID.uuidString.lowercased(), total: 7, devices: []),
            SyncTrackPlays(trackId: other, total: 50, devices: []),
        ]))
        let mine = await SongPageLoader.allTimeTotal(api: api, isSignedIn: true, release: Self.release(), trackID: Self.trackID)
        #expect(mine == 7)
        #expect(api.releasePlaysCalls == [Self.releaseID.uuidString])
        let none = await SongPageLoader.allTimeTotal(api: api, isSignedIn: true, release: Self.release(), trackID: UUID())
        #expect(none == 0)
        let signedOut = await SongPageLoader.allTimeTotal(api: api, isSignedIn: false, release: Self.release(), trackID: Self.trackID)
        #expect(signedOut == nil)
        api.releasePlaysResult = .failure(SyncApiError.network("offline"))
        let offline = await SongPageLoader.allTimeTotal(api: api, isSignedIn: true, release: Self.release(), trackID: Self.trackID)
        #expect(offline == nil)
    }

    @Test func aFileOutsideTheConnectedFolderHasNoUrlToRead() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("song-page-\(UUID().uuidString)", isDirectory: true)
        let folder = root.appendingPathComponent("Spotify", isDirectory: true)
        try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root) }
        let outside = root.appendingPathComponent("secret.m4a")
        try Data([1]).write(to: outside)
        let inside = folder.appendingPathComponent("a.m4a")
        try Data([1]).write(to: inside)

        func track(_ path: String) -> Track { Track(id: Self.trackID, title: "t", trackNumber: 1, filePath: path, originalName: "a.m4a") }
        // An absolute path that exists outside the folder passes the resolver unchanged, so the check must catch it.
        #expect(ReleaseCoordinator.containedFileURL(for: track(outside.path), in: folder) == nil)
        let dotted = folder.path + "/../secret.m4a"
        #expect(ReleaseCoordinator.containedFileURL(for: track(dotted), in: folder) == nil)
        let found = ReleaseCoordinator.containedFileURL(for: track(inside.path), in: folder)
        #expect(found?.lastPathComponent == "a.m4a")
        // A gone file is looked up by name inside the folder.
        let moved = ReleaseCoordinator.containedFileURL(for: track("/old/place/a.m4a"), in: folder)
        #expect(moved?.deletingLastPathComponent().standardizedFileURL.path == folder.standardizedFileURL.path)
    }

    @Test func theFileIsReadForAPhoneSongAndNeverForAnAdoptedOne() async {
        var reads = 0
        let loader = SongPageLoader(stats: nil, readFile: { _, _ in
            reads += 1
            return SongFileFacts(size: 8_400_000, duration: 65)
        })
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
