import Foundation

/// The library search box, ported from the web's `library-sections.ts`
/// (`normalizeSearchText`, `filterLibrary`).
enum LibrarySearch {
    /// Folds case and diacritics, collapses whitespace runs to one space and trims.
    static func normalize(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }

    /// Releases whose title, artist, genre, year or any track title contains
    /// every word of `query`. An empty query returns `releases` unchanged.
    static func filter(_ releases: [Release], query: String) -> [Release] {
        let tokens = normalize(query).split(separator: " ").map(String.init)
        guard !tokens.isEmpty else { return releases }
        return releases.filter { release in
            let fields = [release.title, release.artist, release.genre ?? "", release.year ?? ""]
                + release.tracks.map(\.title)
            let haystack = normalize(fields.joined(separator: " "))
            return tokens.allSatisfy { haystack.contains($0) }
        }
    }
}
