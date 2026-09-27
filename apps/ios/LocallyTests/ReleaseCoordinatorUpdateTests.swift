import Foundation
import Testing
@testable import Locally

struct ReleaseCoordinatorUpdateTests {
    private func makeSourceFile(named name: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try Data([0xFF, 0xFB, 1, 2, 3, 4]).write(to: url)
        return url
    }

    private func makeFolder() -> FakeSpotifyFolder {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        return FakeSpotifyFolder(directory: dir)
    }

    /// Builds a coordinator over shared fakes and imports a two-track album
    /// through it, so `updateRelease` has real files at real recorded paths
    /// to re-tag, exactly like the coordinator's own import would leave.
    private func makeImportedAlbum() async throws -> (
        coordinator: ReleaseCoordinator,
        folder: FakeSpotifyFolder,
        library: InMemoryLibraryStore,
        tagWriter: FakeTagWriter,
        release: Release
    ) {
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        let tagWriter = FakeTagWriter()
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: folder,
            library: library,
            coverStore: FakeCoverStore()
        )

        let files = try [makeSourceFile(named: "one.mp3"), makeSourceFile(named: "two.mp3")]
        let album = AlbumDraft(
            title: "Original Album",
            artist: "Original Artist",
            year: "2020",
            genre: "Rock",
            tracks: [TrackDraft(title: "Track One"), TrackDraft(title: "Track Two")]
        )
        let release = try await coordinator.importAlbum(files: files, album: album, cover: nil)
        return (coordinator, folder, library, tagWriter, release)
    }

    @Test func updateRewritesTagsForEveryTrackAndKeepsFileNames() async throws {
        let (coordinator, _, library, tagWriter, release) = try await makeImportedAlbum()
        let originalPaths = Set(release.tracks.map(\.filePath))
        let callsBeforeUpdate = tagWriter.calls.count

        let changes = ReleaseChanges(title: "New Album Title")
        let updated = try await coordinator.updateRelease(release.id, changes: changes)

        #expect(updated.title == "New Album Title")
        #expect(Set(updated.tracks.map(\.filePath)) == originalPaths)

        let updateCalls = tagWriter.calls.suffix(from: callsBeforeUpdate)
        #expect(updateCalls.count == 2)
        for call in updateCalls {
            #expect(call.tags.album == "New Album Title")
        }

        let stored = try library.all().first { $0.id == release.id }
        #expect(stored?.title == "New Album Title")
    }

    @Test func reorderChangesTrackNumbersInTagsAndStore() async throws {
        let (coordinator, _, library, tagWriter, release) = try await makeImportedAlbum()
        let trackOne = release.tracks[0]
        let trackTwo = release.tracks[1]
        let callsBeforeUpdate = tagWriter.calls.count

        let changes = ReleaseChanges(trackOrder: [trackTwo.id, trackOne.id])
        let updated = try await coordinator.updateRelease(release.id, changes: changes)

        #expect(updated.tracks.map(\.id) == [trackTwo.id, trackOne.id])
        #expect(updated.tracks.map(\.trackNumber) == [1, 2])

        let updateCalls = Array(tagWriter.calls.suffix(from: callsBeforeUpdate))
        #expect(updateCalls.count == 2)
        // Track two's file is re-tagged first (now position 1), track one's second.
        #expect(updateCalls[0].url.path == trackTwo.filePath)
        #expect(updateCalls[0].tags.trackNumber == 1)
        #expect(updateCalls[1].url.path == trackOne.filePath)
        #expect(updateCalls[1].tags.trackNumber == 2)

        let stored = try library.all().first { $0.id == release.id }
        #expect(stored?.tracks.map(\.id) == [trackTwo.id, trackOne.id])
    }

    @Test func trackTitleChangesAreAppliedToTheRightTrack() async throws {
        let (coordinator, _, _, tagWriter, release) = try await makeImportedAlbum()
        let trackOne = release.tracks[0]
        let callsBeforeUpdate = tagWriter.calls.count

        let changes = ReleaseChanges(trackTitles: [trackOne.id: "Renamed Track"])
        let updated = try await coordinator.updateRelease(release.id, changes: changes)

        #expect(updated.tracks.first { $0.id == trackOne.id }?.title == "Renamed Track")

        let updateCalls = tagWriter.calls.suffix(from: callsBeforeUpdate)
        let renamedCall = updateCalls.first { $0.url.path == trackOne.filePath }
        #expect(renamedCall?.tags.title == "Renamed Track")
    }

    @Test func missingFileThrowsFileMissing() async throws {
        let (coordinator, folder, _, _, release) = try await makeImportedAlbum()
        let trackOne = release.tracks[0]
        try FileManager.default.removeItem(atPath: trackOne.filePath)
        _ = folder // silence unused-binding warning if the compiler flags it

        let changes = ReleaseChanges(title: "Doesn't matter")

        await #expect(throws: LocallyError.self) {
            _ = try await coordinator.updateRelease(release.id, changes: changes)
        }
    }
}
