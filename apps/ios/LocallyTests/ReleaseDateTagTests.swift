import AVFoundation
import Foundation
import Testing
@testable import Locally

/// M4A ©day and the import prefill for a release date (#221). The mp3 frames are covered in
/// `ID3TagWriterTests` and `ID3KeepOtherFramesTests`.
struct ReleaseDateTagTests {
    private func tempDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("ReleaseDateTagTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func makeTinyM4A(in dir: URL) throws -> URL {
        let url = dir.appendingPathComponent("song.m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44100.0, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 64000
        ]
        let file = try AVAudioFile(forWriting: url, settings: settings)
        let buffer = try #require(AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 4410))
        buffer.frameLength = buffer.frameCapacity
        try file.write(from: buffer)
        return url
    }

    private func releaseDateAtom(_ url: URL) async throws -> String? {
        let asset = AVAsset(url: url)
        var found: String?
        for format in try await asset.load(.availableMetadataFormats) {
            for item in try await asset.loadMetadata(for: format) where item.identifier == .iTunesMetadataReleaseDate {
                found = try? await item.load(.stringValue)
            }
        }
        return found
    }

    private func tags(_ date: ReleaseDate?) -> TagSet {
        TagSet(title: "T", artist: "A", album: "B", date: date)
    }

    @Test func m4aWritesTheFullDateThenAYearOnlyRewriteLeavesNoDay() async throws {
        let dir = try tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = try makeTinyM4A(in: dir)

        try await M4ATagWriter().write(tags(ReleaseDate("2024-05-17")), cover: nil, to: url)
        #expect(try await releaseDateAtom(url) == "2024-05-17")

        try await M4ATagWriter().write(tags(ReleaseDate("2024")), cover: nil, to: url)
        #expect(try await releaseDateAtom(url) == "2024")
    }

    @Test func importPrefillsTheDayFromAnMp3sTDRC() async throws {
        let dir = try tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("song.mp3")
        // Silent MPEG-1 Layer III frames (128 kbps, 44.1 kHz, 417 bytes each), so AVFoundation reads the file.
        let frame = Data([0xFF, 0xFB, 0x90, 0x00]) + Data(count: 413)
        try Data((0..<40).flatMap { _ in frame }).write(to: url)
        try await ID3TagWriter().write(tags(ReleaseDate("2024-05-17")), cover: nil, to: url)

        let staged = try await LocalFileImporter().stage([url])

        #expect(staged.first?.existingTags?.date == ReleaseDate("2024-05-17"))
    }

    @Test func importPrefillsFromAnM4AsReleaseDate() async throws {
        let dir = try tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = try makeTinyM4A(in: dir)
        try await M4ATagWriter().write(tags(ReleaseDate("2024-05")), cover: nil, to: url)

        let staged = try await LocalFileImporter().stage([url])

        #expect(staged.first?.existingTags?.date == ReleaseDate("2024-05"))
    }

    @Test func tyerAndTdatMakeADayOnlyWhenBothAreRealTogether() {
        #expect(LocalFileImporter.id3YearAndDay(year: "2024", day: "1705") == ReleaseDate("2024-05-17"))
        #expect(LocalFileImporter.id3YearAndDay(year: "2024", day: nil) == ReleaseDate("2024"))
        #expect(LocalFileImporter.id3YearAndDay(year: "2023", day: "2902") == ReleaseDate("2023"))
        #expect(LocalFileImporter.id3YearAndDay(year: "2024", day: "junk") == ReleaseDate("2024"))
        #expect(LocalFileImporter.id3YearAndDay(year: nil, day: "1705") == nil)
    }
}
