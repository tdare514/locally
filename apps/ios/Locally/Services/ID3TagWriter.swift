import Foundation

/// A minimal, pure-Swift ID3v2.4 writer for mp3 files: no third-party
/// dependency, just enough of the spec to write the text frames Spotify's
/// Local Files reads (TIT2/TPE1/TPE2/TALB/TRCK/TDRC/TCON) plus one APIC
/// cover frame. Any existing ID3v2 header is stripped and replaced (never
/// stacked) so re-tagging in place keeps the file's audio bytes untouched.
/// Audio is streamed in fixed-size chunks; tag bodies are bounded by the
/// ID3v2.4 synchsafe size limit.
final class ID3TagWriter: TagWriter {
    /// Exclusive upper bound for any ID3v2.4 size field: 4 synchsafe bytes carry 28 bits.
    static let synchsafeLimit = 1 << 28

    /// True when `value` fits a 4-byte synchsafe integer.
    static func canEncodeSynchsafe(_ value: Int) -> Bool {
        value >= 0 && value < synchsafeLimit
    }

    /// Audio is copied in chunks of this size; peak memory is frames + one chunk.
    private static let copyChunkSize = 1 << 20 // 1 MiB

    /// Tag bodies (all frames together) must be strictly below this. Production uses
    /// `synchsafeLimit`; tests inject a small value so the rejection path runs on a few KB.
    private let tagBodyLimit: Int

    private let textEncodingUTF8: UInt8 = 0x03
    private let picEncodingLatin1: UInt8 = 0x00
    private let frontCoverPictureType: UInt8 = 0x03

    init(tagBodyLimit: Int = ID3TagWriter.synchsafeLimit) {
        self.tagBodyLimit = tagBodyLimit
    }

    func write(_ tags: TagSet, cover: Data?, to url: URL) async throws {
        let frames = buildFrames(tags: tags, cover: cover)
        guard frames.count < tagBodyLimit else {
            throw LocallyError.taggingFailed("That cover is too large to store in an mp3.")
        }
        let header = buildHeader(framesSize: frames.count)

        // Same directory as the target so `replaceItemAt` is a rename on the same volume,
        // and `.tmp` so Spotify's scanner never picks it up if the app dies mid-write.
        let tmp = url.deletingLastPathComponent()
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("tmp")

        do {
            try Self.assemble(header: header, frames: frames, audioFrom: url, into: tmp)
            _ = try FileManager.default.replaceItemAt(url, withItemAt: tmp)
        } catch let error as LocallyError {
            try? FileManager.default.removeItem(at: tmp)
            throw error
        } catch {
            try? FileManager.default.removeItem(at: tmp)
            throw LocallyError.taggingFailed(error.localizedDescription)
        }
    }

    /// Writes `header` + `frames` + the audio bytes of `source` (its existing ID3 header, if
    /// any, skipped) into `destination`, copying audio in `copyChunkSize` pieces.
    private static func assemble(header: Data, frames: Data, audioFrom source: URL, into destination: URL) throws {
        let input = try FileHandle(forReadingFrom: source)
        defer { try? input.close() }

        let fileLength = try input.seekToEnd()
        try input.seek(toOffset: 0)
        let prefix = try input.read(upToCount: 10) ?? Data()
        let skip = existingID3HeaderLength(prefix: prefix, fileLength: Int(clamping: fileLength))
        try input.seek(toOffset: UInt64(skip))

        guard FileManager.default.createFile(atPath: destination.path, contents: nil) else {
            throw CocoaError(.fileWriteUnknown)
        }
        let output = try FileHandle(forWritingTo: destination)

        try output.write(contentsOf: header)
        try output.write(contentsOf: frames)
        while let chunk = try input.read(upToCount: copyChunkSize), !chunk.isEmpty {
            try output.write(contentsOf: chunk)
        }
        try output.close()
    }

    // MARK: - Header

    private func buildHeader(framesSize: Int) -> Data {
        var header = Data()
        header.append(contentsOf: [0x49, 0x44, 0x33]) // "ID3"
        header.append(contentsOf: [0x04, 0x00])       // version 2.4.0
        header.append(0x00)                            // flags
        header.append(Self.synchsafe(framesSize))
        return header
    }

