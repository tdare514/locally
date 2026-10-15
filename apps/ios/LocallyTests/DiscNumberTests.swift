import Foundation
import AVFoundation
import Testing
@testable import Locally

/// Disc numbers (#113): `trackNumber` stays the release-wide position, `discNumber` is optional,
/// and the number in each file's track tag is derived per disc.
struct DiscNumberingTests {
    private func numbers(_ discs: [Int?]) -> [DiscNumbering.TagNumbers] {
        DiscNumbering.tagNumbers(for: discs.enumerated().map { (trackNumber: $0.offset + 1, discNumber: $0.element) })
    }

    @Test func discsOneOneOneTwoTwoGiveOneOfThreeThroughTwoOfTwo() {
        let tags = numbers([1, 1, 1, 2, 2])

        #expect(tags.map { "\($0.trackNumber)/\($0.totalTracks)" } == ["1/3", "2/3", "3/3", "1/2", "2/2"])
        #expect(tags.map(\.discNumber) == [1, 1, 1, 2, 2])
        #expect(tags.map(\.totalDiscs) == [2, 2, 2, 2, 2])
    }

    @Test func withNoDiscsTheTagIsTheReleaseWideNumberOverTheCountAndHasNoDisc() {
        let tags = DiscNumbering.tagNumbers(for: [(1, nil), (2, nil), (4, nil)])

        #expect(tags == [
            DiscNumbering.TagNumbers(trackNumber: 1, totalTracks: 3, discNumber: nil, totalDiscs: nil),
            DiscNumbering.TagNumbers(trackNumber: 2, totalTracks: 3, discNumber: nil, totalDiscs: nil),
            DiscNumbering.TagNumbers(trackNumber: 4, totalTracks: 3, discNumber: nil, totalDiscs: nil),
        ])
    }

    @Test func ordersByTrackNumberWithinADiscWhateverOrderTheTracksAreGivenIn() {
        let tags = DiscNumbering.tagNumbers(for: [(4, 2), (2, 1), (3, 2), (1, 1)])

        #expect(tags.map { "\($0.discNumber!):\($0.trackNumber)/\($0.totalTracks)" } == ["2:2/2", "1:2/2", "2:1/2", "1:1/2"])
    }

    @Test func theDiscTotalIsTheHighestDiscAndATrackWithNoDiscCountsAsDiscOne() {
        let tags = DiscNumbering.tagNumbers(for: [(1, nil), (2, 1), (3, 3)])

        #expect(tags.map(\.totalDiscs) == [3, 3, 3])
        #expect(tags.map { "\($0.discNumber!):\($0.trackNumber)/\($0.totalTracks)" } == ["1:1/2", "1:2/2", "3:1/1"])
    }

    @Test func headingsGoAboveTheFirstRowOfEachDiscOnlyWhenThereIsMoreThanOne() {
        #expect(DiscNumbering.headings(for: [1, 1, 1, 2, 2]) == [1, nil, nil, 2, nil])
        #expect(DiscNumbering.headings(for: [1, 1, 1]) == [nil, nil, nil])
        #expect(DiscNumbering.headings(for: [nil, nil]) == [nil, nil])
        #expect(DiscNumbering.headings(for: [2, 2]) == [nil, nil])
        #expect(DiscNumbering.headings(for: [nil, 2, 1]) == [1, 2, 1])
        #expect(DiscNumbering.headings(for: []).isEmpty)
    }

    /// Moves the row at `from` to index `to`, then has it join the disc it now sits in.
    private func move(_ discs: [Int?], from: Int, to: Int) -> [Int?] {
        var moved = discs
        moved.insert(moved.remove(at: from), at: to)
        return DiscNumbering.adoptDiscAfterMove(moved, movedIndex: to)
    }

    @Test func aDiscTwoTrackMovedToTheTopTakesDiscOneThenTheLastDiscOneTrackMovedBelowTheDiscTwoHeadingTakesDiscTwo() {
        let first = move([1, 1, 2, 2], from: 2, to: 0)
        #expect(first == [1, 1, 1, 2])
        #expect(DiscNumbering.headings(for: first) == [1, nil, nil, 2])

        let second = move(first, from: 2, to: 3)
        #expect(second == [1, 1, 2, 2])
        #expect(DiscNumbering.headings(for: second) == [1, nil, 2, nil])
    }

    @Test func aRowTakesTheDiscBelowItWhenItIsNowFirstAndAReleaseWithoutDiscsIsUntouched() {
        #expect(move([1, 2, 3], from: 2, to: 0) == [1, 1, 2])
        #expect(move([nil, nil, nil], from: 2, to: 0) == [nil, nil, nil])
        #expect(DiscNumbering.adoptDiscAfterMove([1, 2], movedIndex: 5) == [1, 2])
    }

    @Test func aNeighbourWithNoDiscCountsAsDiscOne() {
        #expect(move([nil, 2, 2], from: 2, to: 1) == [nil, 1, 2])
    }

    @Test func headingsNeverRepeatWhateverSequenceOfMovesIsMade() {
        var discs: [Int?] = [1, 1, 2, 2, 3]
        for (from, to) in [(4, 0), (0, 3), (2, 4), (3, 1), (1, 0), (4, 2)] {
            discs = move(discs, from: from, to: to)
            let shown = DiscNumbering.headings(for: discs).compactMap { $0 }
            #expect(Set(shown).count == shown.count)
        }
    }

    private struct File { var name: String; var disc: Int?; var track: Int? }

    private func order(_ files: [File]) -> [String] {
        DiscNumbering.ordered(files, disc: \.disc, trackTag: \.track).map(\.name)
    }

    @Test func importOrdersByDiscThenTheFilesOwnTrackNumberKeepingTiesInInputOrder() {
        #expect(order([
            File(name: "d2t1", disc: 2, track: 1),
            File(name: "d1t2", disc: 1, track: 2),
            File(name: "d1t1", disc: 1, track: 1),
            File(name: "d2t2", disc: 2, track: 2),
        ]) == ["d1t1", "d1t2", "d2t1", "d2t2"])

        #expect(order([
            File(name: "a", disc: 1, track: nil),
            File(name: "b", disc: 1, track: 1),
            File(name: "c", disc: 1, track: nil),
        ]) == ["b", "a", "c"])
    }

    @Test func importLeavesTheOrderAloneWhenNoFileHasADiscTag() {
        #expect(order([File(name: "x", disc: nil, track: 2), File(name: "y", disc: nil, track: 1)]) == ["x", "y"])
    }

    @Test func parsesTrackAndDiscPairsFromId3TextAndItunesData() {
        #expect(DiscNumbering.parsePair("2/3")?.number == 2)
        #expect(DiscNumbering.parsePair("2/3")?.total == 3)
        #expect(DiscNumbering.parsePair(" 2 ")?.total == nil)
        #expect(DiscNumbering.parsePair("x/3") == nil)

        let pair = DiscNumbering.parseITunesPair(Data([0, 0, 0, 2, 0, 3, 0, 0]))
        #expect(pair?.number == 2)
        #expect(pair?.total == 3)
        #expect(DiscNumbering.parseITunesPair(Data([0, 0, 0, 2])) == nil)
    }

    @Test func discNumbersAreOneThroughNinetyNine() {
        #expect([1, 2, 99].allSatisfy(DiscNumbering.isValidDisc))
        #expect(![0, 100, -1].contains(where: DiscNumbering.isValidDisc))
    }
}

