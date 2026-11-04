import Foundation
import Testing
@testable import Locally

/// Adopting the phone's own Spotify folder (#332 step 3): grouping like the Mac, the scan's skips, read-only adoption,
/// and linking to a release synced from the Mac. Every test works in a temp directory with a fake tag reader.

// MARK: - Fixtures

private func tags(
    _ title: String?, artist: String? = "Band", albumArtist: String? = nil, album: String? = nil,
    track: Int? = nil, disc: Int? = nil, year: String? = nil, genre: String? = nil, cover: Bool = false, seconds: Double = 180
) -> AdoptFileTags {
    AdoptFileTags(
        title: title, artist: artist, albumArtist: albumArtist, album: album, year: year, genre: genre,
        trackNumber: track, discNumber: disc, durationSec: seconds, hasCover: cover
    )
}

private func scanned(_ path: String, _ tags: AdoptFileTags) -> ScannedFile { ScannedFile(path: path, tags: tags) }

private final class FakeAdoptReader: AdoptTagReading {
    var tagsByName: [String: AdoptFileTags] = [:]
    var covers: [String: Data] = [:]
    private(set) var readNames: [String] = []

    func readTags(at url: URL) async throws -> AdoptFileTags {
        readNames.append(url.lastPathComponent)
        guard let tags = tagsByName[url.lastPathComponent] else { throw LocallyError.importFailed("unreadable") }
        return tags
    }

    func coverData(at url: URL) async -> Data? { covers[url.lastPathComponent] }
}

@MainActor
private final class AdoptHarness {
    let root: URL
    let library = InMemoryLibraryStore()
    let covers = FakeCoverStore()
    let reader = FakeAdoptReader()
    let hook = FakeReleaseSyncHook()
    let adopter: SpotifyAdopter

    init() {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("Adopt-\(UUID().uuidString)", isDirectory: true)
        adopter = SpotifyAdopter(folder: FakeSpotifyFolder(directory: root), library: library, coverStore: covers, reader: reader)
        adopter.syncHook = hook
    }

    func cleanUp() { try? FileManager.default.removeItem(at: root) }

    /// Writes a small file at `relative` and registers its tags under the file's name (names are unique per test).
    func file(_ relative: String, _ fileTags: AdoptFileTags?, cover: Data? = nil) throws {
        let url = root.appendingPathComponent(relative)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("audio:\(relative)".utf8).write(to: url)
        if let fileTags { reader.tagsByName[url.lastPathComponent] = fileTags }
        if let cover { reader.covers[url.lastPathComponent] = cover }
    }

    /// Every file's bytes and modification date, to prove nothing in the folder changed.
    func snapshot() throws -> [String: String] {
        var result: [String: String] = [:]
        let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey])
        while let url = enumerator?.nextObject() as? URL {
            let values = try url.resourceValues(forKeys: [.contentModificationDateKey, .isRegularFileKey])
            guard values.isRegularFile == true else { continue }
            let data = try Data(contentsOf: url)
            result[url.path] = "\(data.sha256Hex)|\(values.contentModificationDate?.timeIntervalSince1970 ?? 0)"
        }
        return result
    }

    func allReleases() throws -> [Release] { try library.all() }
}

/// A release the Mac adopted, as it arrives on the phone: details only, bare file names, `localId`s set.
private func macAdopted(title: String = "Night Drive", artist: String = "Band", songs: [(title: String, seconds: Double)]) -> Release {
    let tracks = songs.enumerated().map { index, song in
        Track(
            title: song.title, trackNumber: index + 1, filePath: "\(index + 1) \(song.title).mp3", originalName: "\(index + 1) \(song.title).mp3",
            durationSec: song.seconds,
            localId: LocalId.build(artist: artist, album: title, title: song.title, durationSec: song.seconds)
        )
    }
    let stamp = Date(timeIntervalSince1970: 1_700_000_000)
    return Release(
        kind: .album, title: title, artist: artist, folderPath: "", tracks: tracks,
        createdAt: stamp, updatedAt: stamp, syncedUpdatedAt: stamp, source: .adopted
    )
}

// MARK: - Local id helpers