    // MARK: - Frames

    private func buildFrames(tags: TagSet, cover: Data?) -> Data {
        var frames = Data()
        frames.append(textFrame("TIT2", tags.title))
        frames.append(textFrame("TPE1", tags.artist))
        frames.append(textFrame("TPE2", tags.albumArtist))
        frames.append(textFrame("TALB", tags.album))
        frames.append(textFrame("TRCK", "\(tags.trackNumber)/\(tags.totalTracks)"))
        if let year = tags.year, !year.isEmpty {
            frames.append(textFrame("TDRC", year))
        }
        if let genre = tags.genre, !genre.isEmpty {
            frames.append(textFrame("TCON", genre))
        }
        if let cover, let apic = apicFrame(cover) {
            frames.append(apic)
        }
        return frames
    }

    private func textFrame(_ frameId: String, _ text: String) -> Data {
        var payload = Data()
        payload.append(textEncodingUTF8)
        payload.append(text.data(using: .utf8) ?? Data())
        return frame(frameId, payload: payload)
    }

    /// Guesses APIC's MIME type from the image's leading bytes (JPEG vs PNG)
    /// rather than trusting a filename that may not exist yet.
    private func apicFrame(_ imageData: Data) -> Data? {
        let mime = Self.mimeType(for: imageData)
        var payload = Data()
        payload.append(picEncodingLatin1)
        payload.append((mime + "\0").data(using: .isoLatin1) ?? Data())
        payload.append(frontCoverPictureType)
        payload.append(0x00) // empty description, null-terminated
        payload.append(imageData)
        return frame("APIC", payload: payload)
    }

    private func frame(_ frameId: String, payload: Data) -> Data {
        var out = Data()
        out.append(frameId.data(using: .ascii) ?? Data())
        out.append(Self.synchsafe(payload.count))
        out.append(contentsOf: [0x00, 0x00]) // flags
        out.append(payload)
        return out
    }

    // MARK: - Helpers

    static func mimeType(for data: Data) -> String {
        if data.count >= 8, data[data.startIndex] == 0x89, data[data.startIndex + 1] == 0x50 {
            return "image/png"
        }
        return "image/jpeg"
    }

    /// 4-byte synchsafe integer: each byte carries 7 bits, MSB always 0.
    static func synchsafe(_ value: Int) -> Data {
        var v = UInt32(value)
        var bytes = [UInt8](repeating: 0, count: 4)
        for i in stride(from: 3, through: 0, by: -1) {
            bytes[i] = UInt8(v & 0x7F)
            v >>= 7
        }
        return Data(bytes)
    }

    static func desynchsafe(_ bytes: [UInt8]) -> Int {
        var value = 0
        for byte in bytes {
            value = (value << 7) | Int(byte & 0x7F)
        }
        return value
    }

    /// Byte count of a usable ID3v2 header at the start of a file whose first (up to) 10 bytes
    /// are `prefix` and whose total length is `fileLength`; 0 when there is none or it cannot
    /// be trusted (too short, no "ID3" magic, or a declared size that runs past the file).
    static func existingID3HeaderLength(prefix: Data, fileLength: Int) -> Int {
        guard prefix.count >= 10 else { return 0 }
        let bytes = [UInt8](prefix.prefix(10))
        guard bytes[0] == 0x49, bytes[1] == 0x44, bytes[2] == 0x33 else { return 0 }
        let framesSize = desynchsafe(Array(bytes[6...9]))
        let totalHeaderSize = 10 + framesSize
        guard totalHeaderSize <= fileLength else { return 0 }
        return totalHeaderSize
    }

    /// Returns just the audio bytes: if `data` starts with an "ID3" header,
    /// skip past it (header + declared frames size); otherwise return as-is.
    static func stripExistingID3Header(from data: Data) -> Data {
        let skip = existingID3HeaderLength(prefix: data.prefix(10), fileLength: data.count)
        return data.suffix(from: data.startIndex + skip)
    }
}
