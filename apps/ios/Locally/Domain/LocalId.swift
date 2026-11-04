import Foundation

/// The `spotify:local:artist:album:title:seconds` id Spotify builds for a local file from its own tags
/// and length (#332 step 1). A byte-for-byte port of the Mac's `buildLocalId`
/// (`apps/web/src/server/adopt/localId.ts`); both apps run the shared cases in
/// `spec/fixtures/local-id/`. A copied file is byte-identical, so the same id names the same song on
/// every device, which is how a second device links to a release instead of adopting it again.
enum LocalId {
    static let prefix = "spotify:local:"

    /// Each segment is percent-encoded the way JavaScript's `encodeURIComponent` does it (UTF-8 bytes,
    /// everything but `A-Z a-z 0-9 - _ . ! ~ * ' ( )`), with `+` for a space. The length is cut down to
    /// whole seconds, never rounded up. Tags are used exactly as given: callers trim and normalise.
    static func build(artist: String, album: String, title: String, durationSec: Double) -> String {
        let seconds: Int
        if durationSec.isFinite {
            seconds = Int(min(max(0, durationSec.rounded(.down)), Double(Int32.max)))
        } else {
            seconds = 0
        }
        return "\(prefix)\(encodeSegment(artist)):\(encodeSegment(album)):\(encodeSegment(title)):\(seconds)"
    }

    private static let hex = Array("0123456789ABCDEF")

    private static func isUnreserved(_ byte: UInt8) -> Bool {
        switch byte {
        case 0x41...0x5A, 0x61...0x7A, 0x30...0x39: return true // A-Z a-z 0-9
        case 0x2D, 0x5F, 0x2E, 0x21, 0x7E, 0x2A, 0x27, 0x28, 0x29: return true // - _ . ! ~ * ' ( )
        default: return false
        }
    }

    static func encodeSegment(_ segment: String) -> String {
        var out = ""
        for byte in segment.utf8 {
            if isUnreserved(byte) {
                out.unicodeScalars.append(Unicode.Scalar(byte))
            } else if byte == 0x20 {
                out += "+"
            } else {
                out += "%"
                out.append(hex[Int(byte >> 4)])
                out.append(hex[Int(byte & 0x0F)])
            }
        }
        return out
    }
}
