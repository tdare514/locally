import Foundation
import Testing
@testable import Locally

struct LocalFileImporterTests {
    private func makeTempDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("LocalFileImporterTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func makeSourceFile(named name: String, in dir: URL, bytes: [UInt8] = [0xFF, 0xFB, 1, 2, 3, 4]) throws -> URL {
        let url = dir.appendingPathComponent(name)
        try Data(bytes).write(to: url)
        return url
    }

    @Test func stagesEachFileIntoItsOwnFreshTempDirectory() async throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let source = try makeSourceFile(named: "song.mp3", in: dir)
        let importer = LocalFileImporter()

        let staged = try await importer.stage([source])

        #expect(staged.count == 1)
        let file = try #require(staged.first)
        #expect(file.originalName == "song.mp3")
        #expect(file.url != source, "must be copied, not aliased to the source URL")
        #expect(FileManager.default.fileExists(atPath: file.url.path))
        #expect(try Data(contentsOf: file.url) == Data(contentsOf: source))
        // The source file must be left in place, untouched.
        #expect(FileManager.default.fileExists(atPath: source.path))
    }

    @Test func stagingMultipleFilesGivesEachItsOwnDestinationDirectory() async throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let a = try makeSourceFile(named: "a.mp3", in: dir)
        let b = try makeSourceFile(named: "b.mp3", in: dir)
        let importer = LocalFileImporter()

        let staged = try await importer.stage([a, b])

        #expect(staged.count == 2)
        let destinationDirs = Set(staged.map { $0.url.deletingLastPathComponent() })
        #expect(destinationDirs.count == 2, "each staged file gets its own tmp subdirectory")
    }

    @Test func stagingPreservesTheOriginalFileNameEvenWithUnusualCharacters() async throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let name = "My Song #1 (Remix).mp3"
        let source = try makeSourceFile(named: name, in: dir)
        let importer = LocalFileImporter()

        let staged = try await importer.stage([source])

        let file = try #require(staged.first)
        #expect(file.originalName == name)
        #expect(file.url.lastPathComponent == name)
    }

    @Test func stagedFileStaysInsideTheAppsOwnTempDirectory() async throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let source = try makeSourceFile(named: "song.mp3", in: dir)
        let importer = LocalFileImporter()

        let staged = try await importer.stage([source])

        let file = try #require(staged.first)
        let tmpRoot = FileManager.default.temporaryDirectory.standardizedFileURL.path
        #expect(file.url.standardizedFileURL.path.hasPrefix(tmpRoot))
    }

    @Test func stagingAMissingSourceFileThrowsImportFailedRatherThanCrashing() async throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let missing = dir.appendingPathComponent("does-not-exist.mp3")
        let importer = LocalFileImporter()

        await #expect(throws: LocallyError.self) {
            _ = try await importer.stage([missing])
        }
    }

    @Test func stagingAnUnreadableTagFormatStillStagesTheFileWithFallbackTags() async throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        // Not a real mp3/m4a — AVAsset metadata reading will fail, but
        // staging (copy) itself doesn't depend on the file being valid audio,
        // matching the "unsupported/garbage content" case FileImporter must
        // survive rather than throw on.
        let source = try makeSourceFile(named: "unsupported.txt", in: dir, bytes: Array("not audio".utf8))
        let importer = LocalFileImporter()

        let staged = try await importer.stage([source])

        let file = try #require(staged.first)
        #expect(FileManager.default.fileExists(atPath: file.url.path))
        // No embedded metadata could be read, so tags fall back to the
        // filename-derived title rather than throwing.
        #expect(file.existingTags?.title == "unsupported")
    }
}