struct LocalIdSplitTests {
    @Test func splitsTheIdAtItsLastColonAndKeepsEncodedColonsInTheSong() {
        let id = LocalId.build(artist: "A", album: "B", title: "Part 1: The Start", durationSec: 120.9)
        let parts = LocalId.split(id)
        #expect(parts?.seconds == 120)
        #expect(parts?.identity == "spotify:local:A:B:Part+1%3A+The+Start")
        #expect(LocalId.split("not a local id") == nil)
        #expect(LocalId.split("spotify:local:") == nil)
    }
}

// MARK: - Grouping (the Mac's AdoptScanner cases)

struct AdoptGroupingTests {
    @Test func threeTracksOfOneAlbumAreOrderedByTrackWithYearGenreAndCover() {
        let group = AdoptGrouping.group([
            scanned("Album One/c.mp3", tags("Three", albumArtist: "Band", album: "Rec", track: 3)),
            scanned("Album One/a.mp3", tags("One", albumArtist: "Band", album: "Rec", track: 1, year: "2021", genre: "Rock", cover: true)),
            scanned("Album One/b.mp3", tags("Two", albumArtist: "Band", album: "Rec", track: 2)),
        ])
        #expect(group.count == 1)
        let g = group[0]
        #expect(g.kind == .album)
        #expect(g.title == "Rec")
        #expect(g.artist == "Band")
        #expect(g.year == "2021")
        #expect(g.genre == "Rock")
        #expect(g.folder == "Album One")
        #expect(g.tracks.map(\.title) == ["One", "Two", "Three"])
        #expect(g.tracks.map(\.trackNumber) == [1, 2, 3])
        #expect(g.coverFrom == "Album One/a.mp3")
    }

    @Test func usesTheMostCommonArtistWhenThereIsNoAlbumArtist() {
        let g = AdoptGrouping.group([
            scanned("x/1.mp3", tags("A", artist: "Main", album: "Mix", track: 1)),
            scanned("x/2.mp3", tags("B", artist: "Main", album: "Mix", track: 2)),
            scanned("x/3.mp3", tags("C", artist: "Guest", album: "Mix", track: 3)),
        ])[0]
        #expect(g.kind == .album)
        #expect(g.artist == "Main")
    }

    @Test func aLoneTaggedFileIsASingleTitledFromItsAlbum() {
        let g = AdoptGrouping.group([scanned("s/solo.mp3", tags("Solo", artist: "Her", album: "Solo EP", track: 1))])[0]
        #expect(g.kind == .single)
        #expect(g.title == "Solo EP")
        #expect(g.artist == "Her")
        #expect(g.tracks.count == 1)
    }

    @Test func aFileWithNoAlbumTagIsItsOwnSingleTitledFromItsTitleTagOrFileName() {
        let groups = AdoptGrouping.group([
            scanned("loose/named.mp3", tags("Has Title", artist: "Ann")),
            scanned("loose/just a file.mp3", tags(nil, artist: "Ann")),
        ])
        #expect(groups.count == 2)
        #expect(groups.allSatisfy { $0.kind == .single })
        #expect(groups.map(\.title).sorted() == ["Has Title", "just a file"])
        let bare = groups.first { $0.title == "just a file" }
        #expect(bare?.tracks[0].localId == LocalId.build(artist: "Ann", album: "", title: "just a file", durationSec: 180))
    }

    @Test func theSameAlbumInTwoFoldersIsTwoGroupsWithStableDifferentKeys() {
        let files = ["Masters", "Unmastered"].flatMap { folder in
            [1, 2].map { scanned("\(folder)/\($0).mp3", tags("T\($0)", albumArtist: "Band", album: "Rec", track: $0)) }
        }
        let groups = AdoptGrouping.group(files)
        #expect(groups.count == 2)
        #expect(Set(groups.map(\.key)).count == 2)
        #expect(groups.allSatisfy { $0.kind == .album && $0.title == "Rec" })
        #expect(AdoptGrouping.group(files).map(\.key) == groups.map(\.key))
        #expect(groups.map(\.folder) == ["Masters", "Unmastered"])
    }