struct DiscTagRoundTripTests {
    /// Ten silent MPEG-1 Layer III frames (128 kbps, 44.1 kHz, 417 bytes each): enough for
    /// AVFoundation to recognise the file, so the tags can be read back through the production reader.
    private func silentMp3() -> Data {
        var frame = [UInt8](repeating: 0, count: 417)
        frame.replaceSubrange(0..<4, with: [0xFF, 0xFB, 0x90, 0x64])
        return Data((0..<10).flatMap { _ in frame })
    }

    private func makeMp3() throws -> (dir: URL, url: URL) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("track.mp3")
        try silentMp3().write(to: url)
        return (dir, url)
    }

    private func makeTinyM4A() throws -> (dir: URL, url: URL) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("song.m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44100.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64000
        ]
        let file = try AVAudioFile(forWriting: url, settings: settings)
        let buffer = try #require(AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 4410))
        buffer.frameLength = buffer.frameCapacity
        try file.write(from: buffer)
        return (dir, url)
    }

    private func frames(in data: Data) -> [String: String] {
        let bytes = [UInt8](data)
        let headerEnd = 10 + ID3TagWriter.desynchsafe(Array(bytes[6...9]))
        var out: [String: String] = [:]
        var offset = 10
        while offset + 10 <= headerEnd {
            let id = String(bytes: bytes[offset..<(offset + 4)], encoding: .ascii) ?? ""
            let size = ID3TagWriter.desynchsafe(Array(bytes[(offset + 4)..<(offset + 8)]))
            let start = offset + 10
            guard start + size <= headerEnd else { break }
            out[id] = String(data: data.subdata(in: (start + 1)..<(start + size)), encoding: .utf8)
            offset = start + size
        }
        return out
    }

    private func readBack(_ url: URL) async throws -> TagSet {
        let staged = try await LocalFileImporter().stage([url])
        return try #require(staged.first?.existingTags)
    }

    @Test func mp3WritesTposAndPerDiscTrckAndReadsThemBack() async throws {
        let (dir, url) = try makeMp3()
        defer { try? FileManager.default.removeItem(at: dir) }
        let tags = TagSet(title: "Reprise", artist: "A", album: "Double", trackNumber: 1, totalTracks: 2, discNumber: 2, totalDiscs: 2)

        try await ID3TagWriter().write(tags, cover: nil, to: url)

        let written = frames(in: try Data(contentsOf: url))
        #expect(written["TRCK"] == "1/2")
        #expect(written["TPOS"] == "2/2")

        let read = try await readBack(url)
        #expect(read.discNumber == 2)
        #expect(read.totalDiscs == 2)
        #expect(read.trackNumber == 1)
        #expect(read.totalTracks == 2)
    }

    @Test func mp3WithNoDiscWritesNoTposAndReadsBackNoDisc() async throws {
        let (dir, url) = try makeMp3()
        defer { try? FileManager.default.removeItem(at: dir) }
        let tags = TagSet(title: "T", artist: "A", album: "Al", trackNumber: 3, totalTracks: 10)

        try await ID3TagWriter().write(tags, cover: nil, to: url)

        let written = frames(in: try Data(contentsOf: url))
        #expect(written["TRCK"] == "3/10")
        #expect(written["TPOS"] == nil)

        let read = try await readBack(url)
        #expect(read.discNumber == nil)
        #expect(read.trackNumber == 3)
    }

    @Test func m4aWritesDiskNextToTrknAndReadsThemBack() async throws {
        let (dir, url) = try makeTinyM4A()
        defer { try? FileManager.default.removeItem(at: dir) }
        let tags = TagSet(title: "Reprise", artist: "A", album: "Double", trackNumber: 1, totalTracks: 2, discNumber: 2, totalDiscs: 2)

        try await M4ATagWriter().write(tags, cover: nil, to: url)

        let read = try await readBack(url)
        #expect(read.discNumber == 2)
        #expect(read.totalDiscs == 2)
        #expect(read.trackNumber == 1)
        #expect(read.totalTracks == 2)
    }

    @Test func m4aWithNoDiscWritesNoDisk() async throws {
        let (dir, url) = try makeTinyM4A()
        defer { try? FileManager.default.removeItem(at: dir) }
        let tags = TagSet(title: "T", artist: "A", album: "Al", trackNumber: 3, totalTracks: 10)

        try await M4ATagWriter().write(tags, cover: nil, to: url)

        let read = try await readBack(url)
        #expect(read.discNumber == nil)
        #expect(read.trackNumber == 3)
        #expect(read.totalTracks == 10)
    }
}

