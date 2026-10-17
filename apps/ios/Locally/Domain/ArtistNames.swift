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
        let result = splitBracketFeaturing(title) ?? splitBareFeaturing(title, markers: ["feat", "ft"], dotRequired: true)
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
        let result = splitBracketFeaturing(artist)
            ?? splitBareFeaturing(artist, markers: featuringMarkers, dotRequired: false)
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

    /// The one whitespace set both apps use: U+0009 to U+000D and U+0020.
    private static func isWhitespace(_ scalar: Unicode.Scalar) -> Bool {
        scalar == " " || (scalar.value >= 0x09 && scalar.value <= 0x0D)
    }

    private static func trimWhitespace(_ scalars: ArraySlice<Unicode.Scalar>) -> [Unicode.Scalar] {
        var slice = scalars
        while let first = slice.first, isWhitespace(first) { slice.removeFirst() }
        while let last = slice.last, isWhitespace(last) { slice.removeLast() }
        return Array(slice)
    }

    private static func string(_ scalars: [Unicode.Scalar]) -> String {
        String(String.UnicodeScalarView(scalars))
    }

    private static func splitNames(_ scalars: ArraySlice<Unicode.Scalar>) -> [String] {
        string(Array(scalars))
            .replacingOccurrences(of: " & ", with: ", ")
            .components(separatedBy: ", ")
            .map { string(trimWhitespace(Array($0.unicodeScalars)[...])) }
            .filter { !$0.isEmpty }
    }

    private static let featuringMarkers = ["featuring", "feat", "ft"]

    private static func asciiLower(_ scalar: Unicode.Scalar) -> Unicode.Scalar {
        (scalar.value >= 0x41 && scalar.value <= 0x5A) ? Unicode.Scalar(scalar.value + 32)! : scalar
    }

    /// The length of the marker (ASCII, any case) that starts at `index`, or 0.
    private static func markerLength(_ text: [Unicode.Scalar], at index: Int, _ markers: [String]) -> Int {
        for marker in markers {
            let wanted = Array(marker.unicodeScalars)
            guard index + wanted.count <= text.count else { continue }
            if text[index..<(index + wanted.count)].map(asciiLower) == wanted { return wanted.count }
        }
        return 0
    }

    private static func skipWhitespace(_ text: [Unicode.Scalar], from index: Int) -> Int {
        var i = index
        while i < text.count && isWhitespace(text[i]) { i += 1 }
        return i
    }

    private static func at(_ text: [Unicode.Scalar], _ index: Int) -> Unicode.Scalar? {
        index >= 0 && index < text.count ? text[index] : nil
    }

    /// True when the text holds a closer, whitespace, then an opener, of either kind: ") [".
    private static func hasSeparateGroup(_ text: ArraySlice<Unicode.Scalar>) -> Bool {
        let array = Array(text)
        for i in array.indices where array[i] == ")" || array[i] == "]" {
            let next = skipWhitespace(array, from: i + 1)
            if next > i + 1, let char = at(array, next), char == "(" || char == "[" { return true }
        }
        return false
    }

    /// A trailing "(feat. ...)" or "[feat. ...]", anchored on its last opener
    /// (see `spec/artist-names.md`). The names run to the final closer, so
    /// "(G)I-DLE" and "Sunn O)))" survive.
    private static func splitBracketFeaturing(_ text: String) -> (rest: String, featuring: [String])? {
        let trimmed = trimWhitespace(Array(text.unicodeScalars)[...])
        guard let closer = trimmed.last, closer == ")" || closer == "]" else { return nil }
        let opener: Unicode.Scalar = closer == ")" ? "(" : "["
        let end = trimmed.count - 1
        var i = end - 1
        while i >= 0 {
            defer { i -= 1 }
            guard trimmed[i] == opener else { continue }
            if i > 0 && !isWhitespace(trimmed[i - 1]) { continue }
            let start = skipWhitespace(trimmed, from: i + 1)
            let length = markerLength(trimmed, at: start, featuringMarkers)
            if length == 0 { continue }
            let afterMarker = start + length
            if afterMarker < end && trimmed[afterMarker] != "." && trimmed[afterMarker] != " " { continue }
            var namesText = trimmed[afterMarker..<end]
            if namesText.first == "." { namesText = namesText.dropFirst() }
            if hasSeparateGroup(namesText) { continue }
            let names = splitNames(namesText)
            let rest = string(trimWhitespace(trimmed[0..<i]))
            return (!rest.isEmpty && !names.isEmpty) ? (rest, names) : nil
        }
        return nil
    }

    /// The bare form: whitespace, a marker, then names to the end. `dotRequired`
    /// is the title form (" feat. X"); otherwise a dot or whitespace may follow.
    private static func splitBareFeaturing(
        _ text: String, markers: [String], dotRequired: Bool
    ) -> (rest: String, featuring: [String]) {
        let scalars = Array(text.unicodeScalars)
        for i in scalars.indices {
            if !isWhitespace(scalars[i]) || (i > 0 && isWhitespace(scalars[i - 1])) { continue }
            let start = skipWhitespace(scalars, from: i)
            let length = markerLength(scalars, at: start, markers)
            if length == 0 { continue }
            var after = start + length
            if at(scalars, after) == "." {
                let next = skipWhitespace(scalars, from: after + 1)
                if dotRequired && next == after + 1 { continue }
                after = next
            } else if dotRequired || !(at(scalars, after).map(isWhitespace) ?? false) {
                continue
            } else {
                after = skipWhitespace(scalars, from: after)
            }
            let rest = string(trimWhitespace(scalars[0..<i]))
            let featuring = splitNames(scalars[after...])
            if !rest.isEmpty && !featuring.isEmpty { return (rest, featuring) }
            break
        }
        return (text, [])
    }
}