    @Test func discsOrderBeforeTracks() {
        let g = AdoptGrouping.group([
            scanned("double/d2t1.mp3", tags("D2T1", albumArtist: "B", album: "Two Discs", track: 1, disc: 2)),
            scanned("double/d1t2.mp3", tags("D1T2", albumArtist: "B", album: "Two Discs", track: 2, disc: 1)),
            scanned("double/d1t1.mp3", tags("D1T1", albumArtist: "B", album: "Two Discs", track: 1, disc: 1)),
        ])[0]
        #expect(g.tracks.map(\.title) == ["D1T1", "D1T2", "D2T1"])
        #expect(g.tracks.map(\.discNumber) == [1, 1, 2])
        // Track numbers never restart per disc on the phone: they become the release-wide position.
        #expect(AdoptGrouping.releaseWideNumbers(g.tracks) == [1, 2, 3])
    }

    @Test func uniqueTagNumbersAreKeptAndDuplicatesAreRenumbered() {
        let kept = AdoptGrouping.group([
            scanned("a/1.mp3", tags("A", album: "X", track: 2)), scanned("a/2.mp3", tags("B", album: "X", track: 5)),
        ])[0]
        #expect(AdoptGrouping.releaseWideNumbers(kept.tracks) == [2, 5])
        let dupes = AdoptGrouping.group([
            scanned("a/1.mp3", tags("A", album: "X", track: 1)), scanned("a/2.mp3", tags("B", album: "X", track: 1)),
        ])[0]
        #expect(AdoptGrouping.releaseWideNumbers(dupes.tracks) == [1, 2])
    }

    @Test func fileNamesOrderNumericallyAndIgnoringCase() {
        let g = AdoptGrouping.group([
            scanned("f/Track 10.mp3", tags("Ten", album: "N")), scanned("f/track 2.mp3", tags("Two", album: "N")),
        ])[0]
        #expect(g.tracks.map(\.title) == ["Two", "Ten"])
    }
}

// MARK: - Matching

struct AdoptMatchingTests {
    private func group(_ songs: [(String, Double)], album: String = "Night Drive") -> ProposedGroup {
        AdoptGrouping.group(songs.enumerated().map { index, song in
            scanned("Synced files/\(album)/\(index + 1).mp3", tags(song.0, artist: "Band", albumArtist: "Band", album: album, track: index + 1, seconds: song.1))
        })[0]
    }

    @Test func aGroupWhoseSongsAllMatchLinksToTheSyncedRelease() throws {
        let release = macAdopted(songs: [("Intro", 100), ("Drive", 200)])
        let match = try #require(AdoptMatching.match(group([("Intro", 100), ("Drive", 200)]), in: [release]))
        #expect(match.releaseId == release.id)
        #expect(match.links.map(\.path) == ["Synced files/Night Drive/1.mp3", "Synced files/Night Drive/2.mp3"])
        #expect(Set(match.links.map(\.trackId)) == Set(release.tracks.map(\.id)))
    }

    @Test func aLengthOneSecondOffStillMatchesButTwoDoesNot() {
        let release = macAdopted(songs: [("Intro", 100)])
        #expect(AdoptMatching.match(group([("Intro", 101.4)]), in: [release]) != nil)
        #expect(AdoptMatching.match(group([("Intro", 103)]), in: [release]) == nil)
    }

    @Test func aGroupWithASongTheReleaseLacksDoesNotMatch() {
        let release = macAdopted(songs: [("Intro", 100), ("Drive", 200)])
        #expect(AdoptMatching.match(group([("Intro", 100), ("Other", 50)]), in: [release]) == nil)
    }

    @Test func aReleaseThisPhoneAdoptedItselfOrAlreadyLinkedTrackIsNotACandidate() {
        var own = macAdopted(songs: [("Intro", 100)])
        own.adoptedHere = true
        #expect(AdoptMatching.match(group([("Intro", 100)]), in: [own]) == nil)
        var linked = macAdopted(songs: [("Intro", 100)])
        linked.tracks[0].spotifyPath = "elsewhere/1.mp3"
        #expect(AdoptMatching.match(group([("Intro", 100)]), in: [linked]) == nil)
    }

    @Test func aReleaseMadeInLocallyIsNeverAMatch() {
        var plain = macAdopted(songs: [("Intro", 100)])
        plain.source = nil
        #expect(AdoptMatching.match(group([("Intro", 100)]), in: [plain]) == nil)
    }
}

