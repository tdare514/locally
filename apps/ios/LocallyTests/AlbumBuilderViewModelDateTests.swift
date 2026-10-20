import Foundation
import Testing
@testable import Locally

/// Adding files to the album builder keeps the date the files carry (#221).
struct AlbumBuilderViewModelDateTests {
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
            coverStore: FakeCoverStore(),
            durationReader: FakeDurationReader()
        )
        return AlbumBuilderViewModel(importer: importer, coordinator: coordinator)
    }

    @Test func tracksTaggedWithADateFillTheEmptyDateAndSendKeepsIt() async throws {
        let importer = FakeFileImporter()
        let model = makeModel(importer: importer)
        let may17 = ReleaseDate(year: 2024, month: 5, day: 17)
        var urls: [URL] = []
        for name in ["one.mp3", "two.mp3"] {
            let url = try makeAudioFile(named: name)
            importer.tagsByURL[url] = TagSet(title: name, artist: "A", album: "Al", date: may17)
            urls.append(url)
        }

        await model.addFiles(urls)
        #expect(model.releaseDateText == may17?.formatted())

        model.albumTitle = "Al"
        model.artist = "A"
        await model.send()
        let release = try #require(model.completedRelease)
        #expect(release.date == may17)
    }

    @Test func typedDateTextIsNotOverwrittenByALaterAdd() async throws {
        let importer = FakeFileImporter()
        let model = makeModel(importer: importer)
        let url = try makeAudioFile(named: "one.mp3")
        importer.tagsByURL[url] = TagSet(title: "One", artist: "A", album: "Al", date: ReleaseDate(year: 2024, month: 5, day: 17))

        model.releaseDateText = "2019"
        await model.addFiles([url])

        #expect(model.releaseDateText == "2019")
    }

    @Test func theFirstTrackWithADateFillsTheField() async throws {
        let importer = FakeFileImporter()
        let model = makeModel(importer: importer)
        let may17 = ReleaseDate(year: 2024, month: 5, day: 17)
        let undated = try makeAudioFile(named: "one.mp3")
        let dated = try makeAudioFile(named: "two.mp3")
        importer.tagsByURL[undated] = TagSet(title: "one", artist: "A", album: "Al")
        importer.tagsByURL[dated] = TagSet(title: "two", artist: "A", album: "Al", date: may17)

        await model.addFiles([undated, dated])
        #expect(model.releaseDateText == may17?.formatted())
    }

    @Test func aClearedDateStaysClearedWhenMoreDatedTracksAreAdded() async throws {
        let importer = FakeFileImporter()
        let model = makeModel(importer: importer)
        let may17 = ReleaseDate(year: 2024, month: 5, day: 17)
        let first = try makeAudioFile(named: "one.mp3")
        let second = try makeAudioFile(named: "two.mp3")
        importer.tagsByURL[first] = TagSet(title: "one", artist: "A", album: "Al", date: may17)
        importer.tagsByURL[second] = TagSet(title: "two", artist: "A", album: "Al", date: may17)

        await model.addFiles([first])
        #expect(model.releaseDateText == may17?.formatted())
        model.releaseDateText = ""
        await model.addFiles([second])
        #expect(model.releaseDateText.isEmpty)

        model.albumTitle = "Al"
        model.artist = "A"
        await model.send()
        let release = try #require(model.completedRelease)
        #expect(release.date == nil)
    }
}
