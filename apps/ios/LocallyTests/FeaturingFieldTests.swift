import Foundation
import Testing
@testable import Locally

/// The Featuring field (#287): its pure rules, the split and join through each editor's save path,
/// and the split of an imported artist tag.
@MainActor
struct FeaturingFieldTests {
    // MARK: Pure helpers

    @Test func addTrimsAndSkipsAnEmptyName() {
        #expect(FeaturingNames.add("  Mira Vale \n", to: ["B"]) == ["B", "Mira Vale"])
        #expect(FeaturingNames.add("   ", to: ["B"]) == ["B"])
    }

    @Test func addSkipsADuplicateByKey() {
        #expect(FeaturingNames.add("mira  vale", to: ["Mira Vale"]) == ["Mira Vale"])
        #expect(FeaturingNames.add("Beyonce", to: ["Beyoncé"]) == ["Beyoncé"])
    }

    @Test func aCommaEndsAName() {
        var names: [String] = []
        let rest = FeaturingNames.absorbCommas("B, C,  D", into: &names)
        #expect(names == ["B", "C"])
        #expect(rest == "  D")
        #expect(FeaturingNames.commit("B, C,  D", to: []) == ["B", "C", "D"])
    }

    @Test func noSavedNameCanHoldAZeroWidthSpace() {
        #expect(FeaturingNames.add("\u{200B}Mira\u{200B} Vale\u{200B}", to: []) == ["Mira Vale"])
        #expect(FeaturingNames.add("\u{200B}", to: ["B"]) == ["B"])
        #expect(FeaturingNames.commit("\u{200B}C\u{200B}, \u{200B}D", to: []) == ["C", "D"])
        #expect(FeaturingNames.add("\u{200B}mira vale", to: ["Mira Vale"]) == ["Mira Vale"])
    }

    @Test func removeTakesOnePillAway() {
        #expect(FeaturingNames.remove("B", from: ["B", "C"]) == ["C"])
    }

    @Test func displayAndMergeUseTheTitleWording() {
        #expect(FeaturingNames.display(["B", "C", "D"]) == "B, C & D")
        #expect(Copy.Featuring.suffix(["B", "C"]) == "feat. B & C")
        #expect(FeaturingNames.merged(["B"], ["b", "C"]) == ["B", "C"])
    }

    @Test func aTitleSplitAndJoinedAgainIsUnchanged() {
        for title in ["Song (feat. B)", "Song (feat. B & C)", "Song (feat. B, C & D)", "Song"] {
            let split = ArtistNames.splitFeaturing(title)
            #expect(ArtistNames.joinFeaturing(split.title, split.featuring) == title)
        }
        // An original worded another way is kept while its names are untouched.
        #expect(FeaturingNames.fullTitle(plain: "Song", featuring: ["B", "C", "D"], original: "Song (feat. B, C, D)") == "Song (feat. B, C, D)")
        #expect(FeaturingNames.fullTitle(plain: "Song", featuring: ["B"], original: "Song (feat. B, C, D)") == "Song (feat. B)")
    }

    // MARK: Fixtures

