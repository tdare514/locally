import Foundation

/// Pure, I/O-free rules for turning release metadata into filesystem names.
/// Kept separate from `ReleaseCoordinator` so naming/sanitising can be unit
/// tested without touching disk, and so every user-derived path segment in
/// the app goes through one reviewable place. Mirrors the Mac app's
/// `ReleaseLayout` and `spec/metadata.md`'s sanitising rules; iOS lays files
/// out flat because Spotify's Local Files folder is scanned flat.
struct ReleaseLayout {
    /// Sanitize a single path segment (artist/album/track name) for safe use
    /// as part of a filename. Strips characters illegal or troublesome
    /// across common filesystems, trims whitespace/dots, and falls back to
    /// "Unknown" if the result is empty.
    func sanitizeSegment(_ segment: String?) -> String {
        let raw = segment ?? ""
        let illegal = CharacterSet(charactersIn: "/\\:*?\"<>|")
        let stripped = raw.unicodeScalars
            .filter { !illegal.contains($0) }
            .map(String.init)
            .joined()
            .trimmingCharacters(in: .whitespaces)
        let cleaned = trimTrailingDotsAndSpaces(stripped)
        return cleaned.isEmpty ? "Unknown" : cleaned
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

    private func pad2(_ n: Int) -> String {
        n < 10 ? "0\(n)" : "\(n)"
    }

    private func trimTrailingDotsAndSpaces(_ s: String) -> String {
        var result = Substring(s)
        while let last = result.last, last == "." || last == " " {
            result = result.dropLast()
        }
        return String(result)
    }
}
