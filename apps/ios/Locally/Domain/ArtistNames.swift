import Foundation

/// The artist-name rules (issue #286), specified once in
/// `spec/artist-names.md` and ported from the web's `artist-names.ts`.
/// Every case in `spec/fixtures/artists/` runs against both.
enum ArtistNames {
    /// Same artist = same key.
    static func artistKey(_ name: String) -> String {
        var kept = String.UnicodeScalarView()
        let decomposed = name.decomposedStringWithCompatibilityMapping.lowercased()
        for scalar in decomposed.unicodeScalars {
            switch scalar.value {
            case 0x0300...0x036F:
                continue
            case 0x26, 0x2B: // & +
                kept.append(contentsOf: " and ".unicodeScalars)
            default:
                switch scalar.properties.generalCategory {
                case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
                     .decimalNumber, .letterNumber, .otherNumber,
                     .nonspacingMark, .spacingMark, .enclosingMark:
                    kept.append(scalar)
                default:
                    kept.append(" ")
                }
            }
        }
        // Collapse and trim U+0020 over scalars: a space followed by a combining
        // mark is one Character, so a Character-wise split would keep it.
        var collapsed = String.UnicodeScalarView()
        for scalar in kept {
            if scalar == " " && (collapsed.isEmpty || collapsed.last == " ") { continue }
            collapsed.append(scalar)
        }
        if collapsed.last == " " { collapsed.removeLast() }
        return String(collapsed)
    }

    /// True when two different names might be the same artist.
    static func looksLike(_ a: String, _ b: String) -> Bool {
        let keyA = artistKey(a)
        let keyB = artistKey(b)
        if keyA == keyB { return false }
        let bareA = stripThe(keyA)
        if !bareA.isEmpty && bareA == stripThe(keyB) { return true }
        let charsA = Array(keyA.unicodeScalars)
        let charsB = Array(keyB.unicodeScalars)
        let shortest = min(charsA.count, charsB.count)
        if shortest >= 5 {
            let distance = editDistance(charsA, charsB)
            if distance <= 1 { return true }
            if shortest >= 10 && distance <= 2 { return true }
        }
        return isKeyPlusJoiningPart(keyA, keyB) || isKeyPlusJoiningPart(keyB, keyA)
    }

    /// "Song (feat. B & C)" becomes title "Song" with featuring ["B", "C"].
    static func splitFeaturing(_ title: String) -> (title: String, featuring: [String]) {
        let result = splitWith(title, bareTitleFeaturing)
        return (result.rest, result.featuring)
    }

    /// The inverse of `splitFeaturing`: "Song (feat. B & C)".
    static func joinFeaturing(_ title: String, _ names: [String]) -> String {
        guard let last = names.last else { return title }
        let joined = names.count == 1
            ? last
            : names.dropLast().joined(separator: ", ") + " & " + last
        return "\(title) (feat. \(joined))"
    }

    /// An imported artist tag "A feat. B" becomes artist "A" featuring ["B"].
    /// Never splits on "&" alone.
    static func splitArtistFeaturing(_ artist: String) -> (artist: String, featuring: [String]) {
        let result = splitWith(artist, wordArtistFeaturing)
        return (result.rest, result.featuring)
    }

    // MARK: - Private

    private static let joiningWords = ["feat", "ft", "featuring", "and", "with"]

    private static func stripThe(_ key: String) -> String {
        key.hasPrefix("the ") ? String(key.dropFirst(4)) : key
    }

    private static func isKeyPlusJoiningPart(_ shorter: String, _ longer: String) -> Bool {
        guard longer.hasPrefix(shorter + " ") else { return false }
        let rest = longer.dropFirst(shorter.count + 1).split(separator: " ", omittingEmptySubsequences: false)
        return joiningWords.contains(String(rest[0])) && rest.count > 1
    }

    private static func editDistance(_ a: [Unicode.Scalar], _ b: [Unicode.Scalar]) -> Int {
        var previous = Array(0...b.count)
        for i in 1...max(a.count, 1) where i <= a.count {
            var current = [i]
            for j in 1...max(b.count, 1) where j <= b.count {
                let cost = a[i - 1] == b[j - 1] ? 0 : 1
                current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost))
            }
            previous = current
        }
        return previous[b.count]
    }

    private static func splitNames(_ text: String) -> [String] {
        text.replacingOccurrences(of: " & ", with: ", ")
            .components(separatedBy: ", ")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    // swiftlint:disable force_try
    private static let bareTitleFeaturing = try! NSRegularExpression(
        pattern: #"\s+(?:feat|ft)\.\s+(.+)$"#, options: [.caseInsensitive])
    private static let wordArtistFeaturing = try! NSRegularExpression(
        pattern: #"\s+(?:featuring|feat|ft)(?:\.\s*|\s+)(.+)$"#, options: [.caseInsensitive])
    // swiftlint:enable force_try

    private static let featuringMarkers = ["featuring", "feat", "ft"]

    private static func asciiLower(_ scalar: Unicode.Scalar) -> Unicode.Scalar {
        (scalar.value >= 0x41 && scalar.value <= 0x5A) ? Unicode.Scalar(scalar.value + 32)! : scalar
    }

    /// A trailing "(feat. ...)" or "[feat. ...]". The group is found by matching
    /// brackets, so brackets inside a name survive: "Song (feat. (G)I-DLE)". The
    /// marker must be followed by ".", a space or the end. Works on scalars so it
    /// agrees with the web version.
    private static func splitBracketFeaturing(_ text: String) -> (rest: String, featuring: [String])? {
        var scalars = Array(text.unicodeScalars)
        while let last = scalars.last, Character(last).isWhitespace { scalars.removeLast() }
        guard let closer = scalars.last, closer == ")" || closer == "]" else { return nil }
        var depth = 0
        for index in stride(from: scalars.count - 1, through: 0, by: -1) {
            let char = scalars[index]
            if char == ")" || char == "]" {
                depth += 1
            } else if char == "(" || char == "[" {
                depth -= 1
            } else {
                continue
            }
            if depth != 0 { continue }
            if char != (closer == ")" ? "(" : "[") { return nil }
            var inner = Array(scalars[(index + 1)..<(scalars.count - 1)])
            while let first = inner.first, Character(first).isWhitespace { inner.removeFirst() }
            for marker in featuringMarkers
            where inner.prefix(marker.count).map(asciiLower) == Array(marker.unicodeScalars) {
                if inner.count > marker.count {
                    let next = inner[marker.count]
                    if next != "." && next != " " { continue }
                }
                var rest = Array(inner.dropFirst(marker.count))
                if rest.first == "." { rest.removeFirst() }
                let names = splitNames(String(String.UnicodeScalarView(rest)))
                let head = String(String.UnicodeScalarView(scalars[0..<index]))
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                return (!head.isEmpty && !names.isEmpty) ? (head, names) : nil
            }
            return nil
        }
        return nil
    }

    private static func splitWith(
        _ text: String, _ pattern: NSRegularExpression
    ) -> (rest: String, featuring: [String]) {
        if let fromBracket = splitBracketFeaturing(text) { return fromBracket }
        let full = NSRange(text.startIndex..., in: text)
        if let match = pattern.firstMatch(in: text, range: full),
           let head = Range(NSRange(location: 0, length: match.range.location), in: text),
           let names = Range(match.range(at: 1), in: text) {
            let rest = text[head].trimmingCharacters(in: .whitespacesAndNewlines)
            let featuring = splitNames(String(text[names]))
            if !rest.isEmpty && !featuring.isEmpty { return (rest, featuring) }
        }
        return (text, [])
    }
}