struct DiscSyncRecordTests {
    private func track(disc: Int?) -> SyncTrack {
        SyncTrack(id: "t1", title: "T", trackNumber: 1, discNumber: disc, file: "t.mp3", bytes: 1)
    }

    private func json(_ track: SyncTrack) throws -> String {
        String(decoding: try JSONEncoder.syncApi.encode(track), as: UTF8.self)
    }

    @Test func encodesDiscNumberWhenSetAndOmitsTheKeyWhenNot() throws {
        #expect(try json(track(disc: 2)).contains("\"discNumber\":2"))
        #expect(!(try json(track(disc: nil)).contains("discNumber")))
    }

    @Test func decodesAMissingDiscNumberAsNilAndOneThroughNinetyNineAsGiven() throws {
        func decode(_ disc: String) throws -> SyncTrack {
            let body = "{\"id\":\"t\",\"title\":\"T\",\"trackNumber\":1,\(disc)\"file\":\"t.mp3\",\"bytes\":1,\"durationSec\":null}"
            return try JSONDecoder.syncApi.decode(SyncTrack.self, from: Data(body.utf8))
        }
        #expect(try decode("").discNumber == nil)
        #expect(try decode("\"discNumber\":1,").discNumber == 1)
        #expect(try decode("\"discNumber\":99,").discNumber == 99)
    }