// MARK: - Scan

@MainActor
struct SpotifyFolderScanTests {
    @Test func skipsTheLocallyFolderHiddenEntriesAndPathsAlreadyTracked() async throws {
        let h = AdoptHarness()
        defer { h.cleanUp() }
        try h.file("Locally/own.mp3", tags("Own", album: "Mine", track: 1))
        try h.file("Synced files/A/one.mp3", tags("One", albumArtist: "Band", album: "A", track: 1))
        try h.file("Synced files/A/two.mp3", tags("Two", albumArtist: "Band", album: "A", track: 2))
        try h.file("Synced files/A/.hidden.mp3", tags("Hidden", album: "A"))
        try h.file("Synced files/.Trash/gone.mp3", tags("Gone", album: "G"))
        try h.file("old.mp3", tags("Old", album: "Legacy", track: 1))
        try h.file("linked.mp3", tags("Linked", album: "L", track: 1))
        try h.file("Synced files/Locally/deeper.mp3", tags("Deeper", album: "Deep", track: 1))
        // A release Locally made before the brand-folder move (absolute path) and a linked adopted track (relative).
        try h.library.upsert(Release(kind: .single, title: "Legacy", artist: "Band", folderPath: h.root.path,
                                        tracks: [Track(title: "Old", trackNumber: 1, filePath: h.root.appendingPathComponent("old.mp3").path, originalName: "old.mp3")]))
        var adopted = macAdopted(songs: [("Linked", 60)])
        adopted.tracks[0].spotifyPath = "linked.mp3"
        try h.library.upsert(adopted)

        let review = try await h.adopter.scan()

        let titles = review.items.map(\.group.title).sorted()
        #expect(titles == ["A", "Deep"], "the Locally folder, hidden entries and tracked paths are left out; a folder named Locally deeper down is the user's")
        #expect(!h.reader.readNames.contains("own.mp3"))
        #expect(!h.reader.readNames.contains("old.mp3"))
        #expect(!h.reader.readNames.contains("linked.mp3"))
        #expect(!h.reader.readNames.contains(".hidden.mp3"))
    }

    @Test func countsUnreadableAndUnsupportedAudioButNotOtherFiles() async throws {
        let h = AdoptHarness()
        defer { h.cleanUp() }
        try h.file("a/ok.mp3", tags("Ok", album: "A", track: 1))
        try h.file("a/broken.m4a", nil)
        try h.file("a/song.flac", nil)
        try h.file("a/clip.mp4", nil)
        try h.file("a/cover.jpg", nil)

        let review = try await h.adopter.scan()

        #expect(review.items.count == 1)
        #expect(review.skipped == [".m4a": 1, ".flac": 1, ".mp4": 1])
        #expect(review.skippedCount == 3)
    }

    @Test func aGroupMatchingASyncedReleaseIsMarkedOnTheMac() async throws {
        let h = AdoptHarness()
        defer { h.cleanUp() }
        let release = macAdopted(songs: [("Intro", 100), ("Drive", 200)])
        try h.library.upsert(release)
        try h.file("Synced files/Night Drive/1.mp3", tags("Intro", albumArtist: "Band", album: "Night Drive", track: 1, seconds: 100))
        try h.file("Synced files/Night Drive/2.mp3", tags("Drive", albumArtist: "Band", album: "Night Drive", track: 2, seconds: 200))
        try h.file("Other/x.mp3", tags("X", albumArtist: "Band", album: "Other", track: 1))

        let review = try await h.adopter.scan()

        #expect(review.items.count == 2)
        #expect(review.items.first { $0.group.title == "Night Drive" }?.isOnMac == true)
        #expect(review.items.first { $0.group.title == "Other" }?.isOnMac == false)
    }
}

// MARK: - Adopt

