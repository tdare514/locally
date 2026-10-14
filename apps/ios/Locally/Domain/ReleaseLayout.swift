import Foundation

/// Pure, I/O-free rules for turning release metadata into filesystem names.
/// Kept separate from `ReleaseCoordinator` so naming/sanitising can be unit
/// tested without touching disk, and so every user-derived path segment in
/// the app goes through one reviewable place. Mirrors the Mac app's
/// `ReleaseLayout` and `spec/metadata.md`'s sanitising rules; iOS lays files
/// out flat because Spotify's Local Files folder is scanned flat.
struct ReleaseLayout {
    /// Longest sanitised segment, in Unicode code points. Mirrors the Mac app's `MAX_SEGMENT_LENGTH`.
    static let maxSegmentLength = 200

    /// Longest sanitised segment, in UTF-8 bytes: the 255-byte filename limit less 16 bytes
    /// reserved for an extension or a " (n)" suffix. Mirrors the Mac app.
    static let maxSegmentBytes = 255 - 16

    /// Characters that are illegal or troublesome in file names on common filesystems.
    private static let illegalScalars: Set<Unicode.Scalar> = Set("/\\:*?\"<>|".unicodeScalars)

    /// Whitespace as JavaScript's `\s` defines it, so both apps trim the same set.
    private static let whitespaceScalars: Set<UInt32> = [
        0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680,
        0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A,
        0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
    ]

    /// Sanitize a single path segment (artist/album/track name) for safe use
    /// as part of a filename, by the rule in `spec/metadata.md`: remove control
    /// and invisible reordering characters and `/ \ : * ? " < > |`, strip
    /// leading and trailing dots and whitespace, cap at `maxSegmentLength` code
    /// points and `maxSegmentBytes` UTF-8 bytes on whole grapheme clusters,
    /// strip trailing dots and whitespace again, and fall back to "Unknown" if
    /// the result is empty. Mirrors the Mac app's `sanitizeSegment`.
    func sanitizeSegment(_ segment: String?) -> String {
        var scalars = Array((segment ?? "").unicodeScalars.filter { !Self.isRemoved($0) })
        let isTrimmable: (Unicode.Scalar) -> Bool = {
            $0 == "." || Self.whitespaceScalars.contains($0.value)
        }
        while let first = scalars.first, isTrimmable(first) { scalars.removeFirst() }
        while let last = scalars.last, isTrimmable(last) { scalars.removeLast() }

        var capped = String.UnicodeScalarView()
        var scalarCount = 0
        var byteCount = 0
        var view = String.UnicodeScalarView()
        view.append(contentsOf: scalars)
        for character in String(view) {
            scalarCount += character.unicodeScalars.count
            byteCount += character.utf8.count
            if scalarCount > Self.maxSegmentLength || byteCount > Self.maxSegmentBytes { break }
            capped.append(contentsOf: character.unicodeScalars)
        }
        var result = Array(capped)
        while let last = result.last, isTrimmable(last) { result.removeLast() }

        var out = String.UnicodeScalarView()
        out.append(contentsOf: result)
        let cleaned = String(out)
        return cleaned.isEmpty ? "Unknown" : cleaned
    }

    /// Control characters, invisible reordering characters and the illegal
    /// file name characters: steps 2 to 4 of the sanitising rule.
    private static func isRemoved(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x00...0x1F, 0x7F, 0x061C, 0x200B...0x200F, 0x202A...0x202E, 0x2066...0x2069, 0xFEFF:
            return true
        default:
            return illegalScalars.contains(scalar)
        }
    }

    /// The flat filename for a track inside the Spotify folder:
    /// `"<Artist> - <Album> - <NN> - <Title>.<ext>"`.
    func fileName(artist: String?, album: String?, trackNumber: Int, title: String?, ext: String) -> String {
        let a = sanitizeSegment(artist)
        let al = sanitizeSegment(album)
        let t = sanitizeSegment(title)
        let n = pad2(trackNumber)
        return "\(a) - \(al) - \(n) - \(t).\(ext)"
    }

    /// Whether `path` names a location strictly inside `folder` (a proper
    /// descendant). Resolves `.`/`..` components lexically via
    /// `standardizedFileURL` — no disk access, so it works for paths that no
    /// longer exist — meaning a traversal like `<folder>/../elsewhere`
    /// correctly reports `false` even though the raw string starts with
    /// the folder's path. The folder itself is not "inside" itself: this
    /// exists to gate deletes/rewrites of *tracks*, and a track path should
    /// never equal the folder that contains it.
    func isInside(folder: URL, path: String) -> Bool {
        let folderPath = folder.standardizedFileURL.path
        let targetPath = URL(fileURLWithPath: path).standardizedFileURL.path
        guard targetPath != folderPath else { return false }
        let prefix = folderPath.hasSuffix("/") ? folderPath : folderPath + "/"
        return targetPath.hasPrefix(prefix)
    }

    /// Longest name `isPlainFileName` accepts: the filename limit on every common filesystem.
    static let maxPlainFileNameLength = 255

    /// True only for a name that, appended to any directory, can point at
    /// nothing but a direct child of it: no separators, not `.`/`..` or any
    /// other leading-dot name, no control characters, within the length
    /// limit. Sync record file names (`SyncTrack.file`, `SyncRecord.cover`)
    /// arrive from the network and are used as path components by
    /// `SyncEngine` and `ReleaseCoordinator.importSynced`, so anything else is
    /// refused rather than repaired: the name has to match a stored object.
    /// Mirrors the Mac app's `isPlainSyncName`.
    static func isPlainFileName(_ name: String) -> Bool {
        guard !name.isEmpty, name.utf8.count <= maxPlainFileNameLength else { return false }
        guard !name.hasPrefix(".") else { return false }
        for scalar in name.unicodeScalars {
            if scalar == "/" || scalar == "\\" { return false }
            if scalar.value < 0x20 || scalar.value == 0x7F { return false }
        }
        return true
    }

    private func pad2(_ n: Int) -> String {
        n < 10 ? "0\(n)" : "\(n)"
    }
}
