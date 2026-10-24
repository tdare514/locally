import Foundation
import Testing
@testable import Locally

struct BrandFolderTests {
    private func makeFolder() -> FakeSpotifyFolder {
        FakeSpotifyFolder(directory: FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true))
    }

    private func makeCoordinator(folder: FakeSpotifyFolder, library: LibraryStore) -> ReleaseCoordinator {
        let tagWriter = FakeTagWriter()
        return ReleaseCoordinator(
            importer: FakeFileImporter(), transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter, id3TagWriter: tagWriter,
            folder: folder, library: library, coverStore: FakeCoverStore(),
            durationReader: FakeDurationReader()
        )
    }

    private func makeDefaults() -> UserDefaults {
        let suite = "BrandFolderTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return defaults
    }

    private func sourceFile(named name: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try Data([0xFF, 0xFB, 1, 2, 3, 4]).write(to: url)
        return url
    }

    /// A Locally-owned release whose files sit at the folder's top level, as before #335.
    private func seedLegacy(_ names: [String], in folder: FakeSpotifyFolder, library: InMemoryLibraryStore) throws -> Release {
        let tracks = try names.enumerated().map { index, name -> Track in
            let url = folder.directory.appendingPathComponent(name)
            try Data([1, 2, 3]).write(to: url)
            return Track(title: name, trackNumber: index + 1, filePath: url.path, originalName: name)
        }
        let release = Release(kind: .album, title: "Old", artist: "A", folderPath: folder.directory.path, tracks: tracks)
        try library.upsert(release)
        return release
    }

    private func brandDir(_ folder: FakeSpotifyFolder) -> URL {
        folder.directory.appendingPathComponent(Brand.folderName, isDirectory: true)
    }

    @Test func newImportWritesIntoTheBrandFolder() async throws {
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        let coordinator = makeCoordinator(folder: folder, library: library)
        let release = try await coordinator.importSingle(
            file: try sourceFile(named: "a.mp3"), tags: TagSet(title: "T", artist: "A", album: "B"), cover: nil)
        let path = release.tracks[0].filePath
        #expect(URL(fileURLWithPath: path).deletingLastPathComponent().lastPathComponent == Brand.folderName)
        #expect(FileManager.default.fileExists(atPath: path))
        let top = try FileManager.default.contentsOfDirectory(atPath: folder.directory.path)
        #expect(top == [Brand.folderName])
    }

    @Test func resolutionFollowsTheStoredStructureAndNeverCrossesFolders() throws {
        let folder = makeFolder()
        try FileManager.default.createDirectory(at: brandDir(folder), withIntermediateDirectories: true)
        let legacy = Track(title: "T", trackNumber: 1, filePath: "/gone/x.mp3", originalName: "x.mp3")
        let branded = Track(title: "T", trackNumber: 1, filePath: "/gone/\(Brand.folderName)/x (2).mp3", originalName: "x.mp3")
        // Only the other place has a file: neither track may resolve to it.
        try Data([1]).write(to: brandDir(folder).appendingPathComponent("x.mp3"))
        try Data([1]).write(to: folder.directory.appendingPathComponent("x (2).mp3"))
        #expect(ReleaseCoordinator.resolvedFileURL(for: legacy, in: folder.directory).path
            == folder.directory.appendingPathComponent("x.mp3").path)
        #expect(ReleaseCoordinator.resolvedFileURL(for: branded, in: folder.directory).path
            == brandDir(folder).appendingPathComponent("x (2).mp3").path)
    }

    @Test func deletingAReleaseWhoseFileIsGoneLeavesAnotherReleasesFileAlone() async throws {
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        try FileManager.default.createDirectory(at: brandDir(folder), withIntermediateDirectories: true)
        let owned = brandDir(folder).appendingPathComponent("same.mp3")
        try Data([5]).write(to: owned)
        let a = Release(kind: .single, title: "A", artist: "A", folderPath: folder.directory.path,
                        tracks: [Track(title: "A", trackNumber: 1, filePath: folder.directory.appendingPathComponent("same.mp3").path, originalName: "same.mp3")])
        let b = Release(kind: .single, title: "B", artist: "B", folderPath: brandDir(folder).path,
                        tracks: [Track(title: "B", trackNumber: 1, filePath: owned.path, originalName: "same.mp3")])
        try library.upsert(a)
        try library.upsert(b)
        let coordinator = makeCoordinator(folder: folder, library: library)
        try await coordinator.deleteRelease(a.id)
        #expect(FileManager.default.fileExists(atPath: owned.path))
        #expect(try library.all().map(\.id) == [b.id])
    }

    @Test func migrationMovesOnlyTrackedTopLevelFiles() async throws {
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        let defaults = makeDefaults()
        let release = try seedLegacy(["one.mp3", "two.mp3"], in: folder, library: library)
        try Data([9]).write(to: folder.directory.appendingPathComponent("untracked.mp3"))
        let synced = folder.directory.appendingPathComponent("Synced files", isDirectory: true)
        try FileManager.default.createDirectory(at: synced, withIntermediateDirectories: true)
        try Data([9]).write(to: synced.appendingPathComponent("s.mp3"))
        let adopted = Release(kind: .single, title: "Ad", artist: "A", folderPath: "",
                              tracks: [Track(title: "Ad", trackNumber: 1, filePath: "ad.mp3", originalName: "ad.mp3")], source: .adopted)
        try library.upsert(adopted)
        try Data([9]).write(to: folder.directory.appendingPathComponent("ad.mp3"))

        let coordinator = makeCoordinator(folder: folder, library: library)
        let moved = await coordinator.migrateIntoBrandFolder(defaults: defaults)

        #expect(moved == 2)
        let stored = try #require(try library.all().first { $0.id == release.id })
        for track in stored.tracks {
            #expect(URL(fileURLWithPath: track.filePath).deletingLastPathComponent().lastPathComponent == Brand.folderName)
            #expect(FileManager.default.fileExists(atPath: track.filePath))
        }
        #expect(FileManager.default.fileExists(atPath: folder.directory.appendingPathComponent("untracked.mp3").path))
        #expect(FileManager.default.fileExists(atPath: folder.directory.appendingPathComponent("ad.mp3").path))
        #expect(FileManager.default.fileExists(atPath: synced.appendingPathComponent("s.mp3").path))
        #expect(!FileManager.default.fileExists(atPath: folder.directory.appendingPathComponent("one.mp3").path))
        #expect(defaults.bool(forKey: ReleaseCoordinator.brandFolderMigrationKey))
    }

    @Test func secondRunMovesNothing() async throws {
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        let defaults = makeDefaults()
        _ = try seedLegacy(["one.mp3"], in: folder, library: library)
        let coordinator = makeCoordinator(folder: folder, library: library)
        #expect(await coordinator.migrateIntoBrandFolder(defaults: defaults) == 1)
        #expect(await coordinator.migrateIntoBrandFolder(defaults: defaults) == nil)
        // Even with the flag cleared, a migrated library has nothing left to move.
        defaults.removeObject(forKey: ReleaseCoordinator.brandFolderMigrationKey)
        #expect(await coordinator.migrateIntoBrandFolder(defaults: defaults) == 0)
    }

    @Test func interruptedRunResumesFromTheJournalIncludingACollisionSuffix() async throws {
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        let defaults = makeDefaults()
        let release = try seedLegacy(["one.mp3", "two.mp3"], in: folder, library: library)
        // A stranger already sits at Locally/one.mp3, so the move of "one" went to "one (2).mp3".
        try FileManager.default.createDirectory(at: brandDir(folder), withIntermediateDirectories: true)
        try Data([7]).write(to: brandDir(folder).appendingPathComponent("one.mp3"))
        // The run journaled and moved it, then died before saving the index.
        defaults.set([release.tracks[0].id.uuidString: "\(Brand.folderName)/one (2).mp3"],
                     forKey: ReleaseCoordinator.brandFolderMigrationJournalKey)
        try FileManager.default.moveItem(at: folder.directory.appendingPathComponent("one.mp3"),
                                         to: brandDir(folder).appendingPathComponent("one (2).mp3"))
        let coordinator = makeCoordinator(folder: folder, library: library)
        _ = await coordinator.migrateIntoBrandFolder(defaults: defaults)
        let stored = try #require(try library.all().first { $0.id == release.id })
        #expect(stored.tracks[0].filePath.hasSuffix("/\(Brand.folderName)/one (2).mp3"))
        #expect(stored.tracks[1].filePath.contains("/\(Brand.folderName)/two"))
        for track in stored.tracks { #expect(FileManager.default.fileExists(atPath: track.filePath)) }
        #expect(try Data(contentsOf: brandDir(folder).appendingPathComponent("one.mp3")) == Data([7]))
        #expect(defaults.bool(forKey: ReleaseCoordinator.brandFolderMigrationKey))
        #expect(defaults.dictionary(forKey: ReleaseCoordinator.brandFolderMigrationJournalKey) == nil)
    }

    @Test func nameCollisionGetsAUniqueSuffix() async throws {
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        let defaults = makeDefaults()
        let release = try seedLegacy(["one.mp3"], in: folder, library: library)
        try FileManager.default.createDirectory(at: brandDir(folder), withIntermediateDirectories: true)
        try Data([7]).write(to: brandDir(folder).appendingPathComponent("one.mp3"))
        // The tracked file is the top-level one (its stored path exists), so the brand copy is a stranger.
        let coordinator = makeCoordinator(folder: folder, library: library)
        _ = await coordinator.migrateIntoBrandFolder(defaults: defaults)
        let stored = try #require(try library.all().first { $0.id == release.id })
        #expect(stored.tracks[0].filePath.hasSuffix("/\(Brand.folderName)/one (2).mp3"))
        #expect(try Data(contentsOf: brandDir(folder).appendingPathComponent("one.mp3")) == Data([7]))
        #expect(FileManager.default.fileExists(atPath: stored.tracks[0].filePath))
    }

    @Test func completionFlagIsNotSetWhileAReleaseFailsOrFolderIsDisconnected() async throws {
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        let defaults = makeDefaults()
        _ = try seedLegacy(["one.mp3"], in: folder, library: library)
        let coordinator = makeCoordinator(folder: folder, library: library)
        folder.disconnect()
        #expect(await coordinator.migrateIntoBrandFolder(defaults: defaults) == nil)
        #expect(!defaults.bool(forKey: ReleaseCoordinator.brandFolderMigrationKey))
        // A failing move (a plain file squats on the brand folder's name) leaves it unset too.
        try folder.connect(url: folder.directory)
        try Data([1]).write(to: brandDir(folder))
        #expect(await coordinator.migrateIntoBrandFolder(defaults: defaults) == nil)
        #expect(!defaults.bool(forKey: ReleaseCoordinator.brandFolderMigrationKey))
        try FileManager.default.removeItem(at: brandDir(folder))
        #expect(await coordinator.migrateIntoBrandFolder(defaults: defaults) == 1)
        #expect(defaults.bool(forKey: ReleaseCoordinator.brandFolderMigrationKey))
    }

    @Test func resumeDoesNotClaimAFileAnotherReleaseOwns() async throws {
        let folder = makeFolder()
        let library = InMemoryLibraryStore()
        let defaults = makeDefaults()
        try FileManager.default.createDirectory(at: brandDir(folder), withIntermediateDirectories: true)
        let owned = brandDir(folder).appendingPathComponent("same.mp3")
        try Data([5]).write(to: owned)
        // A: its file was deleted by the user (stored path gone). B owns Locally/same.mp3.
        let a = Release(kind: .single, title: "A", artist: "A", folderPath: folder.directory.path,
                        tracks: [Track(title: "A", trackNumber: 1, filePath: folder.directory.appendingPathComponent("same.mp3").path, originalName: "same.mp3")])
        let b = Release(kind: .single, title: "B", artist: "B", folderPath: brandDir(folder).path,
                        tracks: [Track(title: "B", trackNumber: 1, filePath: owned.path, originalName: "same.mp3")])
        try library.upsert(a)
        try library.upsert(b)
        let coordinator = makeCoordinator(folder: folder, library: library)
        let moved = await coordinator.migrateIntoBrandFolder(defaults: defaults)
        #expect(moved == 0)
        let storedA = try #require(try library.all().first { $0.id == a.id })
        let storedB = try #require(try library.all().first { $0.id == b.id })
        #expect(storedA.tracks[0].filePath == a.tracks[0].filePath)
        #expect(storedB.tracks[0].filePath == owned.path)
        #expect(defaults.bool(forKey: ReleaseCoordinator.brandFolderMigrationKey))
    }
}
