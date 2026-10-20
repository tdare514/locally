import Foundation
import Testing
@testable import Locally

/// The detail screen's "Title" is the only title a single has, so saving it
/// must reach the track tag Spotify displays, not just the album tag.
@MainActor
struct ReleaseDetailViewModelTests {
    private func makeSourceFile() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("song.mp3")
        try Data([0xFF, 0xFB, 1, 2, 3, 4]).write(to: url)
        return url
    }

    @Test func editingASinglesTitleRewritesTheTrackTitleTag() async throws {
        let folderDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let folder = FakeSpotifyFolder(directory: folderDir)
        let library = InMemoryLibraryStore()
        let tagWriter = FakeTagWriter()
        let coverStore = FakeCoverStore()
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: folder,
            library: library,
            coverStore: coverStore,
            durationReader: FakeDurationReader()
        )
        let tags = TagSet(title: "Old Name", artist: "Artist", album: "Old Name", trackNumber: 1, totalTracks: 1)
        let release = try await coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)

        let model = ReleaseDetailViewModel(release: release, coordinator: coordinator, coverStore: coverStore)
        model.title = "New Name"
        await model.save()

        let last = try #require(tagWriter.calls.last)
        #expect(last.tags.title == "New Name")
        #expect(last.tags.album == "New Name")
        #expect(try library.all().first?.tracks.first?.title == "New Name")
    }

    @Test func aSuccessfulSaveBumpsSaveCount() async throws {
        let folderDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let tagWriter = FakeTagWriter()
        let coverStore = FakeCoverStore()
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: FakeSpotifyFolder(directory: folderDir),
            library: InMemoryLibraryStore(),
            coverStore: coverStore,
            durationReader: FakeDurationReader()
        )
        let tags = TagSet(title: "Old Name", artist: "Artist", album: "Old Name", trackNumber: 1, totalTracks: 1)
        let release = try await coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)

        let model = ReleaseDetailViewModel(release: release, coordinator: coordinator, coverStore: coverStore)
        #expect(model.saveCount == 0)
        model.title = "New Name"
        await model.save()

        #expect(model.saveCount == 1)
    }
}

