import Foundation
import Testing
@testable import Locally

private final class BundleToken {}

/// Re-tags a real ffmpeg-made m4a (standard extras plus a custom freeform atom) and compares
/// the raw `ilst` atoms before and after, so atoms AVFoundation doesn't model are checked too (#235).
struct M4ARawAtomTests {
    private static let ownedKeys: Set<String> = ["\u{A9}nam", "\u{A9}ART", "aART", "\u{A9}alb", "trkn", "disk", "\u{A9}day", "\u{A9}gen", "gnre", "covr"]

    /// One ilst child: its key and the raw bytes of its `data` payload(s).
    struct Atom: Hashable, CustomStringConvertible {
        let key: String
        let data: [UInt8]
        var description: String { "\(key)=\(data.count)B" }
    }

    private static func children(_ b: [UInt8], _ start: Int, _ end: Int) -> [(type: String, body: Range<Int>)] {
        var out: [(String, Range<Int>)] = []
        var s = start
        while s + 8 <= end {
            var n = Int(b[s]) << 24 | Int(b[s + 1]) << 16 | Int(b[s + 2]) << 8 | Int(b[s + 3])
            var header = 8
            if n == 0 { n = end - s } // runs to the end
            if n == 1, s + 16 <= end { // 64-bit size follows the type
                n = b[(s + 8)..<(s + 16)].reduce(0) { ($0 << 8) | Int($1) }
                header = 16
            }
            guard n >= header, s + n <= end else { break }
            out.append((String(decoding: b[(s + 4)..<(s + 8)].map { $0 == 0xA9 ? 0x40 : $0 }, as: UTF8.self)
                .replacingOccurrences(of: "@", with: "\u{A9}"), (s + header)..<(s + n)))
            s += n
        }
        return out
    }

    /// moov > udta > meta (4-byte version/flags) > ilst, each child as a key plus data bytes.
    static func ilstAtoms(of url: URL) throws -> [Atom] {
        let b = [UInt8](try Data(contentsOf: url))
        var range = 0..<b.count
        for (name, skip) in [("moov", 0), ("udta", 0), ("meta", 4), ("ilst", 0)] {
            let found = try #require(children(b, range.lowerBound, range.upperBound).first { $0.type == name }, "no \(name) in \(url.lastPathComponent); have \(children(b, range.lowerBound, range.upperBound).map(\.type))")
            range = (found.body.lowerBound + skip)..<found.body.upperBound
        }
        return children(b, range.lowerBound, range.upperBound).map { child in
            let parts = children(b, child.body.lowerBound, child.body.upperBound)
            let datas = parts.filter { $0.type == "data" }.flatMap { b[$0.body] }
            if child.type == "----" {
                func text(_ t: String) -> String {
                    guard let p = parts.first(where: { $0.type == t }) else { return "" }
                    return String(decoding: b[(p.body.lowerBound + 4)..<p.body.upperBound], as: UTF8.self)
                }
                return Atom(key: "----:\(text("mean")):\(text("name"))", data: Array(datas))
            }
            return Atom(key: child.type, data: Array(datas))
        }
    }

    @Test func retaggingKeepsEveryAtomLocallyDoesNotOwnByteForByte() async throws {
        let fixture = try #require(Bundle(for: BundleToken.self).url(forResource: "extras", withExtension: "m4a"))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("M4ARawAtomTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("song.m4a")
        try FileManager.default.copyItem(at: fixture, to: url)

        let before = try Self.ilstAtoms(of: url)
        let keys = Set(before.map(\.key))
        for key in ["\u{A9}wrt", "\u{A9}lyr", "tmpo", "cpil", "\u{A9}cmt", "\u{A9}grp", "----:com.apple.iTunes:LOCALLY_TEST"] {
            #expect(keys.contains(key), "fixture lacks \(key)")
        }

        let tags = TagSet(title: "New Title", artist: "New Artist", album: "New Album", trackNumber: 1, totalTracks: 1, year: "2026")
        try await M4ATagWriter().write(tags, cover: nil, to: url)

        let after = try Self.ilstAtoms(of: url)
        let keptBefore = before.filter { !Self.ownedKeys.contains($0.key) }
        let keptAfter = after.filter { !Self.ownedKeys.contains($0.key) }
        let lost = keptBefore.filter { !keptAfter.contains($0) }
        #expect(lost.isEmpty, "lost: \(lost) ; after: \(after)")
        #expect(keptAfter.filter { keptBefore.contains($0) }.count == keptBefore.count)
        // Owned atoms are replaced once, not stacked.
        for key in ["\u{A9}nam", "\u{A9}ART", "\u{A9}alb", "\u{A9}day"] {
            #expect(after.filter { $0.key == key }.count == 1, "\(key)")
        }
        #expect(String(decoding: after.first { $0.key == "\u{A9}nam" }?.data.dropFirst(8) ?? [], as: UTF8.self) == "New Title")
    }
}