@MainActor
struct SpotifyAdoptTests {
    @Test func newMusicIsAddedDetailsOnlyReadOnlyWithRelativePathsAndNothingInTheFolderChanges() async throws {
        let h = AdoptHarness()
        defer { h.cleanUp() }
        let art = Data([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3])
        try h.file("Synced files/Night Drive/02 Drive.mp3", tags("Drive", albumArtist: "Band", album: "Night Drive", track: 2, year: "2021", genre: "Synth", seconds: 200.7))
        try h.file("Synced files/Night Drive/01 Intro.mp3", tags("Intro", albumArtist: "Band", album: "Night Drive", track: 1, cover: true, seconds: 100), cover: art)
        let before = try h.snapshot()

        let review = try await h.adopter.scan()
        let outcome = try await h.adopter.adopt(review, keys: Set(review.items.map(\.id)))

        #expect(outcome.added == 1)
        #expect(outcome.linked == 0)
        let release = try #require(try h.allReleases().first)
        #expect(release.source == .adopted)
        #expect(release.adoptedHere)
        #expect(release.isAdopted)
        #expect(release.title == "Night Drive")
        #expect(release.artist == "Band")
        #expect(release.year == "2021")
        #expect(release.genre == "Synth")
        #expect(release.kind == .album)
        #expect(release.tracks.map(\.title) == ["Intro", "Drive"])
        #expect(release.tracks.map(\.spotifyPath) == ["Synced files/Night Drive/01 Intro.mp3", "Synced files/Night Drive/02 Drive.mp3"])
        #expect(release.tracks.map(\.filePath) == ["01 Intro.mp3", "02 Drive.mp3"])
        #expect(release.tracks.map(\.localId) == [
            LocalId.build(artist: "Band", album: "Night Drive", title: "Intro", durationSec: 100),
            LocalId.build(artist: "Band", album: "Night Drive", title: "Drive", durationSec: 200.7),
        ])
        #expect(h.covers.load(release.id) == art, "the cover is a copy in the app's own storage")
        #expect(release.coverPath != nil)
        #expect(release.syncedUpdatedAt == nil, "it still has to be pushed")
        #expect(h.hook.pushedReleases.map(\.id) == [release.id])
        #expect(try h.snapshot() == before, "no file in the Spotify folder was written, moved or touched")
        #expect(FileManager.default.fileExists(atPath: h.root.appendingPathComponent("Locally").path) == false, "not even the Locally folder is made")
    }

    @Test func adoptedTracksPlayFromTheirRelativePaths() async throws {
        let h = AdoptHarness()
        defer { h.cleanUp() }
        try h.file("Synced files/Solo.mp3", tags("Solo", album: "Solo EP", track: 1))
        let review = try await h.adopter.scan()
        try await h.adopter.adopt(review, keys: Set(review.items.map(\.id)))
        let release = try #require(try h.allReleases().first)
        let track = release.tracks[0]

        let url = ReleaseCoordinator.resolvedFileURL(for: track, in: h.root)
        #expect(url.path == h.root.appendingPathComponent("Synced files/Solo.mp3").path)
        #expect(ReleaseCoordinator.containedFileURL(for: track, in: h.root) != nil)
        #expect(PlaybackService.canPlay(release))
        #expect(PlaybackService.canPlay(release, trackID: track.id))
    }

    @Test func aSecondDeviceMatchLinksTheFilesToTheExistingReleaseInsteadOfDuplicating() async throws {
        let h = AdoptHarness()
        defer { h.cleanUp() }
        let existing = macAdopted(songs: [("Intro", 100), ("Drive", 200)])
        try h.library.upsert(existing)
        try h.file("Synced files/Night Drive/1.mp3", tags("Intro", albumArtist: "Band", album: "Night Drive", track: 1, seconds: 100))
        try h.file("Synced files/Night Drive/2.mp3", tags("Drive", albumArtist: "Band", album: "Night Drive", track: 2, seconds: 200))
        #expect(!PlaybackService.canPlay(existing), "details only until it is linked")

        let review = try await h.adopter.scan()
        let outcome = try await h.adopter.adopt(review, keys: Set(review.items.map(\.id)))

        #expect(outcome.linked == 1)
        #expect(outcome.added == 0)
        let releases = try h.allReleases()
        #expect(releases.count == 1, "no second record")
        let linked = try #require(releases.first)
        #expect(linked.id == existing.id)
        #expect(linked.tracks.map(\.spotifyPath) == ["Synced files/Night Drive/1.mp3", "Synced files/Night Drive/2.mp3"])
        #expect(linked.tracks.map(\.id) == existing.tracks.map(\.id), "the record's track ids are kept")
        #expect(!linked.adoptedHere, "the Mac still owns the record")
        #expect(linked.updatedAt == existing.updatedAt)
        #expect(linked.syncedUpdatedAt == existing.syncedUpdatedAt)
        #expect(h.hook.pushedReleases.isEmpty, "a link is local knowledge; nothing is pushed")
        #expect(PlaybackService.canPlay(linked))

        // Linked paths are tracked now: a second look finds nothing.
        let again = try await h.adopter.scan()
        #expect(again.items.isEmpty)
    }

    @Test func aLinkedReleaseKeepsItsFilesWhenANewerRecordArrives() throws {
        let h = AdoptHarness()
        var existing = macAdopted(songs: [("Intro", 100)])
        existing.tracks[0].spotifyPath = "Synced files/1.mp3"
        try h.library.upsert(existing)
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(), transcoder: FakeTranscoder(), m4aTagWriter: FakeTagWriter(), id3TagWriter: FakeTagWriter(),
            folder: FakeSpotifyFolder(directory: h.root), library: h.library, coverStore: h.covers, durationReader: FakeDurationReader()
        )
        defer { h.cleanUp() }
        var record = existing.toSyncRecord(origin: "mac", originDevice: "Mac", fileBytes: [:])
        record.title = "Night Drive II"
        record.updatedAt = existing.updatedAt.addingTimeInterval(60)
        record.source = .adopted

        let stored = try coordinator.importAdopted(record, coverData: nil)

        #expect(stored.title == "Night Drive II")
        #expect(stored.tracks.map(\.spotifyPath) == ["Synced files/1.mp3"])
        #expect(!stored.adoptedHere)
    }

    @Test func addingTwiceAddsNothingTheSecondTime() async throws {
        let h = AdoptHarness()
        defer { h.cleanUp() }
        try h.file("a/one.mp3", tags("One", album: "A", track: 1))
        let review = try await h.adopter.scan()
        let keys = Set(review.items.map(\.id))
        _ = try await h.adopter.adopt(review, keys: keys)

        let second = try await h.adopter.adopt(review, keys: keys)

        #expect(second.added == 0)
        #expect(second.alreadyAdded == 1)
        #expect(try h.allReleases().count == 1)
    }

    @Test func onlyTheTickedGroupsAreAdded() async throws {
        let h = AdoptHarness()
        defer { h.cleanUp() }
        try h.file("a/one.mp3", tags("One", album: "A", track: 1))
        try h.file("b/two.mp3", tags("Two", album: "B", track: 1))
        let review = try await h.adopter.scan()
        let keep = try #require(review.items.first { $0.group.title == "A" })

        let outcome = try await h.adopter.adopt(review, keys: [keep.id])

        #expect(outcome.added == 1)
        #expect(try h.allReleases().map(\.title) == ["A"])
    }

    @Test func aPathThatEscapesTheFolderOrReachesIntoLocallyIsRefused() async throws {
        let h = AdoptHarness()
        defer { h.cleanUp() }
        func review(_ path: String) -> AdoptReview {
            let track = ProposedTrack(path: path, title: "Bad", trackNumber: 1, discNumber: nil, durationSec: 10, localId: LocalId.build(artist: "", album: "", title: "Bad", durationSec: 10))
            let group = ProposedGroup(key: "k\(path)", folder: "", kind: .single, title: "Bad", artist: "", year: nil, genre: nil, coverFrom: nil, tracks: [track])
            return AdoptReview(items: [AdoptReview.Item(group: group, match: nil)], skipped: [:], unreadable: 0)
        }
        for path in ["../outside.mp3", "a/../../outside.mp3", "/etc/passwd", "Locally/own.mp3", "", "a//b.mp3"] {
            let r = review(path)
            let outcome = try await h.adopter.adopt(r, keys: Set(r.items.map(\.id)))
            #expect(outcome.added == 0, "\(path)")
            #expect(outcome.failed == ["Bad"], "\(path)")
        }
        #expect(try h.allReleases().isEmpty)
    }

    @Test func aDeleteOfAnAdoptedReleaseForgetsItAndLeavesTheFilesAlone() async throws {
        let h = AdoptHarness()
        defer { h.cleanUp() }
        try h.file("a/one.mp3", tags("One", album: "A", track: 1))
        let review = try await h.adopter.scan()
        _ = try await h.adopter.adopt(review, keys: Set(review.items.map(\.id)))
        let release = try #require(try h.allReleases().first)
        let before = try h.snapshot()
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(), transcoder: FakeTranscoder(), m4aTagWriter: FakeTagWriter(), id3TagWriter: FakeTagWriter(),
            folder: FakeSpotifyFolder(directory: h.root), library: h.library, coverStore: h.covers, durationReader: FakeDurationReader()
        )

        try await coordinator.deleteRelease(release.id)

        #expect(try h.allReleases().isEmpty)
        #expect(try h.snapshot() == before)
    }
}