    @Test(arguments: ["0", "100", "-1", "1.5"])
    func refusesADiscNumberOutsideOneThroughNinetyNine(value: String) {
        let body = "{\"id\":\"t\",\"title\":\"T\",\"trackNumber\":1,\"discNumber\":\(value),\"file\":\"t.mp3\",\"bytes\":1,\"durationSec\":null}"
        #expect(throws: DecodingError.self) {
            _ = try JSONDecoder.syncApi.decode(SyncTrack.self, from: Data(body.utf8))
        }
    }

    @Test func discNumberRoundTripsBetweenTrackAndSyncTrack() {
        let release = Release(
            kind: .album,
            title: "Double",
            artist: "A",
            folderPath: "/tmp/spotify",
            tracks: [
                Track(title: "One", trackNumber: 1, discNumber: 1, filePath: "/tmp/spotify/a - 01 - One.mp3", originalName: "one.mp3"),
                Track(title: "Two", trackNumber: 2, discNumber: 2, filePath: "/tmp/spotify/a - 02 - Two.mp3", originalName: "two.mp3"),
                Track(title: "Plain", trackNumber: 3, filePath: "/tmp/spotify/a - 03 - Plain.mp3", originalName: "plain.mp3"),
            ]
        )

        let record = release.toSyncRecord(origin: "ios", originDevice: "phone", fileBytes: [:])
        #expect(record.tracks.map(\.discNumber) == [1, 2, nil])
        #expect(record.tracks.map(\.trackNumber) == [1, 2, 3])
        #expect(record.toRelease().tracks.map(\.discNumber) == [1, 2, nil])
    }

    @Test func aTrackFromOlderLibraryDataWithNoDiscNumberKeyStillDecodes() throws {
        let body = """
        {"id":"0E984725-C51C-4BF4-9960-E1C80E27ABA0","title":"T","trackNumber":1,"filePath":"/x/t.mp3","originalName":"t.mp3"}
        """
        let decoded = try JSONDecoder().decode(Track.self, from: Data(body.utf8))
        #expect(decoded.discNumber == nil)
    }

    @Test func theSharedMultiDiscFixtureDecodesWithItsDiscNumbers() throws {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { url.deleteLastPathComponent() }
        url = url.appendingPathComponent("spec/fixtures/sync/valid-album-with-discs.json")
        let record = try JSONDecoder.syncApi.decode(SyncRecord.self, from: Data(contentsOf: url))

        #expect(record.tracks.map(\.discNumber) == [1, 1, 2])
        #expect(record.tracks.map(\.trackNumber) == [1, 2, 3])
    }
}

