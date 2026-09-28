import Foundation
import AVFoundation
import Testing
@testable import Locally

struct AVTranscoderTests {
    /// PCM settings for a tiny mono WAV, written via `AVAudioFile` so the
    /// file is genuinely AVFoundation-readable (not just a `.wav`-named blob).
    private static let pcmSettings: [String: Any] = [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: 44_100,
        AVNumberOfChannelsKey: 1,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
    ]

    private func makeTempDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("AVTranscoderTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Writes ~0.1s of a sine wave as a real, AVFoundation-readable WAV file.
    /// The buffer handed to `AVAudioFile.write(from:)` must be in the file's
    /// own `processingFormat` (a deinterleaved float format AVFoundation
    /// picks for `settings`), not `settings` itself — writing an
    /// int16-formatted buffer straight from `pcmSettings` trips an internal
    /// `ExtAudioFileWrite` assertion and crashes the test process.
    private func makeWAVFile(in dir: URL) throws -> URL {
        let url = dir.appendingPathComponent("tone.wav")
        let audioFile = try AVAudioFile(forWriting: url, settings: Self.pcmSettings)
        let frameCount: AVAudioFrameCount = 4_410
        let buffer = AVAudioPCMBuffer(pcmFormat: audioFile.processingFormat, frameCapacity: frameCount)!
        buffer.frameLength = frameCount
        if let channelData = buffer.floatChannelData {
            for i in 0..<Int(frameCount) {
                channelData[0][i] = sin(Float(i) * 0.3) * 0.5
            }
        }
        try audioFile.write(from: buffer)
        return url
    }

    @Test func passesThroughMp3AndM4aWithoutTranscoding() async throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let transcoder = AVTranscoder()

        for ext in ["mp3", "m4a"] {
            let url = dir.appendingPathComponent("song.\(ext)")
            try Data([0xFF, 0xFB, 1, 2, 3, 4]).write(to: url)
            let staged = StagedFile(url: url, originalName: "song.\(ext)", existingTags: nil)

            let prepared = try await transcoder.prepare(staged)

            #expect(prepared.ext == ext)
            #expect(prepared.url == url, "passthrough must not move or rewrite the file")
        }
    }

    @Test func transcodesWavToM4a() async throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let transcoder = AVTranscoder()
        let wavURL = try makeWAVFile(in: dir)
        let staged = StagedFile(url: wavURL, originalName: "tone.wav", existingTags: nil)

        let prepared = try await transcoder.prepare(staged)

        #expect(prepared.ext == "m4a")
        #expect(prepared.url.pathExtension == "m4a")
        #expect(prepared.url.deletingPathExtension().lastPathComponent == "tone")
        #expect(FileManager.default.fileExists(atPath: prepared.url.path))
        let outData = try Data(contentsOf: prepared.url)
        #expect(!outData.isEmpty)
    }

    @Test func reTranscodingReplacesThePreviousOutputRatherThanFailing() async throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let transcoder = AVTranscoder()
        let wavURL = try makeWAVFile(in: dir)
        let staged = StagedFile(url: wavURL, originalName: "tone.wav", existingTags: nil)

        let first = try await transcoder.prepare(staged)
        let second = try await transcoder.prepare(staged)

        #expect(first.url == second.url)
        #expect(FileManager.default.fileExists(atPath: second.url.path))
    }

    @Test func unreadableInputThrowsTranscodeFailedRatherThanCrashing() async throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let transcoder = AVTranscoder()
        // A `.wav`-named file that isn't actually a WAV container — AVFoundation
        // must reject it, not the file extension routing.
        let garbageURL = dir.appendingPathComponent("garbage.wav")
        try Data("this is not audio data at all, just some bytes".utf8).write(to: garbageURL)
        let staged = StagedFile(url: garbageURL, originalName: "garbage.wav", existingTags: nil)

        await #expect(throws: LocallyError.self) {
            _ = try await transcoder.prepare(staged)
        }
    }

    @Test func missingInputFileThrowsTranscodeFailedRatherThanCrashing() async throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let transcoder = AVTranscoder()
        let missingURL = dir.appendingPathComponent("does-not-exist.wav")
        let staged = StagedFile(url: missingURL, originalName: "does-not-exist.wav", existingTags: nil)

        await #expect(throws: LocallyError.self) {
            _ = try await transcoder.prepare(staged)
        }
    }
}
