import Foundation
import Testing
@testable import Locally

/// Feeds truncated/garbage/bad-size ID3v2 headers into `ID3TagWriter`, which
/// is the only place in the iOS app that parses an existing ID3 header (to
/// strip it before writing a fresh one — see `stripExistingID3Header`).
/// Every case must recover (return the input unchanged) rather than crash
/// or read/write past the buffer, and a full `write(_:cover:to:)` pass over
/// a malformed file must still only touch the one file it was given.
struct ID3MalformedInputTests {
    private func makeFile(bytes: [UInt8]) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("mp3")
        try Data(bytes).write(to: url)
        return url
    }

    // MARK: - stripExistingID3Header

    @Test func emptyDataIsReturnedUnchanged() {
        let result = ID3TagWriter.stripExistingID3Header(from: Data())
        #expect(result.isEmpty)
    }

    @Test func dataShorterThanAHeaderIsReturnedUnchanged() {
        let bytes: [UInt8] = [0x49, 0x44, 0x33, 0x04] // "ID3" + version byte, cut off
        let result = ID3TagWriter.stripExistingID3Header(from: Data(bytes))
        #expect(result == Data(bytes))
    }

    @Test func dataWithoutTheID3MagicBytesIsReturnedUnchanged() {
        // Looks like an mp3 frame sync, not an ID3 header.
        var bytes: [UInt8] = [0xFF, 0xFB, 0, 0, 0, 0, 0, 0, 0, 0]
        bytes.append(contentsOf: (0..<20).map { UInt8($0) })
        let result = ID3TagWriter.stripExistingID3Header(from: Data(bytes))
        #expect(result == Data(bytes))
    }

    /// A header that declares a frames size larger than the file actually
    /// has left — must not slice past the end of the buffer.
    @Test func headerDeclaringASizeLargerThanTheFileIsReturnedUnchanged() {
        var bytes: [UInt8] = [0x49, 0x44, 0x33, 0x04, 0x00, 0x00]
        // Synchsafe-encoded size claiming ~2 MB of frames, in a 20-byte file.
        bytes.append(contentsOf: [0x7F, 0x7F, 0x7F, 0x7F])
        bytes.append(contentsOf: (0..<10).map { UInt8($0) })
        let data = Data(bytes)

        let result = ID3TagWriter.stripExistingID3Header(from: data)

        #expect(result == data, "an unsatisfiable declared size must not be trusted")
    }

    /// A header declaring exactly the bytes available (header + frames ==
    /// file length, zero audio left) — a valid boundary case, not an error.
    @Test func headerConsumingTheEntireFileLeavesEmptyAudio() {
        var bytes: [UInt8] = [0x49, 0x44, 0x33, 0x04, 0x00, 0x00]
        // Synchsafe size of 5.
        bytes.append(contentsOf: [0x00, 0x00, 0x00, 0x05])
        bytes.append(contentsOf: [1, 2, 3, 4, 5])
        let data = Data(bytes)

        let result = ID3TagWriter.stripExistingID3Header(from: data)

        #expect(result.isEmpty)
    }

    @Test func garbageBinaryDataIsReturnedUnchanged() {
        var seed: UInt32 = 0xDEAD_BEEF
        var bytes: [UInt8] = []
        for _ in 0..<64 {
            seed = seed &* 1_664_525 &+ 1_013_904_223
            bytes.append(UInt8((seed >> 24) & 0xFF))
        }
        let data = Data(bytes)

        let result = ID3TagWriter.stripExistingID3Header(from: data)

        // None of the random bytes happen to start with "ID3" (checked
        // above by construction of the seed), so this must pass through.
        if bytes[0] == 0x49, bytes[1] == 0x44, bytes[2] == 0x33 {
            // Vanishingly unlikely, but keep the test meaningful either way.
            #expect(result.count <= data.count)
        } else {
            #expect(result == data)
        }
    }

    // MARK: - desynchsafe robustness

    @Test func desynchsafeOfAllOnesDoesNotOverflowOrCrash() {
        let value = ID3TagWriter.desynchsafe([0xFF, 0xFF, 0xFF, 0xFF])
        // Each byte only contributes its low 7 bits.
        #expect(value == (0x7F << 21 | 0x7F << 14 | 0x7F << 7 | 0x7F))
    }

    @Test func desynchsafeOfEmptyArrayIsZero() {
        #expect(ID3TagWriter.desynchsafe([]) == 0)
    }

    // MARK: - write(_:cover:to:) over a malformed existing file

    /// A full write pass over a file whose existing "ID3 header" is
    /// malformed (declares more frame bytes than exist) must still succeed:
    /// the malformed header is discarded as unparseable, the original bytes
    /// are kept as audio, and the new header/frames are prefixed onto it —
    /// same as any other file, and it must never write outside the one URL
    /// it was given.
    @Test func writingOverAFileWithAMalformedExistingHeaderSucceedsAndKeepsOriginalBytesAsAudio() async throws {
        var bytes: [UInt8] = [0x49, 0x44, 0x33, 0x04, 0x00, 0x00]
        bytes.append(contentsOf: [0x7F, 0x7F, 0x7F, 0x7F]) // unsatisfiable declared size
        bytes.append(contentsOf: [0xFF, 0xFB, 1, 2, 3, 4])
        let original = Data(bytes)
        let url = try makeFile(bytes: bytes)
        defer { try? FileManager.default.removeItem(at: url) }
        let writer = ID3TagWriter()
        let tags = TagSet(title: "T", artist: "A", album: "Al")

        try await writer.write(tags, cover: nil, to: url)

        let result = try Data(contentsOf: url)
        #expect(result != original)
        // Since the malformed header couldn't be trusted, the whole
        // original blob (bogus header included) is treated as "audio" and
        // kept intact, just prefixed with the new, correct header.
        #expect(result.suffix(original.count) == original)
        #expect(result.count > original.count)
    }

    @Test func writingOverATruncatedGarbageFileDoesNotThrowOrCrash() async throws {
        let url = try makeFile(bytes: [0x49, 0x44]) // just "ID" — cut off mid-magic
        defer { try? FileManager.default.removeItem(at: url) }
        let writer = ID3TagWriter()
        let tags = TagSet(title: "T", artist: "A", album: "Al")

        try await writer.write(tags, cover: nil, to: url)

        let result = try Data(contentsOf: url)
        #expect(result.count > 2)
        // The 2 original bytes must still be present, as audio, at the end.
        #expect(result.suffix(2) == Data([0x49, 0x44]))
    }

    @Test func writingOverAnEmptyFileDoesNotThrowOrCrash() async throws {
        let url = try makeFile(bytes: [])
        defer { try? FileManager.default.removeItem(at: url) }
        let writer = ID3TagWriter()
        let tags = TagSet(title: "T", artist: "A", album: "Al")

        try await writer.write(tags, cover: nil, to: url)

        let result = try Data(contentsOf: url)
        #expect(!result.isEmpty, "the new header/frames were still written")
    }
}
