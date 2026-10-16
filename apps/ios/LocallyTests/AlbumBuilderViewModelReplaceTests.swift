import Foundation
import Testing
@testable import Locally

/// `AlbumBuilderViewModel.replaceRow(_:with:)`: a row's own replace swaps its file in place.
struct AlbumBuilderViewModelReplaceTests {
    private func makeAudioFile(named name: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try Data([0xFF, 0xFB, 1, 2, 3, 4]).write(to: url)
        return url
    }

    private func makeModel(importer: FakeFileImporter) -> AlbumBuilderViewModel {
        let folderDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let coordinator = ReleaseCoordinator(
            importer: importer,
            transcoder: FakeTranscoder(),
            m4aTagWriter: FakeTagWriter(),
            id3TagWriter: FakeTagWriter(),
            folder: FakeSpotifyFolder(directory: folderDir),
            library: InMemoryLibraryStore(),
            coverStore: FakeCoverStore()
        )
        return AlbumBuilderViewModel(importer: importer, coordinator: coordinator)
    }

    private func makeModelWithThreeRows(importer: FakeFileImporter) -> AlbumBuilderViewModel {
        let model = makeModel(importer: importer)
        model.rows = ["One", "Two", "Three"].enumerated().map { index, title in
            AlbumBuilderViewModel.TrackRow(
                url: URL(fileURLWithPath: "/gallery/\(title).mp3"),
                title: title,
                discNumber: index < 2 ? 1 : 2
            )
        }
        return model
    }

    @Test func replacingARowKeepsItsPositionAndDisc() async throws {
        let importer = FakeFileImporter()
        let model = makeModelWithThreeRows(importer: importer)
        let ids = model.rows.map(\.id)
        let newURL = try makeAudioFile(named: "fresh.mp3")

        await model.replaceRow(ids[1], with: newURL)

        #expect(model.rows.map(\.id) == ids)
        #expect(model.rows[1].discNumber == 1)
        #expect(model.rows[1].url.lastPathComponent == "fresh.mp3")
    }

    @Test func replacingARowTakesTheTitleFromTheNewFilesTags() async throws {
        let importer = FakeFileImporter()
        let model = makeModelWithThreeRows(importer: importer)
        let newURL = try makeAudioFile(named: "fresh.mp3")
        importer.tagsByURL[newURL] = TagSet(title: "Tagged Title", artist: "A", album: "Al")

        await model.replaceRow(model.rows[0].id, with: newURL)

        #expect(model.rows[0].title == "Tagged Title")
    }

    @Test func replacingARowFallsBackToTheFileNameWithoutTags() async throws {
        let model = makeModelWithThreeRows(importer: FakeFileImporter())
        let newURL = try makeAudioFile(named: "fresh.mp3")

        await model.replaceRow(model.rows[2].id, with: newURL)

        #expect(model.rows[2].title == "fresh")
    }

    @Test func replacingARowLeavesTheOthersUntouched() async throws {
        let model = makeModelWithThreeRows(importer: FakeFileImporter())
        let before = model.rows
        let newURL = try makeAudioFile(named: "fresh.mp3")

        await model.replaceRow(before[1].id, with: newURL)

        #expect(model.rows[0] == before[0])
        #expect(model.rows[2] == before[2])
    }

    @Test func replacingAnUnknownRowChangesNothing() async throws {
        let model = makeModelWithThreeRows(importer: FakeFileImporter())
        let before = model.rows

        await model.replaceRow(UUID(), with: try makeAudioFile(named: "fresh.mp3"))

        #expect(model.rows == before)
    }
}
