import Foundation

/// A minimal, pure-Swift ID3v2.4 writer for mp3 files: no third-party
/// dependency, just enough of the spec to write the text frames Spotify's
/// Local Files reads (TIT2/TPE1/TPE2/TALB/TRCK/TDRC/TCON) plus one APIC
/// cover frame. Any existing ID3v2 header is stripped and replaced (never
/// stacked) so re-tagging in place keeps the file's audio bytes untouched.
final class ID3TagWriter: TagWriter {
    private let textEncodingUTF8: UInt8 = 0x03
    private let picEncodingLatin1: UInt8 = 0x00
    private let frontCoverPictureType: UInt8 = 0x03

    func write(_ tags: TagSet, cover: Data?, to url: URL) async throws {
        let original: Data
        do {
            original = try Data(contentsOf: url)
        } catch {
            throw LocallyError.taggingFailed(error.localizedDescription)
        }

        let audio = Self.stripExistingID3Header(from: original)
        let frames = buildFrames(tags: tags, cover: cover)
        let header = buildHeader(framesSize: frames.count)

        var output = Data()
        output.append(header)
        output.append(frames)
        output.append(audio)

        do {
            try output.write(to: url, options: .atomic)
        } catch {
            throw LocallyError.taggingFailed(error.localizedDescription)
        }
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

    /// Returns just the audio bytes: if `data` starts with an "ID3" header,
    /// skip past it (header + declared frames size); otherwise return as-is.
    static func stripExistingID3Header(from data: Data) -> Data {
        guard data.count >= 10 else { return data }
        let bytes = [UInt8](data.prefix(10))
        guard bytes[0] == 0x49, bytes[1] == 0x44, bytes[2] == 0x33 else { return data }
        let framesSize = desynchsafe(Array(bytes[6...9]))
        let totalHeaderSize = 10 + framesSize
        guard totalHeaderSize <= data.count else { return data }
        return data.suffix(from: data.startIndex + totalHeaderSize)
    }
}