struct DiscCoordinatorTests {
    private func makeSourceFile(named name: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try Data([0xFF, 0xFB, 1, 2, 3, 4]).write(to: url)
        return url
    }

    private func makeCoordinator(tagWriter: FakeTagWriter, library: InMemoryLibraryStore = InMemoryLibraryStore()) -> ReleaseCoordinator {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        return ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: FakeSpotifyFolder(directory: dir),
            library: library,
            coverStore: FakeCoverStore()
        )
    }

    private func importTwoDiscAlbum(_ coordinator: ReleaseCoordinator) async throws -> Release {
        let files = try ["a.mp3", "b.mp3", "c.mp3"].map(makeSourceFile(named:))
        let album = AlbumDraft(
            title: "Double",
            artist: "Band",
            tracks: [
                TrackDraft(title: "A", discNumber: 1),
                TrackDraft(title: "B", discNumber: 1),
                TrackDraft(title: "C", discNumber: 2),
            ]
        )
        return try await coordinator.importAlbum(files: files, album: album, cover: nil)
    }

    @Test func importKeepsTrackNumberAndFileNamesReleaseWideAndTagsPerDisc() async throws {
        let tagWriter = FakeTagWriter()
        let release = try await importTwoDiscAlbum(makeCoordinator(tagWriter: tagWriter))

        #expect(release.tracks.map(\.trackNumber) == [1, 2, 3])
        #expect(release.tracks.map(\.discNumber) == [1, 1, 2])
        let names = release.tracks.map { ($0.filePath as NSString).lastPathComponent }
        let expected = (1...3).map { n in
            ReleaseLayout().fileName(artist: "Band", album: "Double", trackNumber: n, title: ["A", "B", "C"][n - 1], ext: "mp3")
        }
        #expect(names == expected)

        #expect(tagWriter.calls.map(\.tags.trackNumber) == [1, 2, 1])
        #expect(tagWriter.calls.map(\.tags.totalTracks) == [2, 2, 1])
        #expect(tagWriter.calls.map(\.tags.discNumber) == [1, 1, 2])
        #expect(tagWriter.calls.map(\.tags.totalDiscs) == [2, 2, 2])
    }

    @Test func importWithNoDiscsWritesTheReleaseWideNumberAndNoDisc() async throws {
        let tagWriter = FakeTagWriter()
        let coordinator = makeCoordinator(tagWriter: tagWriter)
        let files = try ["a.mp3", "b.mp3"].map(makeSourceFile(named:))
        let album = AlbumDraft(title: "Plain", artist: "Band", tracks: [TrackDraft(title: "A"), TrackDraft(title: "B")])

        let release = try await coordinator.importAlbum(files: files, album: album, cover: nil)

        #expect(tagWriter.calls.map(\.tags.trackNumber) == [1, 2])
        #expect(tagWriter.calls.map(\.tags.totalTracks) == [2, 2])
        #expect(tagWriter.calls.allSatisfy { $0.tags.discNumber == nil && $0.tags.totalDiscs == nil })
        #expect(release.tracks.allSatisfy { $0.discNumber == nil })
    }

    @Test func updateKeepsDiscsAndRederivesTheTagsFromTheNewOrder() async throws {
        let tagWriter = FakeTagWriter()
        let coordinator = makeCoordinator(tagWriter: tagWriter)
        let release = try await importTwoDiscAlbum(coordinator)
        let before = tagWriter.calls.count

        let updated = try await coordinator.updateRelease(
            release.id,
            changes: ReleaseChanges(trackOrder: [release.tracks[1].id, release.tracks[0].id, release.tracks[2].id])
        )

        #expect(updated.tracks.map(\.discNumber) == [1, 1, 2])
        let calls = tagWriter.calls.suffix(from: before)
        #expect(calls.map(\.tags.trackNumber) == [1, 2, 1])
        #expect(calls.map(\.tags.discNumber) == [1, 1, 2])
    }

    @Test func applyRemoteUpdateTakesTheRecordsDiscsAndClearsThemWhenTheRecordHasNone() async throws {
        let tagWriter = FakeTagWriter()
        let coordinator = makeCoordinator(tagWriter: tagWriter)
        let release = try await importTwoDiscAlbum(coordinator)

        func record(discs: [Int?]) -> SyncRecord {
            SyncRecord(
                id: release.id.uuidString,
                kind: "album",
                title: release.title,
                artist: release.artist,
                tracks: release.tracks.enumerated().map { index, track in
                    SyncTrack(id: track.id.uuidString, title: track.title, trackNumber: track.trackNumber, discNumber: discs[index], file: track.originalName, bytes: 0)
                },
                origin: "mac",
                originDevice: "Mac",
                createdAt: release.createdAt,
                updatedAt: release.updatedAt.addingTimeInterval(60)
            )
        }

        var before = tagWriter.calls.count
        let regrouped = try await coordinator.applyRemoteUpdate(record(discs: [1, 2, 2]))
        #expect(regrouped.tracks.map(\.discNumber) == [1, 2, 2])
        #expect(tagWriter.calls.suffix(from: before).map(\.tags.trackNumber) == [1, 1, 2])
        #expect(tagWriter.calls.suffix(from: before).map(\.tags.discNumber) == [1, 2, 2])

        before = tagWriter.calls.count
        let cleared = try await coordinator.applyRemoteUpdate(record(discs: [nil, nil, nil]))
        #expect(cleared.tracks.allSatisfy { $0.discNumber == nil })
        #expect(tagWriter.calls.suffix(from: before).map(\.tags.trackNumber) == [1, 2, 3])
        #expect(tagWriter.calls.suffix(from: before).allSatisfy { $0.tags.discNumber == nil })
    }
}

