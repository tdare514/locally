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
    @Test func rewritingWithNoDiscRemovesTheDiskAtomAWriteLeft() async throws {
        let (dir, url) = try makeTinyM4A()
        defer { try? FileManager.default.removeItem(at: dir) }

        func discItems() async throws -> Int {
            let asset = AVAsset(url: url)
            var count = 0
            for format in try await asset.load(.availableMetadataFormats) {
                for item in try await asset.loadMetadata(for: format) where item.identifier == .iTunesMetadataDiscNumber {
                    count += 1
                }
            }
            return count
        }

        var withDisc = TagSet(title: "T", artist: "A", album: "B", trackNumber: 1, totalTracks: 2)
        withDisc.discNumber = 2
        withDisc.totalDiscs = 2
        try await writer.write(withDisc, cover: nil, to: url)
        #expect(try await discItems() == 1)

        try await writer.write(TagSet(title: "T", artist: "A", album: "B", trackNumber: 3, totalTracks: 4), cover: nil, to: url)
        #expect(try await discItems() == 0)
    }

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
        var seen: (original: URL, replacement: URL, replacementExisted: Bool)?
        let writer = M4ATagWriter(replaceItem: { original, replacement in
            seen = (original, replacement, FileManager.default.fileExists(atPath: replacement.path))
            throw CocoaError(.fileWriteNoPermission)
        })

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
        // A temp file was really created, next to the target, with a non-audio name.
        #expect(seen?.original == url)
        #expect(seen?.replacement.pathExtension == "tmp")
        #expect(seen?.replacement.deletingLastPathComponent().standardizedFileURL == dir.standardizedFileURL)
        #expect(seen?.replacementExisted == true)
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

    // MARK: - Tags Locally doesn't own (#235)

    /// Every metadata item in the file, across all formats: identifier raw value to string
    /// (or "<n bytes>" for binary), one entry per item so duplicates show.
    private func allItems(_ url: URL) async throws -> [(id: String, text: String)] {
        let asset = AVAsset(url: url)
        var out: [(String, String)] = []
        for format in try await asset.load(.availableMetadataFormats) {
            for item in try await asset.loadMetadata(for: format) {
                let id = item.identifier?.rawValue ?? "?"
                var text = (try? await item.load(.stringValue)) ?? ""
                if text.isEmpty, let number = try? await item.load(.numberValue) { text = number.stringValue }
                if text.isEmpty, let data = try? await item.load(.dataValue) { text = "<\(data.count) bytes>" }
                out.append((id, text))
            }
        }
        return out
    }

    private func textItem(_ identifier: AVMetadataIdentifier, _ value: String) -> AVMetadataItem {
        let item = AVMutableMetadataItem()
        item.identifier = identifier
        item.value = value as NSString
        item.dataType = kCMMetadataBaseDataType_UTF8 as String
        return item
    }

    /// Re-exports `url` (passthrough) with `items`, standing in for another tool's tags.
    private func seed(_ url: URL, with items: [AVMetadataItem]) async throws {
        let out = url.deletingLastPathComponent().appendingPathComponent("seeded.m4a")
        let session = try #require(AVAssetExportSession(asset: AVAsset(url: url), presetName: AVAssetExportPresetPassthrough))
        session.outputURL = out
        session.outputFileType = .m4a
        session.metadata = items
        await session.export()
        try #require(session.status == .completed)
        _ = try FileManager.default.replaceItemAt(url, withItemAt: out)
    }

    @Test func retagKeepsAtomsLocallyDoesNotOwnAndNeverDuplicatesOwnedOnes() async throws {
        let (dir, url) = try makeTinyM4A()
        defer { try? FileManager.default.removeItem(at: dir) }
        let tempo = AVMutableMetadataItem()
        tempo.identifier = .iTunesMetadataBeatsPerMin
        tempo.value = NSNumber(value: 120)
        tempo.dataType = kCMMetadataBaseDataType_SInt16 as String
        try await seed(url, with: [
            textItem(.iTunesMetadataSongName, "Old Title"),
            textItem(.iTunesMetadataArtist, "Old Artist"),
            textItem(.iTunesMetadataAlbum, "Old Album"),
            textItem(.iTunesMetadataReleaseDate, "1999"),
            textItem(.iTunesMetadataComposer, "The Composer"),
            textItem(.iTunesMetadataLyrics, "La la la"),
            textItem(.iTunesMetadataUserComment, "A comment"),
            tempo
        ])
        let before = try await allItems(url)

        let tags = TagSet(title: "New Title", artist: "New Artist", album: "New Album", trackNumber: 1, totalTracks: 1, year: "2026")
        try await writer.write(tags, cover: nil, to: url)

        let after = try await allItems(url)
        func values(_ suffix: String) -> [String] { after.filter { $0.id.hasSuffix(suffix) }.map(\.text) }
        // The seed must really hold the non-owned atoms, or this test proves nothing.
        for suffix in ["/%A9wrt", "/%A9lyr", "/tmpo", "/%A9cmt"] {
            #expect(!before.filter { $0.id.hasSuffix(suffix) }.isEmpty, "seed lacks \(suffix)")
        }
        #expect(values("/%A9wrt") == ["The Composer"])
        #expect(values("/%A9lyr") == ["La la la"])
        #expect(values("/%A9cmt") == ["A comment"])
        #expect(values("/tmpo").count == 1)
        #expect(values("/%A9nam") == ["New Title"])
        #expect(values("/%A9ART") == ["New Artist"])
        #expect(values("/%A9alb") == ["New Album"])
        #expect(values("/%A9day") == ["2026"])
        #expect(values("/trkn").count == 1)
    }
}
