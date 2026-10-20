import Foundation
import Testing
@testable import Locally

/// Re-tagging an mp3 keeps the frames Locally doesn't own (#235).
struct ID3KeepOtherFramesTests {
    let writer = ID3TagWriter()
    private let audio = Data([0xFF, 0xFB, 0x90, 0x00, 0x01, 0x02, 0x03, 0x04])

    // MARK: Building source tags

    private func text(_ string: String) -> [UInt8] { [0x03] + Array(string.utf8) }

    private func plain(_ n: Int) -> [UInt8] {
        let value = UInt32(truncatingIfNeeded: n)
        return [UInt8(value >> 24 & 0xFF), UInt8(value >> 16 & 0xFF), UInt8(value >> 8 & 0xFF), UInt8(value & 0xFF)]
    }

    private func v24Frame(_ id: String, _ payload: [UInt8], status: UInt8 = 0, format: UInt8 = 0) -> Data {
        Data(Array(id.utf8) + Array(ID3TagWriter.synchsafe(payload.count)) + [status, format] + payload)
    }

    private func v23Frame(_ id: String, _ payload: [UInt8], status: UInt8 = 0, format: UInt8 = 0) -> Data {
        Data(Array(id.utf8) + plain(payload.count) + [status, format] + payload)
    }

    private func tag(major: UInt8, flags: UInt8 = 0, body: Data) -> Data {
        Data([0x49, 0x44, 0x33, major, 0x00, flags]) + ID3TagWriter.synchsafe(body.count) + body
    }

    private func unsynchronise(_ bytes: [UInt8]) -> [UInt8] {
        var out: [UInt8] = []
        for (i, byte) in bytes.enumerated() {
            out.append(byte)
            let next = i + 1 < bytes.count ? bytes[i + 1] : nil
            if byte == 0xFF, next == nil || next! == 0x00 || next! >= 0xE0 { out.append(0x00) }
        }
        return out
    }

    private func apic(type: UInt8, picture: [UInt8]) -> [UInt8] {
        [0x00] + Array("image/jpeg".utf8) + [0x00, type, 0x00] + picture
    }

