import Foundation
import Testing
@testable import Locally

/// `ReleaseCoordinator.syncHook` wiring: every user-initiated mutation
/// (import, update, delete) fires the hook exactly once, but every
/// sync-applied mutation (accepting from the Mac, applying a newer remote
/// update, applying a tombstone) never does — otherwise a change pulled from
/// the server would immediately be pushed straight back to it.
struct ReleaseCoordinatorSyncHookTests {
    private func makeSourceFile(named name: String = "song.mp3") throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try Data([0xFF, 0xFB, 1, 2, 3, 4]).write(to: url)
        return url
    }

    private func makeCoordinator() -> (ReleaseCoordinator, FakeSpotifyFolder, InMemoryLibraryStore, FakeReleaseSyncHook) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let folder = FakeSpotifyFolder(directory: dir)
        let library = InMemoryLibraryStore()
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: FakeTagWriter(),
            id3TagWriter: FakeTagWriter(),
            folder: folder,
            library: library,
            coverStore: FakeCoverStore()
        )
        let hook = FakeReleaseSyncHook()
        coordinator.syncHook = hook
        return (coordinator, folder, library, hook)
    }

    @Test func importSinglePushesTheNewRelease() async throws {
        let (coordinator, _, _, hook) = makeCoordinator()
        let tags = TagSet(title: "T", artist: "A", album: "Al")

        let release = try await coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)

        #expect(hook.pushedReleases.map(\.id) == [release.id])
    }

    @Test func importAlbumPushesTheNewRelease() async throws {
        let (coordinator, _, _, hook) = makeCoordinator()
        let album = AlbumDraft(title: "Al", artist: "A", tracks: [TrackDraft(title: "One")])

        let release = try await coordinator.importAlbum(files: [try makeSourceFile()], album: album, cover: nil)

        #expect(hook.pushedReleases.map(\.id) == [release.id])
    }

    @Test func updateReleasePushesTheUpdatedRelease() async throws {
        let (coordinator, _, _, hook) = makeCoordinator()
        let tags = TagSet(title: "T", artist: "A", album: "Al")
        let release = try await coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)
        hook.reset()

        _ = try await coordinator.updateRelease(release.id, changes: ReleaseChanges(title: "New Title"))

        #expect(hook.pushedReleases.map(\.id) == [release.id])
        #expect(hook.pushedReleases.first?.title == "New Title")
    }

    @Test func deleteReleasePushesATombstone() async throws {
        let (coordinator, _, _, hook) = makeCoordinator()
        let tags = TagSet(title: "T", artist: "A", album: "Al")
        let release = try await coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)

        try await coordinator.deleteRelease(release.id)

        #expect(hook.tombstonedIds == [release.id])
    }

    @Test func applyTombstoneDeletesLocallyWithoutPushingATombstoneBack() async throws {
        let (coordinator, _, _, hook) = makeCoordinator()
        let tags = TagSet(title: "T", artist: "A", album: "Al")
        let release = try await coordinator.importSingle(file: try makeSourceFile(), tags: tags, cover: nil)
        hook.reset()

        try await coordinator.applyTombstone(release.id)

        #expect(hook.tombstonedIds.isEmpty)
        #expect(hook.pushedReleases.isEmpty)
    }
}