// MARK: - Every write path refuses an adopted release

@MainActor
struct AdoptedWriteGuardTests {
    private func coordinator(_ h: AdoptHarness, tagWriter: FakeTagWriter) -> ReleaseCoordinator {
        ReleaseCoordinator(
            importer: FakeFileImporter(), transcoder: FakeTranscoder(), m4aTagWriter: tagWriter, id3TagWriter: tagWriter,
            folder: FakeSpotifyFolder(directory: h.root), library: h.library, coverStore: h.covers, durationReader: FakeDurationReader()
        )
    }

    @Test func editsAndRemoteRetagsOfAnAdoptedReleaseAreRefusedAndNothingIsTagged() async throws {
        let h = AdoptHarness()
        defer { h.cleanUp() }
        var release = macAdopted(songs: [("Intro", 100)])
        release.tracks[0].spotifyPath = "Synced files/1.mp3"
        release.adoptedHere = true
        try h.library.upsert(release)
        let tagWriter = FakeTagWriter()
        let coordinator = coordinator(h, tagWriter: tagWriter)

        await #expect(throws: LocallyError.self) {
            _ = try await coordinator.updateRelease(release.id, changes: ReleaseChanges(title: "Renamed", cover: Data([1])))
        }
        var record = release.toSyncRecord(origin: "mac", originDevice: "Mac", fileBytes: [:])
        record.updatedAt = release.updatedAt.addingTimeInterval(60)
        await #expect(throws: LocallyError.self) {
            _ = try await coordinator.applyRemoteUpdate(record, newCoverData: Data([1]))
        }

        #expect(tagWriter.calls.isEmpty)
        #expect(try h.allReleases().first?.title == "Night Drive")
        #expect(release.ownsSyncRecord)
        #expect(throws: LocallyError.self) { try release.assertWritable() }
    }
}