    private func makeSourceFile(named name: String = "song.mp3") throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try Data([0xFF, 0xFB, 1, 2, 3, 4]).write(to: url)
        return url
    }

    private struct Rig {
        let importer = FakeFileImporter()
        let tagWriter = FakeTagWriter()
        let library = InMemoryLibraryStore()
        let coverStore = FakeCoverStore()
        let coordinator: ReleaseCoordinator

        init() {
            let folder = FakeSpotifyFolder(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true))
            coordinator = ReleaseCoordinator(
                importer: importer,
                transcoder: FakeTranscoder(),
                m4aTagWriter: tagWriter,
                id3TagWriter: tagWriter,
                folder: folder,
                library: library,
                coverStore: coverStore,
                durationReader: FakeDurationReader()
            )
        }
    }

    // MARK: Import single

    @Test func theImportSplitsAnArtistTagIntoArtistAndFeatures() async throws {
        let rig = Rig()
        let url = try makeSourceFile()
        rig.importer.tagsByURL[url] = TagSet(title: "Song", artist: "A feat. B", album: "Song")
        let model = ImportSingleViewModel(importer: rig.importer, coordinator: rig.coordinator)

        await model.pick(url: url)

        #expect(model.artist == "A")
        #expect(model.featuring == ["B"])
        #expect(model.title == "Song")
    }

    @Test func theImportMergesTitleAndArtistFeaturesWithoutDuplicates() async throws {
        let rig = Rig()
        let url = try makeSourceFile()
        rig.importer.tagsByURL[url] = TagSet(title: "Song (feat. B & C)", artist: "A ft. c", album: "Song")
        let model = ImportSingleViewModel(importer: rig.importer, coordinator: rig.coordinator)

        await model.pick(url: url)

        #expect(model.title == "Song")
        #expect(model.artist == "A")
        #expect(model.featuring == ["B", "C"])
    }

    @Test func importSingleWritesTheJoinedTitleAndKeepsTheReleaseTitlePlain() async throws {
        let rig = Rig()
        let url = try makeSourceFile()
        rig.importer.tagsByURL[url] = TagSet(title: "Song", artist: "A feat. B", album: "Song")
        let model = ImportSingleViewModel(importer: rig.importer, coordinator: rig.coordinator)
        await model.pick(url: url)
        model.featuringDraft = "C"

        await model.send()

        let written = try #require(rig.tagWriter.calls.last).tags
        #expect(written.title == "Song (feat. B & C)")
        #expect(written.artist == "A")
        #expect(written.album == "Song")
        let release = try #require(rig.library.all().first)
        #expect(release.title == "Song")
        #expect(release.artist == "A")
        #expect(release.tracks.first?.title == "Song (feat. B & C)")
    }

    // MARK: Album builder

    @Test func theAlbumBuilderSplitsEachFileAndSendsTheJoinedTitles() async throws {
        let rig = Rig()
        let first = try makeSourceFile(named: "one.mp3")
        let second = try makeSourceFile(named: "two.mp3")
        rig.importer.tagsByURL[first] = TagSet(title: "One (feat. B)", artist: "A feat. C", album: "Album")
        rig.importer.tagsByURL[second] = TagSet(title: "Two", artist: "A", album: "Album")
        let model = AlbumBuilderViewModel(importer: rig.importer, coordinator: rig.coordinator)

        await model.addFiles([first, second])

        #expect(model.rows.map(\.title) == ["One", "Two"])
        #expect(model.rows[0].featuring == ["B", "C"])
        #expect(model.rows[1].featuring.isEmpty)

        model.rows[1].featuring = ["D"]
        model.albumTitle = "Album"
        model.artist = "A"
        await model.send()

        let titles = rig.tagWriter.calls.map(\.tags.title)
        #expect(titles == ["One (feat. B & C)", "Two (feat. D)"])
        #expect(rig.tagWriter.calls.map(\.tags.artist) == ["A", "A"])
        #expect(try rig.library.all().first?.title == "Album")
        #expect(model.orderedTrackTitles == titles)
    }

    // MARK: Release page

    @Test func editingASinglesFeaturesRewritesTheTrackTitleAndNotTheReleaseTitle() async throws {
        let rig = Rig()
        let tags = TagSet(title: "Song (feat. B)", artist: "A", album: "Song", trackNumber: 1, totalTracks: 1)
        let release = try await rig.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)
        #expect(release.title == "Song")

        let model = ReleaseDetailViewModel(release: release, coordinator: rig.coordinator, coverStore: rig.coverStore)
        #expect(model.title == "Song")
        #expect(model.singleFeaturing == ["B"])
        #expect(!model.hasChanges)

        model.beginEditing()
        model.featuringDraft = "C"
        #expect(model.hasChanges)
        await model.save()

        let last = try #require(rig.tagWriter.calls.last).tags
        #expect(last.title == "Song (feat. B & C)")
        #expect(last.album == "Song")
        #expect(last.artist == "A")
        let saved = try #require(rig.library.all().first)
        #expect(saved.title == "Song")
        #expect(saved.tracks.first?.title == "Song (feat. B & C)")
        #expect(model.singleFeaturing == ["B", "C"])
        #expect(model.featuringDraft.isEmpty)
    }

    @Test func renamingASingleKeepsItsFeatures() async throws {
        let rig = Rig()
        let tags = TagSet(title: "Song (feat. B)", artist: "A", album: "Song", trackNumber: 1, totalTracks: 1)
        let release = try await rig.coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)
        let model = ReleaseDetailViewModel(release: release, coordinator: rig.coordinator, coverStore: rig.coverStore)

        model.title = "Tune"
        await model.save()

        #expect(try rig.library.all().first?.title == "Tune")
        #expect(try rig.library.all().first?.tracks.first?.title == "Tune (feat. B)")
    }

    @Test func editingAnAlbumRowsFeaturesSavesTheJoinedTitleAndLeavesOtherRowsAlone() async throws {
        let rig = Rig()
        let album = AlbumDraft(title: "Album", artist: "A", tracks: [TrackDraft(title: "One (feat. B, C, D)"), TrackDraft(title: "Two")])
        let release = try await rig.coordinator.importAlbum(files: [try makeSourceFile(named: "one.mp3"), try makeSourceFile(named: "two.mp3")], album: album, cover: nil)
        let model = ReleaseDetailViewModel(release: release, coordinator: rig.coordinator, coverStore: rig.coverStore)
        #expect(model.trackRows.map(\.title) == ["One", "Two"])
        #expect(model.trackRows[0].featuring == ["B", "C", "D"])

        model.trackRows[1].featuring = ["E"]
        #expect(model.changes.contains { if case .trackRenamed(_, let old, let new) = $0 { old == "Two" && new == "Two (feat. E)" } else { false } })
        await model.save()

        let titles = try #require(rig.library.all().first).tracks.sorted { $0.trackNumber < $1.trackNumber }.map(\.title)
        #expect(titles == ["One (feat. B, C, D)", "Two (feat. E)"])
        #expect(try rig.library.all().first?.title == "Album")
    }

    // MARK: Legacy singles

    /// A single saved before the Featuring field: release title and track title both "Song (feat. B)".
    private func legacySingle(_ rig: Rig) async throws -> Release {
        let url = try makeSourceFile()
        let release = try await rig.coordinator.importSingle(file: url, tags: TagSet(title: "Song", artist: "A", album: "Song", year: "2020"), cover: nil)
        var legacy = release
        legacy.title = "Song (feat. B)"
        legacy.tracks[0].title = "Song (feat. B)"
        try rig.library.upsert(legacy)
        return legacy
    }

    @Test func aNoChangeSaveLeavesALegacySinglesTitlesAlone() async throws {
        let rig = Rig()
        let release = try await legacySingle(rig)
        let model = ReleaseDetailViewModel(release: release, coordinator: rig.coordinator, coverStore: rig.coverStore)
        #expect(model.title == "Song")
        #expect(model.singleFeaturing == ["B"])
        #expect(!model.hasChanges)

        model.beginEditing()
        model.year = "2021"
        await model.save()

        let last = try #require(rig.tagWriter.calls.last).tags
        #expect(last.title == "Song (feat. B)")
        #expect(last.album == "Song (feat. B)")
        #expect(last.year == "2021")
        let saved = try #require(rig.library.all().first)
        #expect(saved.title == "Song (feat. B)")
        #expect(saved.tracks.first?.title == "Song (feat. B)")
        #expect(saved.year == "2021")
    }

    @Test func editingALegacySinglesTitleMakesTheReleaseTitlePlainAndTheTrackTitleJoined() async throws {
        let rig = Rig()
        let release = try await legacySingle(rig)
        let model = ReleaseDetailViewModel(release: release, coordinator: rig.coordinator, coverStore: rig.coverStore)

        model.title = "Tune"
        await model.save()

        let last = try #require(rig.tagWriter.calls.last).tags
        #expect(last.title == "Tune (feat. B)")
        #expect(last.album == "Tune")
        let saved = try #require(rig.library.all().first)
        #expect(saved.title == "Tune")
        #expect(saved.tracks.first?.title == "Tune (feat. B)")
    }

    // MARK: Single whose track title differs from the release title (a record from the Mac)

    private func macSingle(_ rig: Rig) async throws -> Release {
        let release = try await rig.coordinator.importSingle(file: try makeSourceFile(), tags: TagSet(title: "Album", artist: "A", album: "Album", year: "2020"), cover: nil)
        var mac = release
        mac.tracks[0].title = "Song (feat. B)"
        try rig.library.upsert(mac)
        return mac
    }

    @Test func addingAFeatureKeepsTheTracksOwnPlainTitle() async throws {
        let rig = Rig()
        let release = try await macSingle(rig)
        let model = ReleaseDetailViewModel(release: release, coordinator: rig.coordinator, coverStore: rig.coverStore)
        #expect(model.title == "Album")
        #expect(model.singleFeaturing == ["B"])

        model.beginEditing()
        model.singleFeaturing = ["B", "C"]
        await model.save()

        let saved = try #require(rig.library.all().first)
        #expect(saved.title == "Album")
        #expect(saved.tracks.first?.title == "Song (feat. B & C)")
        #expect(try #require(rig.tagWriter.calls.last).tags.title == "Song (feat. B & C)")
    }

    @Test func aYearOnlySaveLeavesBothTitlesOfThatSingleAlone() async throws {
        let rig = Rig()
        let release = try await macSingle(rig)
        let model = ReleaseDetailViewModel(release: release, coordinator: rig.coordinator, coverStore: rig.coverStore)

        model.beginEditing()
        model.year = "2021"
        await model.save()

        let saved = try #require(rig.library.all().first)
        #expect(saved.title == "Album")
        #expect(saved.tracks.first?.title == "Song (feat. B)")
        #expect(saved.year == "2021")
    }

    @Test func editingTheTitleOfThatSingleReplacesTheTracksPlainTitle() async throws {
        let rig = Rig()
        let release = try await macSingle(rig)
        let model = ReleaseDetailViewModel(release: release, coordinator: rig.coordinator, coverStore: rig.coverStore)

        model.title = "Tune"
        await model.save()

        let saved = try #require(rig.library.all().first)
        #expect(saved.title == "Tune")
        #expect(saved.tracks.first?.title == "Tune (feat. B)")
    }

    // MARK: The album tag of a single

    @Test func theAlbumTagIsTheSameAfterImportAndAfterAYearOnlySave() async throws {
        let rig = Rig()
        let url = try makeSourceFile()
        rig.importer.tagsByURL[url] = TagSet(title: "Song (feat. B)", artist: "A", album: "Song (feat. B)")
        let single = ImportSingleViewModel(importer: rig.importer, coordinator: rig.coordinator)
        await single.pick(url: url)
        await single.send()
        let imported = try #require(rig.tagWriter.calls.last).tags
        #expect(imported.album == "Song")

        let release = try #require(rig.library.all().first)
        let model = ReleaseDetailViewModel(release: release, coordinator: rig.coordinator, coverStore: rig.coverStore)
        model.beginEditing()
        model.year = "2021"
        await model.save()

        let saved = try #require(rig.tagWriter.calls.last).tags
        #expect(saved.album == imported.album)
        #expect(saved.title == imported.title)
    }

    @Test func aDifferentAlbumTypedOnImportIsKept() async throws {
        let rig = Rig()
        let url = try makeSourceFile()
        rig.importer.tagsByURL[url] = TagSet(title: "Song", artist: "A", album: "Greatest Hits")
        let single = ImportSingleViewModel(importer: rig.importer, coordinator: rig.coordinator)
        await single.pick(url: url)
        await single.send()

        #expect(try #require(rig.tagWriter.calls.last).tags.album == "Greatest Hits")
    }
}