    private func makeFile(tag: Data) throws -> (dir: URL, url: URL) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("track.mp3")
        try (tag + audio).write(to: url)
        return (dir, url)
    }

    private func tags(date: ReleaseDate? = ReleaseDate(year: 2026)) -> TagSet {
        TagSet(title: "New Title", artist: "New Artist", albumArtist: "New Artist", album: "New Album",
               trackNumber: 1, totalTracks: 2, date: date, genre: "Pop")
    }

    /// All frames of a v2.4 tag, in order, duplicates included, plus the audio after it.
    private func parse(_ data: Data) -> (frames: [(id: String, payload: [UInt8], flags: [UInt8])], audio: Data) {
        let bytes = [UInt8](data)
        let header: [UInt8] = [0x49, 0x44, 0x33, 0x04, 0x00]
        #expect(Array(bytes[0..<5]) == header)
        let end = 10 + ID3TagWriter.desynchsafe(Array(bytes[6...9]))
        var frames: [(String, [UInt8], [UInt8])] = []
        var offset = 10
        while offset + 10 <= end {
            let id = String(bytes: bytes[offset..<(offset + 4)], encoding: .ascii) ?? ""
            let size = ID3TagWriter.desynchsafe(Array(bytes[(offset + 4)..<(offset + 8)]))
            guard offset + 10 + size <= end else { break }
            frames.append((id, Array(bytes[(offset + 10)..<(offset + 10 + size)]), Array(bytes[(offset + 8)..<(offset + 10)])))
            offset += 10 + size
        }
        return (frames, data.subdata(in: end..<data.count))
    }

    private func retag(_ source: Data, date: ReleaseDate? = ReleaseDate(year: 2026), cover: Data? = nil) async throws -> (frames: [(id: String, payload: [UInt8], flags: [UInt8])], audio: Data) {
        let (dir, url) = try makeFile(tag: source)
        defer { try? FileManager.default.removeItem(at: dir) }
        try await writer.write(tags(date: date), cover: cover, to: url)
        return parse(try Data(contentsOf: url))
    }

    private func payloads(_ frames: [(id: String, payload: [UInt8], flags: [UInt8])], _ id: String) -> [[UInt8]] {
        frames.filter { $0.id == id }.map(\.payload)
    }

    // MARK: Tests

    @Test func keepsEveryFrameLocallyDoesNotOwnAndReplacesTheOwnedOnes() async throws {
        let backCover = apic(type: 0x04, picture: [1, 2, 3])
        let oldFront = apic(type: 0x03, picture: [9, 9, 9])
        let source = tag(major: 4, body: [
            v24Frame("TIT2", text("Old Title")), v24Frame("TPE1", text("Old Artist")),
            v24Frame("TALB", text("Old Album")), v24Frame("TDRC", text("1999")), v24Frame("TYER", text("1999")),
            v24Frame("TCOM", text("The Composer")),
            v24Frame("USLT", [0x03] + Array("eng".utf8) + [0x00] + Array("la la".utf8)),
            v24Frame("TBPM", text("120")),
            v24Frame("COMM", [0x03] + Array("eng".utf8) + [0x00] + Array("a comment".utf8)),
            v24Frame("TXXX", [0x03] + Array("KEY".utf8) + [0x00] + Array("value".utf8)),
            v24Frame("TXXX", [0x03] + Array("KEY2".utf8) + [0x00] + Array("value2".utf8)),
            v24Frame("APIC", backCover), v24Frame("APIC", oldFront)
        ].reduce(Data(), +))
        let newCover = Data([0xFF, 0xD8, 0xFF, 0xE0, 7, 7])

        let (frames, outAudio) = try await retag(source, cover: newCover)

        #expect(outAudio == audio)
        for id in ["TIT2", "TPE1", "TALB", "TDRC", "TYER"] { #expect(frames.filter { $0.id == id }.count == 1, "\(id)") }
        #expect(payloads(frames, "TIT2") == [text("New Title")])
        let latin1Year: [UInt8] = [0x00] + Array("2026".utf8) // ISO-8859-1
        #expect(payloads(frames, "TYER") == [latin1Year])
        #expect(payloads(frames, "TCOM") == [text("The Composer")])
        #expect(payloads(frames, "TBPM") == [text("120")])
        #expect(payloads(frames, "USLT").count == 1)
        #expect(payloads(frames, "COMM").count == 1)
        #expect(payloads(frames, "TXXX").count == 2)
        let apics = payloads(frames, "APIC")
        #expect(apics.count == 2)
        #expect(apics.contains(backCover))
        #expect(!apics.contains(oldFront))
        let coverBytes = [UInt8](newCover)
        #expect(apics.contains { (apic: [UInt8]) -> Bool in Array(apic.suffix(coverBytes.count)) == coverBytes })
        // Locally's own frames come first.
        #expect(frames.first?.id == "TIT2")
        #expect(frames.firstIndex { $0.id == "TCOM" }! > frames.firstIndex { $0.id == "TCON" }!)
        #expect(frames.allSatisfy { $0.flags == [0, 0] })
    }

    @Test func aYearOnlyRewriteReplacesAFullTDRCAndKeepsAForeignTDAT() async throws {
        let source = tag(major: 4, body: [
            v24Frame("TIT2", text("Old Title")), v24Frame("TDRC", text("2024-05-17")),
            v24Frame("TDAT", text("1705"))
        ].reduce(Data(), +))

        let (frames, _) = try await retag(source, date: ReleaseDate(year: 2024))

        #expect(payloads(frames, "TDRC") == [text("2024")])
        #expect(payloads(frames, "TYER") == [[0x00] + Array("2024".utf8)])
        #expect(payloads(frames, "TDAT") == [text("1705")], "TDAT is not owned, so it is kept (#235)")
    }

    @Test func carriesAV23TagsFramesIntoTheV24Tag() async throws {
        // 0x80 0x80 in the size makes plain and synchsafe readings differ.
        let long = [UInt8](repeating: 0x41, count: 300)
        let source = tag(major: 3, body: [
            v23Frame("TIT2", text("Old")), v23Frame("TCOM", text("Composer")),
            v23Frame("COMM", [0x03] + Array("eng".utf8) + [0x00] + long),
            v23Frame("TBPM", text("90"))
        ].reduce(Data(), +))

        let (frames, outAudio) = try await retag(source)

        #expect(outAudio == audio)
        #expect(payloads(frames, "TCOM") == [text("Composer")])
        var comm: [UInt8] = [0x03]
        comm += Array("eng".utf8)
        comm.append(0x00)
        comm += long
        #expect(payloads(frames, "COMM") == [comm])
        #expect(payloads(frames, "TBPM") == [text("90")])
        #expect(payloads(frames, "TIT2") == [text("New Title")])
    }

    @Test func skipsAV23ExtendedHeader() async throws {
        let extended = plain(6) + [0x00, 0x00] + plain(0) // size 6 excludes itself
        let source = tag(major: 3, flags: 0x40, body: Data(extended) + v23Frame("TCOM", text("Composer")))
        let (frames, _) = try await retag(source)
        #expect(payloads(frames, "TCOM") == [text("Composer")])
    }

    @Test func skipsAV24ExtendedHeader() async throws {
        let extended = Array(ID3TagWriter.synchsafe(6)) + [0x01, 0x00] // size 6 includes itself
        let source = tag(major: 4, flags: 0x40, body: Data(extended) + v24Frame("TCOM", text("Composer")))
        let (frames, _) = try await retag(source)
        #expect(payloads(frames, "TCOM") == [text("Composer")])
    }

    @Test func reversesTagLevelUnsynchronisationInAV23Tag() async throws {
        let payload: [UInt8] = [0x03, 0xFF, 0xE0, 0x41, 0xFF]
        let body = [v23Frame("TCOM", payload), v23Frame("TBPM", text("90"))].reduce(Data(), +)
        let source = tag(major: 3, flags: 0x80, body: Data(unsynchronise([UInt8](body))))
        #expect([UInt8](source).contains(0x00)) // sanity: encoded
        let (frames, _) = try await retag(source)
        #expect(payloads(frames, "TCOM") == [payload])
        #expect(payloads(frames, "TBPM") == [text("90")])
    }

    @Test func reversesPerFrameUnsynchronisationAndDropsTheDataLengthIndicator() async throws {
        let original: [UInt8] = [0x03, 0xFF, 0xE0, 0x41, 0xFF]
        let encoded = Array(ID3TagWriter.synchsafe(original.count)) + unsynchronise(original)
        let source = tag(major: 4, body: v24Frame("TCOM", encoded, format: 0x03) + v24Frame("TBPM", text("90")))
        let (frames, _) = try await retag(source)
        #expect(payloads(frames, "TCOM") == [original])
        #expect(frames.allSatisfy { $0.flags == [0, 0] })
        #expect(payloads(frames, "TBPM") == [text("90")])
    }

    @Test func dropsOnlyDiscardWhenTagAlteredFramesAndClearsOtherStatusFlags() async throws {
        let v24 = tag(major: 4, body: [
            v24Frame("TCOM", text("discard"), status: 0x40),
            v24Frame("TPUB", text("kept"), status: 0x20) // read-only bit is cleared, frame kept
        ].reduce(Data(), +))
        let (frames24, _) = try await retag(v24)
        #expect(payloads(frames24, "TCOM").isEmpty)
        #expect(payloads(frames24, "TPUB") == [text("kept")])
        #expect(frames24.allSatisfy { $0.flags == [0, 0] })

        let v23 = tag(major: 3, body: [
            v23Frame("TCOM", text("discard"), status: 0x80),
            v23Frame("TPUB", text("kept"), status: 0x40) // file-alter bit is cleared, frame kept
        ].reduce(Data(), +))
        let (frames23, _) = try await retag(v23)
        #expect(payloads(frames23, "TCOM").isEmpty)
        #expect(payloads(frames23, "TPUB") == [text("kept")])
        #expect(frames23.allSatisfy { $0.flags == [0, 0] })
    }

    @Test func keepsAGroupedTCOMFromV23AndV24() async throws {
        let (f23, _) = try await retag(tag(major: 3, body: v23Frame("TCOM", [0x07] + text("Composer"), format: 0x20)))
        let out23 = try #require(f23.first { $0.id == "TCOM" })
        #expect(out23.flags == [0, 0x40])
        let grouped: [UInt8] = [0x07] + text("Composer")
        #expect(out23.payload == grouped)

        let (f24, _) = try await retag(tag(major: 4, body: v24Frame("TCOM", [0x07] + text("Composer"), format: 0x40)))
        let out24 = try #require(f24.first { $0.id == "TCOM" })
        #expect(out24.flags == [0, 0x40])
        #expect(out24.payload == grouped)
    }

    @Test func aCompressedV23FrameBecomesAV24FrameWithADataLengthIndicator() async throws {
        let zlib: [UInt8] = [0x78, 0x9C, 0xAB, 0xCD, 0x03, 0x00, 0x01, 0x02] // opaque: never inflated
        let decompressed = 300
        let payload = plain(decompressed) + zlib
        let (frames, _) = try await retag(tag(major: 3, body: v23Frame("TXXX", payload, format: 0x80)))
        let out = try #require(frames.first { $0.id == "TXXX" })
        #expect(out.flags == [0, 0x09])
        #expect(Array(out.payload.prefix(4)) == Array(ID3TagWriter.synchsafe(decompressed)))
        #expect(Array(out.payload.dropFirst(4)) == zlib)
    }

    @Test func aV23FrameThatIsEncryptedAndGroupedKeepsItsBytesInV24Order() async throws {
        // v2.3 order: encryption method, then group id. v2.4 order: group id, then method.
        let (frames, _) = try await retag(tag(major: 3, body: v23Frame("TCOM", [0x05, 0x09, 0xAA, 0xBB], format: 0x60)))
        let out = try #require(frames.first { $0.id == "TCOM" })
        #expect(out.flags == [0, 0x44])
        #expect(out.payload == [0x09, 0x05, 0xAA, 0xBB])
    }

    @Test func keepsAnEncryptedV24FrameWithItsMethodByte() async throws {
        let (frames, _) = try await retag(tag(major: 4, body: v24Frame("TCOM", [0x05, 0xAA, 0xFF, 0x00, 0xBB], format: 0x04)))
        let out = try #require(frames.first { $0.id == "TCOM" })
        #expect(out.flags == [0, 0x04])
        #expect(out.payload == [0x05, 0xAA, 0xFF, 0x00, 0xBB])
    }

    @Test func keepsACompressedUnsynchronisedV24FrameUnchanged() async throws {
        let dli = Array(ID3TagWriter.synchsafe(123))
        let data: [UInt8] = [0x78, 0xFF, 0x00, 0xE0, 0x01]
        let (frames, _) = try await retag(tag(major: 4, body: v24Frame("TXXX", dli + data, format: 0x0B)))
        let out = try #require(frames.first { $0.id == "TXXX" })
        #expect(out.flags == [0, 0x0B])
        let unchanged: [UInt8] = dli + data
        #expect(out.payload == unchanged)
    }

    @Test func reversesUnsynchronisationAcrossAGroupedFramesWholeBodyBeforeReadingTheGroupId() async throws {
        let text: [UInt8] = [0x00] + Array("Composer".utf8) // Latin-1
        let body = unsynchronise([0xFF] + text) // group id FF, then the text: starts FF 00 00
        #expect(Array(body.prefix(3)) == [0xFF, 0x00, 0x00])
        let (frames, _) = try await retag(tag(major: 4, body: v24Frame("TCOM", body, format: 0x42)))
        let out = try #require(frames.first { $0.id == "TCOM" })
        #expect(out.flags == [0, 0x40])
        let regrouped: [UInt8] = [0xFF] + text
        #expect(out.payload == regrouped)
    }

    @Test func keepsTheDataLengthIndicatorOnAnEncryptedUncompressedFrame() async throws {
        let dli = Array(ID3TagWriter.synchsafe(42))
        let payload: [UInt8] = [0x05] + dli + [0xAA, 0xBB]
        let (frames, _) = try await retag(tag(major: 4, body: v24Frame("TCOM", payload, format: 0x05)))
        let out = try #require(frames.first { $0.id == "TCOM" })
        #expect(out.flags == [0, 0x05])
        #expect(out.payload == payload)
    }

    @Test func dropsAFrameWhoseExtraBytesDoNotFit() async throws {
        let body = v24Frame("TCOM", [], format: 0x40) + v24Frame("TBPM", text("90"))
        let (frames, _) = try await retag(tag(major: 4, body: body))
        #expect(payloads(frames, "TCOM").isEmpty)
        #expect(payloads(frames, "TBPM") == [text("90")])
    }

    @Test func aMalformedTrailingFrameKeepsTheEarlierFramesAndTheWriteSucceeds() async throws {
        var body = v24Frame("TCOM", text("Composer")) + v24Frame("TBPM", text("90"))
        body.append(contentsOf: Array("TXXX".utf8) + Array(ID3TagWriter.synchsafe(5000)) + [0, 0, 1, 2, 3]) // size past the end
        let (frames, outAudio) = try await retag(tag(major: 4, body: body))
        #expect(outAudio == audio)
        #expect(payloads(frames, "TCOM") == [text("Composer")])
        #expect(payloads(frames, "TBPM") == [text("90")])
        #expect(payloads(frames, "TXXX").isEmpty)

        let badId = v24Frame("TCOM", text("Composer")) + Data(Array("tcom".utf8) + [0, 0, 0, 2, 0, 0, 1, 2])
            + v24Frame("TBPM", text("90"))
        let (frames2, _) = try await retag(tag(major: 4, body: badId))
        #expect(payloads(frames2, "TCOM") == [text("Composer")])
        #expect(payloads(frames2, "TBPM").isEmpty) // parsing stopped at the bad id
    }

    @Test func stopsAtPadding() async throws {
        let body = v24Frame("TCOM", text("Composer")) + Data(repeating: 0, count: 20)
        let (frames, _) = try await retag(tag(major: 4, body: body))
        #expect(payloads(frames, "TCOM") == [text("Composer")])
    }

    @Test func aV22TagKeepsNothingAndTheWriteSucceeds() async throws {
        let v22Frame = Data(Array("TCM".utf8) + [0, 0, 9] + text("Composer") )
        let (frames, outAudio) = try await retag(tag(major: 2, body: v22Frame))
        #expect(outAudio == audio)
        #expect(payloads(frames, "TCOM").isEmpty)
        #expect(frames.map(\.id).contains("TIT2"))
        #expect(!frames.map(\.id).contains("TCM"))
    }

    @Test func refusesWhenOwnAndKeptFramesWouldNotFitAndLeavesTheFileUntouched() async throws {
        let limited = ID3TagWriter(tagBodyLimit: 400)
        let big = [UInt8](repeating: 0x41, count: 600)
        let source = tag(major: 4, body: v24Frame("TCOM", [0x03] + big))
        let (dir, url) = try makeFile(tag: source)
        defer { try? FileManager.default.removeItem(at: dir) }
        let before = try Data(contentsOf: url)

        await #expect(throws: LocallyError.self) { try await limited.write(tags(), cover: nil, to: url) }

        #expect(try Data(contentsOf: url) == before)
        #expect(try FileManager.default.contentsOfDirectory(atPath: dir.path) == ["track.mp3"])
    }

    @Test func refusesATagOverTheMemoryCapBeforeReadingItAndLeavesTheFileUntouched() async throws {
        // A sparse file whose header claims a 33 MiB tag, bounded by the file length.
        let claimed = 33 * 1024 * 1024
        let header = Data([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]) + ID3TagWriter.synchsafe(claimed)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("track.mp3")
        try header.write(to: url)
        let handle = try FileHandle(forWritingTo: url)
        try handle.truncate(atOffset: UInt64(10 + claimed + 4))
        try handle.close()
        let before = try Data(contentsOf: url)

        do {
            try await writer.write(tags(), cover: nil, to: url)
            Issue.record("write must throw")
        } catch let error as LocallyError {
            guard case .taggingFailed(let message) = error else { Issue.record("wrong error \(error)"); return }
            #expect(message == Copy.FileErrors.existingTagTooLarge)
        }

        #expect(try Data(contentsOf: url) == before)
        #expect(try FileManager.default.contentsOfDirectory(atPath: dir.path) == ["track.mp3"])
    }
}
