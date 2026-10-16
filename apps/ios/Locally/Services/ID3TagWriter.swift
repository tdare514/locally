import Foundation

/// A minimal, pure-Swift ID3v2.4 writer for mp3 files: no third-party
/// dependency, just enough of the spec to write the text frames Spotify's
/// Local Files reads (TIT2/TPE1/TPE2/TALB/TRCK/TDRC/TYER/TCON, and TPOS on a
/// multi-disc release) plus one APIC
/// cover frame. Any existing ID3v2 header is replaced (never stacked) so re-tagging
/// in place keeps the file's audio bytes untouched; frames Locally doesn't own (composer,
/// lyrics, BPM, comment, other pictures...) are carried over into the new tag.
/// Audio is streamed in fixed-size chunks; tag bodies are bounded by the
/// ID3v2.4 synchsafe size limit.
final class ID3TagWriter: TagWriter {
    /// Exclusive upper bound for any ID3v2.4 size field: 4 synchsafe bytes carry 28 bits.
    static let synchsafeLimit = 1 << 28

    /// True when `value` fits a 4-byte synchsafe integer.
    static func canEncodeSynchsafe(_ value: Int) -> Bool {
        value >= 0 && value < synchsafeLimit
    }

    /// An existing tag larger than this is refused rather than read into memory; the file is
    /// left untouched.
    static let maxKeptTagBytes = 32 * 1024 * 1024

    /// Frames Locally writes itself; an existing copy is replaced, never carried over.
    private static let ownedFrameIds: Set<String> = [
        "TIT2", "TPE1", "TPE2", "TALB", "TRCK", "TPOS", "TDRC", "TYER", "TCON"
    ]

    /// Audio is copied in chunks of this size; peak memory is frames + one chunk.
    private static let copyChunkSize = 1 << 20 // 1 MiB

    /// Swaps `replacement` over `original` in place. Injected so tests can
    /// make the swap fail without touching the real file system call.
    typealias ReplaceItem = (_ original: URL, _ replacement: URL) throws -> Void

    /// Tag bodies (all frames together) must be strictly below this. Production uses
    /// `synchsafeLimit`; tests inject a small value so the rejection path runs on a few KB.
    /// Clamped to `synchsafeLimit`, so an injected limit can never exceed what four
    /// synchsafe bytes encode.
    let tagBodyLimit: Int

    private let replaceItem: ReplaceItem

    private let textEncodingUTF8: UInt8 = 0x03
    private let picEncodingLatin1: UInt8 = 0x00
    private let frontCoverPictureType: UInt8 = 0x03

    init(
        tagBodyLimit: Int = ID3TagWriter.synchsafeLimit,
        replaceItem: @escaping ReplaceItem = { original, replacement in
            _ = try FileManager.default.replaceItemAt(original, withItemAt: replacement)
        }
    ) {
        // Clamp so an injected limit can never exceed what four synchsafe bytes encode.
        self.tagBodyLimit = min(tagBodyLimit, ID3TagWriter.synchsafeLimit)
        self.replaceItem = replaceItem
    }