// MARK: - Sync

@MainActor
struct AdoptedHereSyncTests {
    @Test func aPhoneAdoptedReleasePushesDetailsAndCoverOnly() async throws {
        let h = AdoptHarness()
        defer { h.cleanUp() }
        let art = Data([0xFF, 0xD8, 0xFF, 0xE0, 4, 5, 6])
        try h.file("Synced files/Night Drive/1.mp3", tags("Intro", albumArtist: "Band", album: "Night Drive", track: 1, cover: true, seconds: 100), cover: art)
        try h.file("Synced files/Night Drive/2.mp3", tags("Drive", albumArtist: "Band", album: "Night Drive", track: 2, seconds: 200))
        let review = try await h.adopter.scan()
        _ = try await h.adopter.adopt(review, keys: Set(review.items.map(\.id)))
        let release = try #require(try h.allReleases().first)

        let api = FakeSyncApi()
        let account = InMemorySyncAccountStore()
        account.save(email: "toby@example.com", deviceToken: "test-token", deviceId: "device-1")
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(), transcoder: FakeTranscoder(), m4aTagWriter: FakeTagWriter(), id3TagWriter: FakeTagWriter(),
            folder: FakeSpotifyFolder(directory: h.root), library: h.library, coverStore: h.covers, durationReader: FakeDurationReader()
        )
        let engine = SyncEngine(
            api: api, account: account, library: h.library, coordinator: coordinator, coverStore: h.covers,
            outbox: InMemorySyncOutbox(), now: { Date() }, deviceName: { "Toby's iPhone" }, defaults: UserDefaults(suiteName: UUID().uuidString)!
        )

