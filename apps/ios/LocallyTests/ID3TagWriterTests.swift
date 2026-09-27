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

    private func makeFile() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("mp3")
        try fakeAudioBytes().write(to: url)
        return url
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
        let url = try makeFile()
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
        let url = try makeFile()
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
        let url = try makeFile()
        try await writer.write(tags(), cover: nil, to: url)

        let result = try Data(contentsOf: url)
        let bytes = [UInt8](result)
        let declaredSize = ID3TagWriter.desynchsafe(Array(bytes[6...9]))
        let (frames, _) = parse(result)
        let actualFramesLength = frames.reduce(0) { $0 + $1.value.count + 10 }
        #expect(declaredSize == actualFramesLength)
    }

    @Test func writingTwiceDoesNotStackHeaders() async throws {
        let url = try makeFile()
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
        ID3TagWriter.stripExistingID3Header(from: data)
    }
}