    func write(_ tags: TagSet, cover: Data?, to url: URL) async throws {
        var frames = buildFrames(tags: tags, cover: cover)
        let kept = try Self.keptFrames(from: url)
        if !kept.isEmpty {
            frames.append(kept)
            // Never quietly drop the person's other tags: refuse, with the file untouched.
            guard Self.canEncodeSynchsafe(frames.count), frames.count < tagBodyLimit else {
                throw LocallyError.taggingFailed(Copy.FileErrors.existingTagTooLarge)
            }
        }
        guard Self.canEncodeSynchsafe(frames.count), frames.count < tagBodyLimit else {
            throw LocallyError.taggingFailed(Copy.FileErrors.coverTooLargeForMp3)
        }
        let header = buildHeader(framesSize: frames.count)

        // Same directory as the target so `replaceItemAt` is a rename on the same volume,
        // and `.tmp` so Spotify's scanner never picks it up if the app dies mid-write.
        let tmp = url.deletingLastPathComponent()
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("tmp")

        do {
            try Self.assemble(header: header, frames: frames, audioFrom: url, into: tmp)
            try replaceItem(url, tmp)
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
        if let discNumber = tags.discNumber, let totalDiscs = tags.totalDiscs {
            frames.append(textFrame("TPOS", "\(discNumber)/\(totalDiscs)"))
        }
        if let year = tags.year, !year.isEmpty {
            frames.append(textFrame("TDRC", year))
            // Spotify reads an mp3's year only from TYER, so a plain 4-digit year goes there too.
            if Self.isFourDigitYear(year) {
                frames.append(latin1TextFrame("TYER", year))
            }
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

    /// A text frame in ISO-8859-1 (encoding byte 0x00), the one encoding every ID3 reader
    /// supports. Used for TYER, whose 4 ASCII digits are the same bytes in either encoding.
    private func latin1TextFrame(_ frameId: String, _ text: String) -> Data {
        var payload = Data([0x00])
        payload.append(text.data(using: .isoLatin1) ?? Data())
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

    static func isFourDigitYear(_ text: String) -> Bool {
        let bytes = Array(text.utf8)
        return bytes.count == 4 && bytes.allSatisfy { $0 >= 0x30 && $0 <= 0x39 }
    }

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

    // MARK: - Carrying over frames Locally doesn't own

    /// The existing ID3v2 tag's frames that Locally doesn't own, re-encoded for the v2.4 tag
    /// the writer produces (id, synchsafe size, flags, payload). Reads only the tag's own
    /// bytes from the front of the file. Throws only when the tag is over `maxKeptTagBytes`
    /// (before reading it); any other trouble yields the frames parsed so far, or none.
    static func keptFrames(from url: URL) throws -> Data {
        guard let input = try? FileHandle(forReadingFrom: url) else { return Data() }
        defer { try? input.close() }
        guard let fileLength = try? input.seekToEnd(), (try? input.seek(toOffset: 0)) != nil,
              let prefix = try? input.read(upToCount: 10) else { return Data() }
        let total = existingID3HeaderLength(prefix: prefix, fileLength: Int(clamping: fileLength))
        guard total > 10 else { return Data() }
        guard total - 10 <= maxKeptTagBytes else {
            throw LocallyError.taggingFailed(Copy.FileErrors.existingTagTooLarge)
        }
        guard (try? input.seek(toOffset: 0)) != nil,
              let tag = try? input.read(upToCount: total), tag.count == total else { return Data() }
        return keptFrames(fromTag: tag)
    }

    /// `tag` is a whole ID3v2 tag: the 10-byte header plus its body.
    static func keptFrames(fromTag tag: Data) -> Data {
        var buf = [UInt8](tag)
        guard buf.count > 10 else { return Data() }
        let major = buf[3]
        guard major == 3 || major == 4 else { return Data() } // v2.2 has 3-character ids: keep nothing
        let tagFlags = buf[5]
        var offset = 10

        if major == 3, tagFlags & 0x80 != 0 { // tag-level unsynchronisation
            buf = reverseUnsynchronisation(buf[10...])
            offset = 0
        }

        if tagFlags & 0x40 != 0 { // extended header: skip it
            guard buf.count - offset >= 4 else { return Data() }
            let sizeBytes = Array(buf[offset..<(offset + 4)])
            let skip = major == 3
                ? 4 + plainInt(sizeBytes)        // v2.3: plain size, excludes itself
                : desynchsafe(sizeBytes)         // v2.4: synchsafe, includes itself
            guard skip >= 4, skip <= buf.count - offset else { return Data() }
            offset += skip
        }

        var kept = Data()
        while offset + 10 <= buf.count {
            if buf[offset] == 0 { break } // padding
            let idBytes = buf[offset..<(offset + 4)]
            guard idBytes.allSatisfy({ ($0 >= 0x41 && $0 <= 0x5A) || ($0 >= 0x30 && $0 <= 0x39) }),
                  let id = String(bytes: idBytes, encoding: .ascii) else { break }
            let sizeBytes = Array(buf[(offset + 4)..<(offset + 8)])
            let size = major == 3 ? plainInt(sizeBytes) : desynchsafe(sizeBytes)
            let status = buf[offset + 8]
            let format = buf[offset + 9]
            let start = offset + 10
            guard size >= 0, size <= buf.count - start else { break }
            let end = start + size
            offset = end

            let frame = major == 3
                ? convertV23Frame(id: id, status: status, format: format, in: buf, start: start, end: end)
                : convertV24Frame(id: id, status: status, format: format, in: buf, start: start, end: end)
            guard let frame else { continue }
            kept.append(contentsOf: idBytes)
            kept.append(synchsafe(frame.prefix.count + frame.data.count))
            kept.append(contentsOf: [0x00, frame.format])
            kept.append(contentsOf: frame.prefix)
            kept.append(contentsOf: frame.data)
        }
        return kept
    }

    /// A frame ready to write into the v2.4 tag: its format-flag byte, the extra bytes that
    /// follow the header (group id, encryption method, data length indicator) and the data.
    private struct OutFrame {
        var format: UInt8
        var prefix: [UInt8]
        var data: ArraySlice<UInt8>
    }

    /// v2.3 frame to v2.4 layout. Nil drops the frame: discard-when-altered, owned, or extra
    /// bytes that don't fit. Compressed and encrypted data is carried as it is.
    private static func convertV23Frame(id: String, status: UInt8, format: UInt8, in buf: [UInt8], start: Int, end: Int) -> OutFrame? {
        if status & 0x80 != 0 { return nil }
        let compressed = format & 0x80 != 0, encrypted = format & 0x40 != 0, grouped = format & 0x20 != 0
        var pos = start
        var decompressedSize = 0
        var method: UInt8 = 0, group: UInt8 = 0
        if compressed {
            guard end - pos >= 4 else { return nil }
            decompressedSize = plainInt(Array(buf[pos..<(pos + 4)]))
            pos += 4
        }
        if encrypted { guard pos < end else { return nil }; method = buf[pos]; pos += 1 }
        if grouped { guard pos < end else { return nil }; group = buf[pos]; pos += 1 }
        let data = buf[pos..<end]
        if !compressed, !encrypted, isOwned(id: id, data: data) { return nil }
        if ownedFrameIds.contains(id) { return nil }

        var out = OutFrame(format: 0, prefix: [], data: data)
        if grouped { out.format |= 0x40; out.prefix.append(group) }
        if encrypted { out.format |= 0x04; out.prefix.append(method) }
        if compressed {
            guard canEncodeSynchsafe(decompressedSize) else { return nil }
            out.format |= 0x09
            out.prefix.append(contentsOf: synchsafe(decompressedSize))
        }
        return out
    }

    /// v2.4 frame, flags cleaned: unsynchronisation is undone only on frames that are neither
    /// compressed nor encrypted; the data length indicator is kept only with compression.
    private static func convertV24Frame(id: String, status: UInt8, format: UInt8, in buf: [UInt8], start: Int, end: Int) -> OutFrame? {
        if status & 0x40 != 0 { return nil }
        let grouped = format & 0x40 != 0, compressed = format & 0x08 != 0
        let encrypted = format & 0x04 != 0, unsynced = format & 0x02 != 0, hasLength = format & 0x01 != 0
        if compressed && !hasLength { return nil }
        // Per-frame unsynchronisation covers everything after the frame header (group id,
        // method, length indicator and data), so a plain frame is de-unsynchronised whole
        // before its extra fields are read. A compressed or encrypted one is kept as it is.
        let undo = unsynced && !compressed && !encrypted
        let body: [UInt8] = undo ? reverseUnsynchronisation(buf[start..<end]) : Array(buf[start..<end])
        var pos = 0
        var out = OutFrame(format: 0, prefix: [], data: [])
        if grouped { guard pos < body.count else { return nil }; out.format |= 0x40; out.prefix.append(body[pos]); pos += 1 }
        if encrypted { guard pos < body.count else { return nil }; out.format |= 0x04; out.prefix.append(body[pos]); pos += 1 }
        if hasLength {
            guard body.count - pos >= 4 else { return nil }
            if compressed || encrypted { // the indicator stays with data we can't read
                out.format |= 0x01
                out.prefix.append(contentsOf: body[pos..<(pos + 4)])
            }
            pos += 4
        }
        if compressed { out.format |= 0x08 }
        if unsynced && !undo { out.format |= 0x02 }
        out.data = body[pos...]
        if !compressed, !encrypted, isOwned(id: id, data: out.data) { return nil }
        if ownedFrameIds.contains(id) { return nil }
        return out
    }

    /// True for the front-cover APIC (the only owned frame that needs its data read).
    private static func isOwned(id: String, data: ArraySlice<UInt8>) -> Bool {
        guard id == "APIC", data.count > 2,
              let mimeEnd = data[(data.startIndex + 1)...].firstIndex(of: 0), mimeEnd + 1 < data.endIndex else { return false }
        return data[mimeEnd + 1] == 0x03
    }

    private static func plainInt(_ bytes: [UInt8]) -> Int {
        bytes.reduce(0) { ($0 << 8) | Int($1) }
    }

    /// Undoes unsynchronisation: every 0xFF 0x00 becomes 0xFF.
    private static func reverseUnsynchronisation(_ bytes: ArraySlice<UInt8>) -> [UInt8] {
        var out: [UInt8] = []
        out.reserveCapacity(bytes.count)
        var i = bytes.startIndex
        while i < bytes.endIndex {
            out.append(bytes[i])
            if bytes[i] == 0xFF, i + 1 < bytes.endIndex, bytes[i + 1] == 0x00 { i += 1 }
            i += 1
        }
        return out
    }
}
