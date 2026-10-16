import Foundation
import Testing
@testable import Locally

/// Ports the `aggregatePlays` cases of `apps/web/tests/unit/play-stats.test.ts`. The web's string ids
/// ("t1", "r-sea") become UUIDs here; `u(n)` makes them.
struct PlayStatsTests {
    private func u(_ n: Int) -> UUID { UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))! }
    private func s(_ n: Int) -> String { u(n).uuidString.lowercased() }

    private func track(_ n: Int, _ title: String, _ number: Int = 1) -> Track {
        Track(id: u(n), title: title, trackNumber: number, filePath: "t\(n).mp3", originalName: "t\(n).mp3", durationSec: 180)
    }

    private func release(_ n: Int, _ artist: String, _ title: String, _ tracks: [Track], genre: String? = nil, cover: String? = "cover.jpg") -> Release {
        Release(id: u(n), kind: tracks.count > 1 ? .album : .single, title: title, artist: artist, genre: genre,
                coverPath: cover, folderPath: "/lib/\(n)", tracks: tracks)
    }

    private func plays(_ releaseN: Int, _ counts: [(Int, Int)], day: String? = nil) -> [PlayCount] {
        counts.map { PlayCount(trackId: s($0.0), releaseId: s(releaseN), plays: $0.1, lastPlayedDay: day) }
    }

    // Releases: sea = 1 (tracks 11, 12), lantern = 2 (track 13), bus = 3 (track 14, no cover).
    private var sea: Release { release(1, "Okoro", "Saltwater Hymns", [track(11, "Tide", 1), track(12, "Hymn", 2)]) }
    private var lantern: Release { release(2, "Quiet Orchard", "Paper Lanterns", [track(13, "Lanterns")]) }
    private var bus: Release { release(3, "Okoro", "Night Bus", [track(14, "Night Bus")], cover: nil) }
    private var counts: [PlayCount] { plays(1, [(11, 5), (12, 2)]) + plays(2, [(13, 6)]) + plays(3, [(14, 4)]) }

    @Test func ranksTracksAlbumsAndArtistsMostPlayedFirst() {
        let stats = PlayStats.aggregate(releases: [sea, lantern, bus], counts: counts)
        #expect(stats.total == 17)
        #expect(stats.tracks.map(\.title) == ["Lanterns", "Tide", "Night Bus"])
        #expect(stats.tracks.map(\.rank) == [1, 2, 3])
        #expect(stats.albums.map(\.title) == ["Saltwater Hymns", "Paper Lanterns", "Night Bus"])
        #expect(stats.albums.map(\.plays) == [7, 6, 4])
        #expect(stats.artists.map(\.title) == ["Okoro", "Quiet Orchard"])
        #expect(stats.artists.map(\.plays) == [11, 6])
    }

    @Test func medalsGoToTheFirstThreeRanks() {
        #expect(PlayStats.medalFor(rank: 1) == .gold)
        #expect(PlayStats.medalFor(rank: 2) == .silver)
        #expect(PlayStats.medalFor(rank: 3) == .bronze)
        #expect(PlayStats.medalFor(rank: 4) == nil)
        let stats = PlayStats.aggregate(releases: [sea, lantern, bus], counts: counts, limit: .max)
        #expect(stats.tracks.map(\.medal) == [.gold, .silver, .bronze, nil])
    }

    @Test func releaseCountLabel() {
        #expect(PlayStats.releaseCountLabel(1) == "1 release")
        #expect(PlayStats.releaseCountLabel(6) == "6 releases")
        #expect(PlayStats.releaseCountLabel(0) == "0 releases")
    }

    @Test func subtitlesTracksAndAlbumsWithTheArtist() {
        let stats = PlayStats.aggregate(releases: [sea, lantern, bus], counts: counts)
        #expect(stats.tracks[0].subtitle == "Quiet Orchard")
        #expect(stats.albums[0].subtitle == "Okoro")
    }

    @Test func subtitlesAnArtistWithTheGenreOfTheirMostPlayedReleaseElseTheReleaseCount() {
        let withGenre = release(1, "Okoro", "Saltwater Hymns", sea.tracks, genre: "Soul")
        #expect(PlayStats.aggregate(releases: [withGenre, lantern, bus], counts: counts).artists[0].subtitle == "Soul")
        let plain = PlayStats.aggregate(releases: [sea, lantern, bus], counts: counts)
        #expect(plain.artists[0].subtitle == "2 releases")
        #expect(plain.artists[1].subtitle == "1 release")
    }

    @Test func limitsEachListToThreeByDefault() {
        let many = (1...5).map { release($0, "Artist \($0)", "Album \($0)", [track(10 + $0, "Song \($0)")]) }
        let all = (1...5).flatMap { plays($0, [(10 + $0, 11 - $0)]) }
        let stats = PlayStats.aggregate(releases: many, counts: all)
        #expect(stats.tracks.count == 3)
        #expect(stats.albums.count == 3)
        #expect(stats.artists.count == 3)
        #expect(stats.tracks.map(\.plays) == [10, 9, 8])
        #expect(PlayStats.aggregate(releases: many, counts: all, limit: 5).tracks.count == 5)
    }

    @Test func ordersEqualPlaysAToZByTitleThenByIdAndNeverRepeatsARank() {
        let rel = release(1, "Artist", "Album", [track(21, "Zebra", 1), track(22, "apple", 2), track(23, "Mango", 3)])
        let stats = PlayStats.aggregate(releases: [rel], counts: plays(1, [(21, 3), (22, 3), (23, 3)]))
        #expect(stats.tracks.map(\.title) == ["apple", "Mango", "Zebra"])
        #expect(stats.tracks.map(\.rank) == [1, 2, 3])

        let twin1 = release(2, "Same", "Twin", [track(32, "Song b")])
        let twin2 = release(1, "Same", "Twin", [track(31, "Song a")])
        let albums = PlayStats.aggregate(releases: [twin1, twin2], counts: plays(1, [(31, 2)]) + plays(2, [(32, 2)])).albums
        #expect(albums.map(\.id) == [s(1), s(2)])
    }

    @Test func isEmptyWithNoPlaysAtAll() {
        for none in [[], plays(1, [(11, 0), (12, 0)])] {
            let stats = PlayStats.aggregate(releases: [sea, lantern, bus], counts: none)
            #expect(stats == PlayStatsResult(total: 0, tracks: [], albums: [], artists: []))
        }
        #expect(PlayStats.aggregate(releases: [], counts: counts).total == 0)
    }

    @Test func aSummaryPeriodRowsAndAllTimeRowsComeFromTheSameHelper() {
        let thisWeek = plays(1, [(12, 3)], day: "2026-10-14") + plays(3, [(14, 1)], day: "2026-10-15")
        let week = PlayStats.aggregate(releases: [sea, lantern, bus], counts: thisWeek)
        #expect(week.total == 4)
        #expect(week.tracks.map(\.title) == ["Hymn", "Night Bus"])
        #expect(week.tracks.map(\.plays) == [3, 1])
        #expect(PlayStats.aggregate(releases: [sea, lantern, bus], counts: counts).tracks[0].title == "Lanterns")
        let totalsOnly = PlayStats.aggregate(releases: [sea, lantern, bus], counts: counts, limit: 0)
        #expect(totalsOnly.total == 17)
        #expect(totalsOnly.tracks.isEmpty && totalsOnly.albums.isEmpty && totalsOnly.artists.isEmpty)
    }

    @Test func leavesOutReleasesAndTracksWithNoPlays() {
        let stats = PlayStats.aggregate(releases: [sea, lantern, bus], counts: plays(1, [(11, 3)]))
        #expect(stats.tracks.map(\.title) == ["Tide"])
        #expect(stats.albums.map(\.title) == ["Saltwater Hymns"])
        #expect(stats.artists.map(\.title) == ["Okoro"])
    }

    @Test func ignoresCountsForTracksNoLongerInTheReleaseOrLibrary() {
        let stats = PlayStats.aggregate(releases: [sea], counts: plays(1, [(11, 2), (99, 50)]) + plays(98, [(97, 99)]))
        #expect(stats.total == 2)
        #expect(stats.tracks.map(\.title) == ["Tide"])
    }

    @Test func onlyCountsATrackUnderTheReleaseItWasCountedFor() {
        let stats = PlayStats.aggregate(releases: [sea, lantern], counts: plays(2, [(11, 9)]))
        #expect(stats.total == 0)
    }

    @Test func ignoresCountsThatAreNotPositive() {
        let stats = PlayStats.aggregate(releases: [sea], counts: plays(1, [(11, -3), (12, 0)]))
        #expect(stats.total == 0)
    }

    @Test func matchesIdsCaseInsensitively() {
        let upper = counts.map { PlayCount(trackId: $0.trackId.uppercased(), releaseId: $0.releaseId.uppercased(), plays: $0.plays, lastPlayedDay: nil) }
        #expect(PlayStats.aggregate(releases: [sea, lantern, bus], counts: upper).total == 17)
    }

    @Test func treatsOneArtistWrittenTwoWaysAsOne() {
        let a = release(1, "Mira Valdane", "One", [track(11, "One")])
        let b = release(2, "  mira valdane ", "Two", [track(12, "Two")])
        let stats = PlayStats.aggregate(releases: [a, b], counts: plays(1, [(11, 2)]) + plays(2, [(12, 3)]))
        #expect(stats.artists.count == 1)
        #expect(stats.artists[0].title == "Mira Valdane")
        #expect(stats.artists[0].plays == 5)
        #expect(stats.artists[0].subtitle == "2 releases")
    }

    @Test func leavesABlankArtistOutOfTheArtistListButStillCountsThePlays() {
        let nameless = release(1, "  ", "Untitled", [track(11, "Song")])
        let stats = PlayStats.aggregate(releases: [nameless], counts: plays(1, [(11, 4)]))
        #expect(stats.artists.isEmpty)
        #expect(stats.albums.count == 1)
        #expect(stats.total == 4)
    }

    @Test func pointsEachItemAtACoverAndAnArtistAtTheirMostPlayedReleasesCover() {
        let stats = PlayStats.aggregate(releases: [sea, lantern, bus], counts: counts)
        #expect(stats.tracks[0].coverPath == "cover.jpg")
        #expect(stats.albums[2].coverPath == nil)
        #expect(stats.artists[0].coverPath == "cover.jpg")

        let coverless = release(1, "Okoro", "Saltwater Hymns", sea.tracks, cover: nil)
        #expect(PlayStats.aggregate(releases: [coverless, lantern, bus], counts: counts).artists[0].coverPath == nil)
        let busWithCover = release(3, "Okoro", "Night Bus", bus.tracks, cover: "bus.jpg")
        #expect(PlayStats.aggregate(releases: [coverless, lantern, busWithCover], counts: counts).artists[0].coverPath == "bus.jpg")
    }

    @Test func fallsBackToTheReleaseTitleForAnUntitledTrackAndTheArtistForAnUntitledRelease() {
        let untitledTrack = release(1, "Someone", "Album", [track(11, "")])
        #expect(PlayStats.aggregate(releases: [untitledTrack], counts: plays(1, [(11, 1)])).tracks[0].title == "Album")
        let untitledRelease = release(2, "Someone", "", [track(12, "Song")])
        #expect(PlayStats.aggregate(releases: [untitledRelease], counts: plays(2, [(12, 1)])).albums[0].title == "Someone")
    }

    // MARK: - What the Stats page reads

    private var dated: [PlayCount] {
        [
            PlayCount(trackId: s(11), releaseId: s(1), plays: 5, lastPlayedDay: "2026-10-12"),
            PlayCount(trackId: s(12), releaseId: s(1), plays: 2, lastPlayedDay: "2026-10-14"),
            PlayCount(trackId: s(14), releaseId: s(3), plays: 4, lastPlayedDay: "2026-10-10"),
        ]
    }

    @Test func ranksEveryoneWithNoLimitAndRanksFromOne() {
        let stats = PlayStats.aggregate(releases: [sea, bus], counts: dated, limit: .max)
        #expect(stats.tracks.map(\.rank) == [1, 2, 3])
        #expect(stats.tracks.map(\.title) == ["Tide", "Night Bus", "Hymn"])
    }

    @Test func carriesTheReleaseAndTrackToOpen() {
        let stats = PlayStats.aggregate(releases: [sea, bus], counts: dated, limit: .max)
        #expect(stats.tracks.map(\.releaseId) == [u(1), u(3), u(1)])
        #expect(stats.tracks.map(\.trackId) == [u(11), u(14), u(12)])
        #expect(stats.albums.map(\.releaseId) == [u(1), u(3)])
        #expect(stats.albums.map(\.trackId) == [nil, nil])
        #expect(stats.artists.map(\.releaseId) == [nil])
    }

    @Test func carriesTheLastPlayedDayLatestAmongATracksAndReleases() {
        let stats = PlayStats.aggregate(releases: [sea, bus], counts: dated, limit: .max)
        #expect(stats.tracks.map(\.lastPlayedDay) == ["2026-10-12", "2026-10-10", "2026-10-14"])
        #expect(stats.albums.map(\.lastPlayedDay) == ["2026-10-14", "2026-10-10"])
        #expect(stats.artists[0].lastPlayedDay == "2026-10-14")
    }

    @Test func hasNoLastPlayedDayForCountsWithoutDays() {
        let stats = PlayStats.aggregate(releases: [sea], counts: plays(1, [(11, 3)]), limit: .max)
        #expect(stats.tracks[0].lastPlayedDay == nil)
        #expect(stats.albums[0].lastPlayedDay == nil)
        #expect(stats.artists[0].lastPlayedDay == nil)
    }
}
