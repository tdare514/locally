import Foundation
import Testing
@testable import Locally

/// A reader whose reads stay suspended until the test finishes them, so reads can overlap.
@MainActor
private final class SuspendedDurationReader: TrackDurationReading {
    private var waiting: [URL: CheckedContinuation<Double?, Never>] = [:]

    nonisolated func duration(of url: URL) async -> Double? {
        await withCheckedContinuation { continuation in
            Task { @MainActor in self.waiting[url] = continuation }
        }
    }

    func isWaiting(_ url: URL) -> Bool { waiting[url] != nil }

    func finish(_ url: URL, with seconds: Double?) {
        waiting.removeValue(forKey: url)?.resume(returning: seconds)
    }
}

struct ReleaseCoordinatorDurationTests {
    private func makeSourceFile(named name: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try Data([0xFF, 0xFB, 1, 2, 3, 4]).write(to: url)
        return url
    }

    private func makeCoordinator(reader: FakeDurationReader) -> ReleaseCoordinator {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let tagWriter = FakeTagWriter()
        return ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: FakeSpotifyFolder(directory: dir),
            library: InMemoryLibraryStore(),
            coverStore: FakeCoverStore(),
            durationReader: reader
        )
    }

    private let tags = TagSet(title: "T", artist: "A", album: "B", trackNumber: 1, totalTracks: 1)

    @Test func singleImportStoresTheReadDuration() async throws {
        let coordinator = makeCoordinator(reader: FakeDurationReader(fixed: 215.5))
        let release = try await coordinator.importSingle(file: makeSourceFile(named: "a.mp3"), tags: tags, cover: nil)
        #expect(release.tracks.first?.durationSec == 215.5)
    }

    @Test func singleImportStoresNilWhenTheDurationCannotBeRead() async throws {
        let coordinator = makeCoordinator(reader: FakeDurationReader(fixed: nil))
        let release = try await coordinator.importSingle(file: makeSourceFile(named: "a.mp3"), tags: tags, cover: nil)
        #expect(release.tracks.first?.durationSec == nil)
    }

    @Test func albumImportStoresTheReadDurationOnEveryTrack() async throws {
        let coordinator = makeCoordinator(reader: FakeDurationReader(fixed: 90))
        let files = try [makeSourceFile(named: "one.mp3"), makeSourceFile(named: "two.mp3")]
        let album = AlbumDraft(title: "B", artist: "A", year: "2026", genre: "Rock", tracks: [TrackDraft(title: "One"), TrackDraft(title: "Two")])
        let release = try await coordinator.importAlbum(files: files, album: album, cover: nil)
        #expect(release.tracks.map(\.durationSec) == [90, 90])
    }

    @Test func albumImportStoresNilWhenTheDurationCannotBeRead() async throws {
        let coordinator = makeCoordinator(reader: FakeDurationReader(fixed: nil))
        let files = try [makeSourceFile(named: "one.mp3")]
        let album = AlbumDraft(title: "B", artist: "A", year: "2026", genre: "Rock", tracks: [TrackDraft(title: "One")])
        let release = try await coordinator.importAlbum(files: files, album: album, cover: nil)
        #expect(release.tracks.map(\.durationSec) == [nil])
    }
}

@MainActor
struct TrackLengthStateTests {
    private let urlA = URL(fileURLWithPath: "/tmp/length-a.mp3")
    private let urlB = URL(fileURLWithPath: "/tmp/length-b.mp3")

    private func settle(until condition: () -> Bool) async {
        for _ in 0..<200 where !condition() { await Task.yield() }
    }

    @Test func anOlderReadFinishingLastNeverReplacesTheNewFilesLength() async {
        let reader = SuspendedDurationReader()
        let state = TrackLengthState()

        let readA = Task { await state.load(url: urlA, reader: reader) }
        await settle { reader.isWaiting(urlA) }
        // The file is replaced: SwiftUI cancels the old task and starts one for the new URL.
        readA.cancel()
        let readB = Task { await state.load(url: urlB, reader: reader) }
        await settle { reader.isWaiting(urlB) }

        reader.finish(urlB, with: 200)
        await readB.value
        reader.finish(urlA, with: 100)
        await readA.value

        #expect(state.seconds(for: urlB) == 200)
        #expect(state.seconds(for: urlA) == nil)
    }

    @Test func aLengthReadForAnotherURLIsNotShown() async {
        let state = TrackLengthState()
        await state.load(url: urlA, reader: FakeDurationReader(fixed: 42))
        #expect(state.seconds(for: urlA) == 42)
        #expect(state.seconds(for: urlB) == nil)
    }
}
