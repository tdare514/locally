import Foundation
import AVFoundation
import Testing
@testable import Locally

struct M4ATagWriterTests {
    let writer = M4ATagWriter()

    /// A tiny (0.1s, silent, mono) real m4a file, built directly with
    /// `AVAudioFile` rather than an `AVAssetExportSession` pass — cheap and
    /// synchronous, unlike transcoding a source asset.
    private func makeTinyM4A() throws -> (dir: URL, url: URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("M4ATagWriterTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("song.m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44100.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64000
        ]
        let file = try AVAudioFile(forWriting: url, settings: settings)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 4410) else {
            throw LocallyError.transcodeFailed("Couldn't allocate a test audio buffer.")
        }
        buffer.frameLength = buffer.frameCapacity
        try file.write(from: buffer)
        return (dir, url)
    }

    private func fileNames(in dir: URL) throws -> [String] {
        try FileManager.default.contentsOfDirectory(atPath: dir.path).sorted()
    }

    private func readBackTitleAndArtist(_ url: URL) async throws -> (title: String?, artist: String?) {
        let asset = AVAsset(url: url)
        var title: String?
        var artist: String?
        let formats = try await asset.load(.availableMetadataFormats)
        for format in formats {
            let items = try await asset.loadMetadata(for: format)
            for item in items {
                guard let key = item.commonKey else { continue }
                let value = try? await item.load(.stringValue)
                switch key {
                case .commonKeyTitle: title = value ?? title
                case .commonKeyArtist: artist = value ?? artist
                default: break
                }
            }
        }
        return (title, artist)
    }

    @Test func writesTagsIntoAFreshFile() async throws {
        let (dir, url) = try makeTinyM4A()
        defer { try? FileManager.default.removeItem(at: dir) }
        let tags = TagSet(title: "First Title", artist: "First Artist", album: "Album", trackNumber: 1, totalTracks: 1)

        try await writer.write(tags, cover: nil, to: url)

        let (title, artist) = try await readBackTitleAndArtist(url)
        #expect(title == "First Title")
        #expect(artist == "First Artist")
    }

    /// The whole point of re-tagging in place: writing a second, different
    /// set of tags onto a file that already carries metadata must replace
    /// it, not error out or leave the first set behind.
    @Test func retagsAFileThatAlreadyHasMetadata() async throws {
        let (dir, url) = try makeTinyM4A()
        defer { try? FileManager.default.removeItem(at: dir) }

        let firstTags = TagSet(title: "First Title", artist: "First Artist", album: "First Album", trackNumber: 1, totalTracks: 2, year: "2020", genre: "Rock")
        try await writer.write(firstTags, cover: nil, to: url)

        let secondTags = TagSet(title: "Second Title", artist: "Second Artist", album: "Second Album", trackNumber: 2, totalTracks: 2, year: "2021", genre: "Pop")
        try await writer.write(secondTags, cover: nil, to: url)

        let (title, artist) = try await readBackTitleAndArtist(url)
        #expect(title == "Second Title")
        #expect(artist == "Second Artist")
    }

    @Test func successfulWriteLeavesOnlyTheTaggedFile() async throws {
        let (dir, url) = try makeTinyM4A()
        defer { try? FileManager.default.removeItem(at: dir) }
        let tags = TagSet(title: "First Title", artist: "First Artist", album: "Album", trackNumber: 1, totalTracks: 1)

        try await writer.write(tags, cover: nil, to: url)

        #expect(try fileNames(in: dir) == ["song.m4a"])
        let (title, _) = try await readBackTitleAndArtist(url)
        #expect(title == "First Title")
    }

    @Test func failedReplaceThrowsTaggingFailedAndLeavesTheOriginalUntouched() async throws {
        let (dir, url) = try makeTinyM4A()
        defer { try? FileManager.default.removeItem(at: dir) }
        let before = try Data(contentsOf: url)
        let tags = TagSet(title: "First Title", artist: "First Artist", album: "Album", trackNumber: 1, totalTracks: 1)
        let writer = M4ATagWriter(replaceItem: { _, _ in throw CocoaError(.fileWriteNoPermission) })

        do {
            try await writer.write(tags, cover: nil, to: url)
            Issue.record("write must throw when the replace fails")
        } catch let error as LocallyError {
            guard case .taggingFailed = error else {
                Issue.record("expected .taggingFailed, got \(error)")
                return
            }
        }

        #expect(try Data(contentsOf: url) == before)
        #expect(try fileNames(in: dir) == ["song.m4a"])
    }

    @Test func unreadableInputThrowsAndLeavesNoTempFile() async throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("M4ATagWriterTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("garbage.m4a")
        try Data("not audio".utf8).write(to: url)
        let tags = TagSet(title: "First Title", artist: "First Artist", album: "Album", trackNumber: 1, totalTracks: 1)

        await #expect(throws: LocallyError.self) {
            try await writer.write(tags, cover: nil, to: url)
        }

        #expect(try fileNames(in: dir) == ["garbage.m4a"])
    }
}