@MainActor
struct DiscAlbumBuilderTests {
    private func makeAudioFile(named name: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try Data([0xFF, 0xFB, 1, 2, 3, 4]).write(to: url)
        return url
    }

    private func makeModel(importer: FakeFileImporter, tagWriter: FakeTagWriter = FakeTagWriter()) -> AlbumBuilderViewModel {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let coordinator = ReleaseCoordinator(
            importer: importer,
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: FakeSpotifyFolder(directory: dir),
            library: InMemoryLibraryStore(),
            coverStore: FakeCoverStore()
        )
        return AlbumBuilderViewModel(importer: importer, coordinator: coordinator)
    }

    @Test func pickedFilesWithDiscTagsAreOrderedByDiscThenTrackAndCarryTheirDiscs() async throws {
        let urls = try ["d2t1.mp3", "d1t2.mp3", "d1t1.mp3"].map(makeAudioFile(named:))
        let importer = FakeFileImporter()
        importer.tagsByURL[urls[0]] = TagSet(title: "D2T1", artist: "A", album: "Al", trackNumber: 1, discNumber: 2, totalDiscs: 2)
        importer.tagsByURL[urls[1]] = TagSet(title: "D1T2", artist: "A", album: "Al", trackNumber: 2, discNumber: 1, totalDiscs: 2)
        importer.tagsByURL[urls[2]] = TagSet(title: "D1T1", artist: "A", album: "Al", trackNumber: 1, discNumber: 1, totalDiscs: 2)
        let model = makeModel(importer: importer)

        await model.addFiles(urls)

        #expect(model.rows.map(\.title) == ["D1T1", "D1T2", "D2T1"])
        #expect(model.rows.map(\.discNumber) == [1, 1, 2])
        #expect(model.discHeadings == [1, nil, 2])
    }

