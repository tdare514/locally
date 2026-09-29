import Foundation
import Testing
@testable import Locally

struct ID3TagWriterTests {
    let writer = ID3TagWriter()

    /// A minimal "audio" payload: an MPEG frame sync (0xFF 0xFB) followed by
    /// deterministic pseudo-random bytes, standing in for real mp3 data
    /// that must survive tagging byte-for-byte.
    private func fakeAudioBytes(count: Int = 256) -> Data {
        var bytes: [UInt8] = [0xFF, 0xFB]
        var seed: UInt32 = 0x1234_5678
        for _ in 0..<count {
            seed = seed &* 1_103_515_245 &+ 12_345
            bytes.append(UInt8((seed >> 16) & 0xFF))
        }
        return Data(bytes)
    }

    /// A fresh directory holding one `track.mp3`; the caller removes the directory.
    private func makeFile(audio: Data? = nil) throws -> (dir: URL, url: URL) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("track.mp3")
        try (audio ?? fakeAudioBytes()).write(to: url)
        return (dir, url)
    }

    private func tags(cover: Bool = false) -> TagSet {
        TagSet(
            title: "My Title",
            artist: "My Artist",
            albumArtist: "Album Artist",
            album: "My Album",
            trackNumber: 3,
            totalTracks: 10,
            year: "2026",
            genre: "Electronic"
        )
    }

    /// Parses an ID3v2.4 header + frames back out of `data`, returning the
    /// frames keyed by id and the audio bytes that follow.
    private func parse(_ data: Data) -> (frames: [String: Data], audio: Data) {
        let bytes = [UInt8](data)
        #expect(bytes[0] == 0x49 && bytes[1] == 0x44 && bytes[2] == 0x33) // "ID3"
        #expect(bytes[3] == 0x04 && bytes[4] == 0x00) // version 2.4.0
        let framesSize = ID3TagWriter.desynchsafe(Array(bytes[6...9]))
        let headerEnd = 10 + framesSize

        var frames: [String: Data] = [:]
        var offset = 10
        while offset + 10 <= headerEnd {
            let idBytes = bytes[offset..<(offset + 4)]
            let id = String(bytes: idBytes, encoding: .ascii) ?? ""
            let sizeBytes = Array(bytes[(offset + 4)..<(offset + 8)])
            let size = ID3TagWriter.desynchsafe(sizeBytes)
            let payloadStart = offset + 10
            let payloadEnd = payloadStart + size
            guard payloadEnd <= headerEnd else { break }
            frames[id] = data.subdata(in: payloadStart..<payloadEnd)
            offset = payloadEnd
        }

        let audio = data.subdata(in: headerEnd..<data.count)
        return (frames, audio)
    }

    private func textValue(_ frameData: Data) -> String {
        // encoding byte (0x03 = UTF-8) followed by the UTF-8 text.
        String(data: frameData.dropFirst(), encoding: .utf8) ?? ""
    }

    @Test func writesExpectedTextFrames() async throws {
        let (dir, url) = try makeFile()
        defer { try? FileManager.default.removeItem(at: dir) }
        let original = try Data(contentsOf: url)

        try await writer.write(tags(), cover: nil, to: url)

        let result = try Data(contentsOf: url)
        let (frames, audio) = parse(result)

        #expect(textValue(frames["TIT2"]!) == "My Title")
        #expect(textValue(frames["TPE1"]!) == "My Artist")
        #expect(textValue(frames["TPE2"]!) == "Album Artist")
        #expect(textValue(frames["TALB"]!) == "My Album")
        #expect(textValue(frames["TRCK"]!) == "3/10")
        #expect(textValue(frames["TDRC"]!) == "2026")
        #expect(textValue(frames["TCON"]!) == "Electronic")

        #expect(audio == Self.audioSuffix(of: original))
    }

    @Test func writesAPICWithMimeAndPictureBytes() async throws {
        let (dir, url) = try makeFile()
        defer { try? FileManager.default.removeItem(at: dir) }
        // Minimal PNG signature so mime detection picks "image/png".
        let pngHeader: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
        let cover = Data(pngHeader + [1, 2, 3, 4, 5])

        try await writer.write(tags(), cover: cover, to: url)

        let result = try Data(contentsOf: url)
        let (frames, _) = parse(result)
        let apic = try #require(frames["APIC"])
        let apicBytes = [UInt8](apic)

        #expect(apicBytes[0] == 0x00) // text encoding (Latin-1)
        let mimeEnd = apicBytes[1...].firstIndex(of: 0x00)!
        let mime = String(bytes: apicBytes[1..<mimeEnd], encoding: .ascii)
        #expect(mime == "image/png")

        let pictureTypeIndex = mimeEnd + 1
        #expect(apicBytes[pictureTypeIndex] == 0x03) // front cover
        let descriptionEnd = pictureTypeIndex + 1 // empty description, one null byte
        #expect(apicBytes[descriptionEnd] == 0x00)

        let pictureBytes = Data(apicBytes[(descriptionEnd + 1)...])
        #expect(pictureBytes == cover)
    }

    @Test func synchsafeSizeMatchesActualFramesLength() async throws {
        let (dir, url) = try makeFile()
        defer { try? FileManager.default.removeItem(at: dir) }
        try await writer.write(tags(), cover: nil, to: url)

        let result = try Data(contentsOf: url)
        let bytes = [UInt8](result)
        let declaredSize = ID3TagWriter.desynchsafe(Array(bytes[6...9]))
        let (frames, _) = parse(result)
        let actualFramesLength = frames.reduce(0) { $0 + $1.value.count + 10 }
        #expect(declaredSize == actualFramesLength)
    }

    @Test func writingTwiceDoesNotStackHeaders() async throws {
        let (dir, url) = try makeFile()
        defer { try? FileManager.default.removeItem(at: dir) }
        let original = try Data(contentsOf: url)

        try await writer.write(tags(), cover: nil, to: url)
        try await writer.write(tags(), cover: nil, to: url)

        let result = try Data(contentsOf: url)
        // Only one "ID3" marker should exist, at the very start.
        let bytes = [UInt8](result)
        #expect(bytes[0] == 0x49 && bytes[1] == 0x44 && bytes[2] == 0x33)

        let (_, audio) = parse(result)
        #expect(audio == Self.audioSuffix(of: original))

        // The whole tail after the second header's frames is still exactly
        // the original audio — i.e. the first tag's header was stripped,
        // not left in place ahead of the second one.
        let occurrences = countOccurrences(of: [0x49, 0x44, 0x33], in: bytes)
        #expect(occurrences == 1)
    }

    @Test func defaultLimitIsTheSynchsafeLimit() {
        #expect(ID3TagWriter.synchsafeLimit == 1 << 28)
        #expect(ID3TagWriter.canEncodeSynchsafe((1 << 28) - 1) == true)
        #expect(ID3TagWriter.canEncodeSynchsafe(1 << 28) == false)
        #expect(ID3TagWriter.canEncodeSynchsafe(-1) == false)
    }

    @Test func rejectsATagBodyAtTheLimitAndLeavesTheFileUntouched() async throws {
        let (dir, url) = try makeFile()
        defer { try? FileManager.default.removeItem(at: dir) }
        let before = try Data(contentsOf: url)
        let cover = Data(repeating: 0xAB, count: 2048)
        let writer = ID3TagWriter(tagBodyLimit: 1024)

        do {
            try await writer.write(tags(), cover: cover, to: url)
            Issue.record("expected taggingFailed")
        } catch let error as LocallyError {
            guard case .taggingFailed = error else {
                Issue.record("unexpected LocallyError \(error)")
                return
            }
        }

        let after = try Data(contentsOf: url)
        #expect(after == before)
        let listing = try FileManager.default.contentsOfDirectory(atPath: dir.path).sorted()
        #expect(listing == ["track.mp3"])
    }

    @Test func acceptsATagBodyOneByteBelowTheLimitAndRejectsAtIt() async throws {
        let (dir1, url1) = try makeFile()
        defer { try? FileManager.default.removeItem(at: dir1) }
        try await writer.write(tags(), cover: nil, to: url1)
        let result = try Data(contentsOf: url1)
        let bytes = [UInt8](result)
        let S = ID3TagWriter.desynchsafe(Array(bytes[6...9]))

        let (dir2, url2) = try makeFile()
        defer { try? FileManager.default.removeItem(at: dir2) }
        try await ID3TagWriter(tagBodyLimit: S + 1).write(tags(), cover: nil, to: url2)

        let (dir3, url3) = try makeFile()
        defer { try? FileManager.default.removeItem(at: dir3) }
        do {
            try await ID3TagWriter(tagBodyLimit: S).write(tags(), cover: nil, to: url3)
            Issue.record("expected taggingFailed")
        } catch let error as LocallyError {
            guard case .taggingFailed = error else {
                Issue.record("unexpected LocallyError \(error)")
                return
            }
        }
    }

    @Test func injectedLimitAboveSynchsafeIsClampedAndStillRejectsAtTheLimit() async throws {
        #expect(ID3TagWriter(tagBodyLimit: ID3TagWriter.synchsafeLimit + 1).tagBodyLimit == ID3TagWriter.synchsafeLimit)

        let (dir, url) = try makeFile()
        defer { try? FileManager.default.removeItem(at: dir) }
        let before = try Data(contentsOf: url)
        // Zero-filled cover whose frame body is at least `synchsafeLimit` bytes.
        let cover = Data(count: ID3TagWriter.synchsafeLimit)
        let writer = ID3TagWriter(tagBodyLimit: ID3TagWriter.synchsafeLimit + 1)

        do {
            try await writer.write(tags(), cover: cover, to: url)
            Issue.record("expected taggingFailed")
        } catch let error as LocallyError {
            guard case .taggingFailed = error else {
                Issue.record("unexpected LocallyError \(error)")
                return
            }
        }

        #expect(try Data(contentsOf: url) == before)
        let listing = try FileManager.default.contentsOfDirectory(atPath: dir.path).sorted()
        #expect(listing == ["track.mp3"])
    }

    @Test func streamsAudioLargerThanOneChunkByteForByte() async throws {
        let audioSize = (2 << 20) + 4097
        let audio = fakeAudioBytes(count: audioSize)
        let (dir, url) = try makeFile(audio: audio)
        defer { try? FileManager.default.removeItem(at: dir) }

        try await writer.write(tags(), cover: nil, to: url)

        let result = try Data(contentsOf: url)
        let (_, parsedAudio) = parse(result)
        #expect(parsedAudio == audio)

        // Second pass: existing ID3 header prefixed onto multi-chunk audio.
        try await writer.write(tags(), cover: nil, to: url)
        let result2 = try Data(contentsOf: url)
        let (_, parsedAudio2) = parse(result2)
        #expect(parsedAudio2 == audio)
    }

    @Test func leavesOnlyTheTaggedFileBehindOnSuccess() async throws {
        let (dir, url) = try makeFile()
        defer { try? FileManager.default.removeItem(at: dir) }

        try await writer.write(tags(), cover: nil, to: url)

        let listing = try FileManager.default.contentsOfDirectory(atPath: dir.path).sorted()
        #expect(listing == ["track.mp3"])
    }

    @Test func missingFileThrowsTaggingFailed() async throws {
        let (dir, url) = try makeFile()
        defer { try? FileManager.default.removeItem(at: dir) }
        let missing = dir.appendingPathComponent("does-not-exist.mp3")

        do {
            try await writer.write(tags(), cover: nil, to: missing)
            Issue.record("expected taggingFailed")
        } catch let error as LocallyError {
            guard case .taggingFailed = error else {
                Issue.record("unexpected LocallyError \(error)")
                return
            }
        }

        let listing = try FileManager.default.contentsOfDirectory(atPath: dir.path).sorted()
        #expect(listing == ["track.mp3"])
    }

    @Test func failedReplaceThrowsTaggingFailedAndLeavesTheOriginalUntouched() async throws {
        let (dir, url) = try makeFile()
        defer { try? FileManager.default.removeItem(at: dir) }
        let before = try Data(contentsOf: url)
        var seen: (original: URL, replacement: URL, replacementExisted: Bool)?
        let writer = ID3TagWriter(replaceItem: { original, replacement in
            seen = (original, replacement, FileManager.default.fileExists(atPath: replacement.path))
            throw CocoaError(.fileWriteNoPermission)
        })

        do {
            try await writer.write(tags(), cover: nil, to: url)
            Issue.record("expected taggingFailed")
        } catch let error as LocallyError {
            guard case .taggingFailed = error else {
                Issue.record("unexpected LocallyError \(error)")
                return
            }
        }

        #expect(try Data(contentsOf: url) == before)
        let listing = try FileManager.default.contentsOfDirectory(atPath: dir.path).sorted()
        #expect(listing == ["track.mp3"])
        #expect(seen?.original == url)
        #expect(seen?.replacement.pathExtension == "tmp")
        #expect(seen?.replacement.deletingLastPathComponent().standardizedFileURL == dir.standardizedFileURL)
        #expect(seen?.replacementExisted == true)
    }

    private func countOccurrences(of pattern: [UInt8], in bytes: [UInt8]) -> Int {
        guard bytes.count >= pattern.count else { return 0 }
        var count = 0
        for i in 0...(bytes.count - pattern.count) {
            if Array(bytes[i..<(i + pattern.count)]) == pattern {
                count += 1
            }
        }
        return count
    }

    private static func audioSuffix(of data: Data) -> Data {
        let skip = ID3TagWriter.existingID3HeaderLength(prefix: data.prefix(10), fileLength: data.count)
        return data.suffix(from: data.startIndex + skip)
    }
}