        await engine.push(release)

        let put = try #require(api.putCalls.first)
        #expect(put.source == .adopted)
        #expect(put.tracks.map(\.file) == ["1.mp3", "2.mp3"])
        #expect(put.tracks.allSatisfy { $0.bytes > 0 })
        #expect(put.tracks.map(\.localId) == release.tracks.map(\.localId))
        #expect(api.requestUploadsCalls.flatMap { $0.files.map(\.name) } == ["cover.jpg"], "the audio stays where it is")
        let stored = try #require(try h.allReleases().first)
        #expect(stored.syncedUpdatedAt != nil)
        #expect(!SyncEngine.needsPush(stored, coverName: "cover.jpg"), "settled after one push")
    }

    @Test func aReleaseAdoptedOnTheMacIsNeverPushedEvenOnceLinked() async throws {
        let h = AdoptHarness()
        defer { h.cleanUp() }
        var release = macAdopted(songs: [("Intro", 100)])
        release.tracks[0].spotifyPath = "Synced files/1.mp3"
        try h.library.upsert(release)
        let api = FakeSyncApi()
        let account = InMemorySyncAccountStore()
        account.save(email: "toby@example.com", deviceToken: "test-token", deviceId: "device-1")
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(), transcoder: FakeTranscoder(), m4aTagWriter: FakeTagWriter(), id3TagWriter: FakeTagWriter(),
            folder: FakeSpotifyFolder(directory: h.root), library: h.library, coverStore: h.covers, durationReader: FakeDurationReader()
        )
        let engine = SyncEngine(
            api: api, account: account, library: h.library, coordinator: coordinator, coverStore: h.covers,
            outbox: InMemorySyncOutbox(), now: { Date() }, deviceName: { "Toby's iPhone" }, defaults: UserDefaults(suiteName: UUID().uuidString)!
        )

        await engine.push(release)

        #expect(api.putCalls.isEmpty)
        #expect(api.requestUploadsCalls.isEmpty)
        #expect(!release.ownsSyncRecord)
    }

    @Test func theUploadNamesOfAnAdoptedReleaseAreItsCoverOnly() {
        var release = macAdopted(songs: [("Intro", 100)])
        #expect(SyncEngine.expectedUploadNames(of: release, coverName: "cover.jpg") == ["cover.jpg"])
        release.source = nil
        #expect(SyncEngine.expectedUploadNames(of: release, coverName: "cover.jpg") == ["1 Intro.mp3", "cover.jpg"])
    }
}

// MARK: - The one-time offer

struct AdoptOfferTests {
    @Test func theOfferIsMadeOnceAndNeverRunsAScan() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        #expect(AdoptOffer.shouldOffer(defaults: defaults))
        AdoptOffer.markOffered(defaults: defaults)
        #expect(!AdoptOffer.shouldOffer(defaults: defaults))
    }
}

// MARK: - Playback of partly linked releases

@MainActor
struct LinkedPlaybackTests {
    @Test func onlyTheLinkedTracksOfAnAdoptedReleasePlay() {
        var release = macAdopted(songs: [("Intro", 100), ("Drive", 200)])
        #expect(!PlaybackService.canPlay(release))
        release.tracks[1].spotifyPath = "Synced files/2.mp3"
        #expect(PlaybackService.canPlay(release))
        #expect(!PlaybackService.canPlay(release, trackID: release.tracks[0].id))
        #expect(PlaybackService.canPlay(release, trackID: release.tracks[1].id))
        var own = macAdopted(songs: [("Intro", 100)])
        own.source = nil
        #expect(PlaybackService.canPlay(own, trackID: own.tracks[0].id))
    }

    @Test func aCollectionRowIsHeldOnlyWhereThePhoneHasTheFile() {
        var release = macAdopted(songs: [("Intro", 100), ("Drive", 200)])
        release.tracks[0].spotifyPath = "Synced files/1.mp3"
        #expect(release.holdsAudio(release.tracks[0]))
        #expect(!release.holdsAudio(release.tracks[1]))
    }
}