    @Test func pickedFilesWithoutDiscTagsKeepTheOrderTheyWerePickedInAndShowNoHeadings() async throws {
        let urls = try ["b.mp3", "a.mp3"].map(makeAudioFile(named:))
        let importer = FakeFileImporter()
        importer.tagsByURL[urls[0]] = TagSet(title: "B", artist: "A", album: "Al", trackNumber: 2)
        importer.tagsByURL[urls[1]] = TagSet(title: "A", artist: "A", album: "Al", trackNumber: 1)
        let model = makeModel(importer: importer)

        await model.addFiles(urls)

        #expect(model.rows.map(\.title) == ["B", "A"])
        #expect(model.discHeadings == [nil, nil])
    }

    @Test func aLaterBatchIsOrderedAmongItselfAndLeavesEarlierRowsWhereTheyAre() async throws {
        let first = try makeAudioFile(named: "first.mp3")
        let laterTwo = try makeAudioFile(named: "later2.mp3")
        let laterOne = try makeAudioFile(named: "later1.mp3")
        let importer = FakeFileImporter()
        importer.tagsByURL[first] = TagSet(title: "First", artist: "A", album: "Al", trackNumber: 1, discNumber: 2, totalDiscs: 2)
        importer.tagsByURL[laterTwo] = TagSet(title: "Later2", artist: "A", album: "Al", trackNumber: 2, discNumber: 1, totalDiscs: 2)
        importer.tagsByURL[laterOne] = TagSet(title: "Later1", artist: "A", album: "Al", trackNumber: 1, discNumber: 1, totalDiscs: 2)
        let model = makeModel(importer: importer)

        await model.addFiles([first])
        await model.addFiles([laterTwo, laterOne])

        #expect(model.rows.map(\.title) == ["First", "Later1", "Later2"])
    }

    @Test func sendHandsTheDiscsToTheImportSoTagsGoPerDisc() async throws {
        let urls = try ["d1.mp3", "d2.mp3"].map(makeAudioFile(named:))
        let importer = FakeFileImporter()
        importer.tagsByURL[urls[0]] = TagSet(title: "One", artist: "A", album: "Al", trackNumber: 1, discNumber: 1, totalDiscs: 2)
        importer.tagsByURL[urls[1]] = TagSet(title: "Two", artist: "A", album: "Al", trackNumber: 1, discNumber: 2, totalDiscs: 2)
        let tagWriter = FakeTagWriter()
        let model = makeModel(importer: importer, tagWriter: tagWriter)
        await model.addFiles(urls)
        model.albumTitle = "Double"
        model.artist = "A"

        await model.send()

        let release = try #require(model.completedRelease)
        #expect(release.tracks.map(\.trackNumber) == [1, 2])
        #expect(release.tracks.map(\.discNumber) == [1, 2])
        #expect(tagWriter.calls.map(\.tags.trackNumber) == [1, 1])
        #expect(tagWriter.calls.map(\.tags.discNumber) == [1, 2])
        #expect(tagWriter.calls.map(\.tags.totalDiscs) == [2, 2])
    }

    @Test func theReleasePageGroupsRowsUnderDiscHeadingsOnlyWhenThereAreSeveralDiscs() throws {
        func headings(_ discs: [Int?]) throws -> [Int?] {
            let release = Release(
                kind: .album,
                title: "T",
                artist: "A",
                folderPath: "/tmp/spotify",
                tracks: discs.enumerated().map { index, disc in
                    Track(title: "T\(index)", trackNumber: index + 1, discNumber: disc, filePath: "/tmp/spotify/\(index).mp3", originalName: "\(index).mp3")
                }
            )
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            let tagWriter = FakeTagWriter()
            let coordinator = ReleaseCoordinator(
                importer: FakeFileImporter(),
                transcoder: FakeTranscoder(),
                m4aTagWriter: tagWriter,
                id3TagWriter: tagWriter,
                folder: FakeSpotifyFolder(directory: dir),
                library: InMemoryLibraryStore(),
                coverStore: FakeCoverStore()
            )
            return ReleaseDetailViewModel(release: release, coordinator: coordinator, coverStore: FakeCoverStore()).discHeadings
        }

        #expect(try headings([1, 1, 2]) == [1, nil, 2])
        #expect(try headings([1, 1, 1]) == [nil, nil, nil])
        #expect(try headings([nil, nil]) == [nil, nil])
    }

