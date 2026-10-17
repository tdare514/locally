import Foundation

/// The pure rules behind the Featuring field (#287): names are trimmed, a name already there
/// (same `artistKey`) is skipped, and a comma ends a name. Kept apart from the view so the
/// editors and their tests share them.
enum FeaturingNames {
    /// `names` plus `name`, trimmed; unchanged when the name is empty or its key is already there.
    static func add(_ name: String, to names: [String]) -> [String] {
        let trimmed = clean(name)
        let key = ArtistNames.artistKey(trimmed)
        guard !key.isEmpty, !names.contains(where: { ArtistNames.artistKey($0) == key }) else { return names }
        return names + [trimmed]
    }

    /// Adds every complete name in `draft` (the ones a comma ends) and returns what is left to type.
    static func absorbCommas(_ draft: String, into names: inout [String]) -> String {
        guard draft.contains(",") else { return draft }
        var parts = draft.components(separatedBy: ",")
        let rest = parts.removeLast()
        for part in parts { names = add(part, to: names) }
        return rest
    }

    /// Return, Done or leaving the field: the draft becomes a name.
    static func commit(_ draft: String, to names: [String]) -> [String] {
        var result = names
        let rest = absorbCommas(draft, into: &result)
        return add(rest, to: result)
    }

    static func remove(_ name: String, from names: [String]) -> [String] {
        names.filter { $0 != name }
    }

    /// `lists` in order as one list, with names repeated by key dropped.
    static func merged(_ lists: [String]...) -> [String] {
        lists.reduce([]) { result, list in list.reduce(result) { add($1, to: $0) } }
    }

    /// "B & C", as `ArtistNames.joinFeaturing` words them.
    static func display(_ names: [String]) -> String {
        ArtistNames.joinNames(names)
    }

    /// A track's full title for the file's tag: unchanged when the text the editor split it
    /// into is unchanged (so "B, C, D" is not reworded to "B, C & D"), else the joined form.
    static func fullTitle(plain: String, featuring: [String], original: String?) -> String {
        if let original {
            let split = ArtistNames.splitFeaturing(original)
            if split.title == plain && split.featuring == featuring { return original }
        }
        return ArtistNames.joinFeaturing(plain, featuring)
    }

    /// Trimmed, with any zero-width space (U+200B) removed: no saved name ever holds one.
    private static func clean(_ name: String) -> String {
        name.replacingOccurrences(of: "\u{200B}", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