@MainActor
struct ReleaseEditModeTests {
    private func makeCoordinator(_ coverStore: FakeCoverStore) -> ReleaseCoordinator {
        let tagWriter = FakeTagWriter()
        return ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: FakeSpotifyFolder(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)),
            library: InMemoryLibraryStore(),
            coverStore: coverStore,
            durationReader: FakeDurationReader()
        )
    }

    private func makeFile(_ name: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try Data([0xFF, 0xFB, 1, 2, 3, 4]).write(to: url)
        return url
    }

    private func makeAlbumModel() async throws -> ReleaseDetailViewModel {
        let coverStore = FakeCoverStore()
        let coordinator = makeCoordinator(coverStore)
        let album = AlbumDraft(title: "Album", artist: "Band", date: ReleaseDate(year: 2020), tracks: [TrackDraft(title: "A"), TrackDraft(title: "B")])
        let release = try await coordinator.importAlbum(files: [try makeFile("a.mp3"), try makeFile("b.mp3")], album: album, cover: nil)
        return ReleaseDetailViewModel(release: release, coordinator: coordinator, coverStore: coverStore)
    }

    @Test func opensInViewModeAndBeginEditingTurnsEditOn() async throws {
        let model = try await makeAlbumModel()
        #expect(!model.isEditing)
        model.beginEditing()
        #expect(model.isEditing)
    }

    @Test func changesListsExactlyWhatChanged() async throws {
        let model = try await makeAlbumModel()
        #expect(model.changes.isEmpty)

        model.title = "Album 2"
        model.genre = "Rock"
        model.coverData = Data([1, 2, 3])
        let renamedId = model.trackRows[0].id
        model.trackRows[0].title = "A2"
        model.moveTracks(from: IndexSet(integer: 1), to: 0)

        #expect(model.changes == [
            .field(label: Copy.Import.fieldTitle, old: "Album", new: "Album 2"),
            .field(label: Copy.Import.fieldGenre, old: "", new: "Rock"),
            .cover(old: nil, new: Data([1, 2, 3])),
            .trackRenamed(id: renamedId, old: "A", new: "A2"),
            .trackOrder
        ])
    }

    @Test func sameTitledTracksRenamedToTheSameTitleGiveDistinctChanges() async throws {
        let coverStore = FakeCoverStore()
        let coordinator = makeCoordinator(coverStore)
        let album = AlbumDraft(title: "Album", artist: "Band", date: ReleaseDate(year: 2020), tracks: [TrackDraft(title: "Same"), TrackDraft(title: "Same")])
        let release = try await coordinator.importAlbum(files: [try makeFile("a.mp3"), try makeFile("b.mp3")], album: album, cover: nil)
        let model = ReleaseDetailViewModel(release: release, coordinator: coordinator, coverStore: coverStore)

        model.trackRows[0].title = "New"
        model.trackRows[1].title = "New"

        #expect(model.changes.count == 2)
        #expect(Set(model.changes.map(\.id)).count == 2)
    }

    @Test func discardChangesRestoresTheOriginalsAndLeavesEditMode() async throws {
        let model = try await makeAlbumModel()
        model.beginEditing()
        model.title = "Changed"
        model.artist = "Someone"
        model.releaseDateText = "1999"
        model.coverData = Data([9])
        model.trackRows[1].title = "Z"
        model.moveTracks(from: IndexSet(integer: 1), to: 0)

        model.discardChanges()

        #expect(model.title == "Album")
        #expect(model.artist == "Band")
        #expect(model.releaseDateText == "2020")
        #expect(model.coverData == nil)
        #expect(model.trackRows.map(\.title) == ["A", "B"])
        #expect(!model.hasChanges)
        #expect(!model.isEditing)
    }

    @Test func aSuccessfulSaveLeavesEditMode() async throws {
        let model = try await makeAlbumModel()
        model.beginEditing()
        model.title = "New title"
        await model.save()
        #expect(model.saveCount == 1)
        #expect(!model.isEditing)
        #expect(model.changes.isEmpty)
    }

    // MARK: Release date (#221)

    private func makeDateModel(year: String?, releaseDate: String? = nil) async throws -> (ReleaseDetailViewModel, FakeTagWriter, InMemoryLibraryStore) {
        let coverStore = FakeCoverStore()
        let tagWriter = FakeTagWriter()
        let library = InMemoryLibraryStore()
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: FakeSpotifyFolder(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)),
            library: library,
            coverStore: coverStore,
            durationReader: FakeDurationReader()
        )
        let album = AlbumDraft(title: "Album", artist: "Band", date: ReleaseDate(year: 2020), tracks: [TrackDraft(title: "A")])
        var release = try await coordinator.importAlbum(files: [try makeFile("a.mp3")], album: album, cover: nil)
        release.year = year
        release.releaseDate = releaseDate
        let model = ReleaseDetailViewModel(release: release, coordinator: coordinator, coverStore: coverStore)
        model.locale = Locale(identifier: "en_GB")
        return (model, tagWriter, library)
    }

    @Test func anUnchangedLegacyYearNeverBlocksSavingOtherFields() async throws {
        let (model, _, _) = try await makeDateModel(year: "soon")
        #expect(model.releaseDateText == "soon")
        model.beginEditing()
        model.title = "Renamed"
        #expect(model.releaseDateMessage == nil)
        #expect(model.canSave)
        #expect(!model.changes.contains { if case .field(let label, _, _) = $0 { label == Copy.DateField.label } else { false } })
    }

    @Test func aChangedUnreadableOrImpossibleDateBlocksSaving() async throws {
        let (model, _, _) = try await makeDateModel(year: "2020")
        model.beginEditing()
        model.releaseDateText = "31/02/2024"
        #expect(model.releaseDateMessage == Copy.DateField.impossible)
        #expect(model.hasChanges)
        #expect(!model.canSave)
        model.releaseDateText = "soon"
        #expect(model.releaseDateMessage == Copy.DateField.unreadable)
        #expect(!model.canSave)
    }

    @Test func typingADateSavesIt() async throws {
        let (model, tagWriter, library) = try await makeDateModel(year: "2020")
        model.beginEditing()
        model.releaseDateText = "17/05/2024"
        #expect(model.canSave)
        #expect(model.changes == [.field(label: Copy.DateField.label, old: "2020", new: ReleaseDate(year: 2024, month: 5, day: 17)!.formatted())])
        await model.save()
        let expected = ReleaseDate(year: 2024, month: 5, day: 17)
        #expect(tagWriter.calls.last?.tags.date == expected)
        #expect(try library.all().first?.date == expected)
    }

    @Test func clearingTheDateClearsIt() async throws {
        let (model, tagWriter, library) = try await makeDateModel(year: "2020")
        model.beginEditing()
        model.releaseDateText = ""
        #expect(model.canSave)
        await model.save()
        #expect(tagWriter.calls.last?.tags.date == nil)
        #expect(try library.all().first?.date == nil)
    }

    @Test func retypingTheSameDateAnotherWayIsNoChange() async throws {
        let (model, _, _) = try await makeDateModel(year: "2024", releaseDate: "2024-05-17")
        model.beginEditing()
        model.releaseDateText = "2024-05-17"
        #expect(!model.hasChanges)
    }
}

@MainActor
struct ImportReleaseDateTests {
    @Test func aSingleCannotSendOnAnImpossibleOrUnreadableDate() {
        let model = ImportSingleViewModel(importer: FakeFileImporter(), coordinator: ImportReleaseDateTests.coordinator())
        model.pickedURL = URL(fileURLWithPath: "/tmp/a.mp3")
        model.title = "Song"
        model.artist = "Artist"
        #expect(model.canSend)
        model.releaseDateText = "2023-02-29"
        #expect(model.releaseDateMessage == Copy.DateField.impossible)
        #expect(!model.canSend)
        model.releaseDateText = "soon"
        #expect(!model.canSend)
        model.releaseDateText = "2023-02-28"
        #expect(model.canSend)
        #expect(model.tagSet().date == ReleaseDate(year: 2023, month: 2, day: 28))
    }

    @Test func anAlbumCannotSendOnAnImpossibleDate() {
        let model = AlbumBuilderViewModel(importer: FakeFileImporter(), coordinator: ImportReleaseDateTests.coordinator())
        model.rows = [AlbumBuilderViewModel.TrackRow(url: URL(fileURLWithPath: "/tmp/a.mp3"), title: "A")]
        model.albumTitle = "Album"
        model.artist = "Artist"
        #expect(model.canSend)
        model.releaseDateText = "2024-13"
        #expect(!model.canSend)
        model.releaseDateText = "2024-12"
        #expect(model.canSend)
    }

    private static func coordinator() -> ReleaseCoordinator {
        let tagWriter = FakeTagWriter()
        return ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: FakeSpotifyFolder(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)),
            library: InMemoryLibraryStore(),
            coverStore: FakeCoverStore(),
            durationReader: FakeDurationReader()
        )
    }
}