    private func rows(_ discs: [Int?]) -> [AlbumBuilderViewModel.TrackRow] {
        discs.enumerated().map { index, disc in
            AlbumBuilderViewModel.TrackRow(url: URL(fileURLWithPath: "/tmp/\(index).mp3"), title: "T\(index + 1)", discNumber: disc)
        }
    }

    @Test func movingARowInTheAlbumBuilderJoinsItToTheDiscItLandsIn() {
        let model = makeModel(importer: FakeFileImporter())
        model.rows = rows([1, 1, 2, 2])

        model.moveRows(from: IndexSet(integer: 2), to: 0)
        #expect(model.rows.map(\.title) == ["T3", "T1", "T2", "T4"])
        #expect(model.rows.map(\.discNumber) == [1, 1, 1, 2])

        model.moveRows(from: IndexSet(integer: 2), to: 4)
        #expect(model.rows.map(\.title) == ["T3", "T1", "T4", "T2"])
        #expect(model.rows.map(\.discNumber) == [1, 1, 2, 2])
        #expect(model.discHeadings == [1, nil, 2, nil])
    }

    @Test func aDropThatChangesNothingLeavesTheDiscsAlone() {
        let model = makeModel(importer: FakeFileImporter())
        model.rows = rows([1, 1, 2, 2])

        model.moveRows(from: IndexSet(integer: 2), to: 2)
        model.moveRows(from: IndexSet(integer: 2), to: 3)

        #expect(model.rows.map(\.title) == ["T1", "T2", "T3", "T4"])
        #expect(model.rows.map(\.discNumber) == [1, 1, 2, 2])
    }

    @Test func movingARowOnTheReleasePageSavesTheDiscItJoinedAndRetagsPerDisc() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let tagWriter = FakeTagWriter()
        let library = InMemoryLibraryStore()
        let coverStore = FakeCoverStore()
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: FakeSpotifyFolder(directory: dir),
            library: library,
            coverStore: coverStore
        )
        let files = try ["a.mp3", "b.mp3", "c.mp3"].map(makeAudioFile(named:))
        let album = AlbumDraft(
            title: "Double",
            artist: "Band",
            tracks: [TrackDraft(title: "A", discNumber: 1), TrackDraft(title: "B", discNumber: 1), TrackDraft(title: "C", discNumber: 2)]
        )
        let release = try await coordinator.importAlbum(files: files, album: album, cover: nil)
        let model = ReleaseDetailViewModel(release: release, coordinator: coordinator, coverStore: coverStore)
        #expect(model.discHeadings == [1, nil, 2])

        model.moveTracks(from: IndexSet(integer: 2), to: 0)
        #expect(model.trackRows.map(\.title) == ["C", "A", "B"])
        #expect(model.trackRows.map(\.discNumber) == [1, 1, 1])
        #expect(model.hasChanges)
        #expect(model.discHeadings == [nil, nil, nil])

        let before = tagWriter.calls.count
        await model.save()

        let stored = try #require(library.all().first)
        #expect(stored.tracks.map(\.title) == ["C", "A", "B"])
        #expect(stored.tracks.map(\.trackNumber) == [1, 2, 3])
        #expect(stored.tracks.map(\.discNumber) == [1, 1, 1])
        let calls = tagWriter.calls.suffix(from: before)
        #expect(calls.map(\.tags.trackNumber) == [1, 2, 3])
        #expect(calls.map(\.tags.totalDiscs) == [1, 1, 1])
    }
}
