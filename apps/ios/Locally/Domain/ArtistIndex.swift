import Foundation

/// One artist the library holds (issue #287).
struct ArtistEntry: Equatable, Hashable {
    /// The spelling shown: the one used on the most tracks, A to Z on a tie.
    let display: String
    let key: String
    let trackCount: Int
    let releaseCount: Int
}

/// What "Did you mean" says: a spelling of an artist the library has, or a look-alike of one.
struct DidYouMean: Equatable {
    enum Kind: Equatable { case spelling, looksLike }
    let kind: Kind
    let artist: String
    let trackCount: Int
}

/// Artist suggestions while typing and the "Did you mean" check (issue #287), ported from the
/// web's `artist-index.ts`. `spec/fixtures/artists/index.json` runs against both. Built on the
/// #286 rules in `ArtistNames`.
enum ArtistIndex {
    /// The least of a release the index reads; adopted releases count too.
    struct Source {
        let artist: String
        let titles: [String]
    }

    static func build(_ releases: [Release]) -> [ArtistEntry] {
        build(releases.map { Source(artist: $0.artist, titles: $0.tracks.map(\.title)) })
    }

    static func build(_ releases: [Source]) -> [ArtistEntry] {
        struct Group {
            var spellings: [String: Int] = [:]
            var trackCount = 0
            var releaseCount = 0
        }
        var groups: [String: Group] = [:]
        func add(_ name: String, tracks: Int, releases: Int) {
            // NFC first, so "e" + U+0301 and U+00E9 are one spelling, as on the web.
            let display = name.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping
            let key = ArtistNames.artistKey(display)
            if key.isEmpty { return }
            var group = groups[key] ?? Group()
            group.spellings[display, default: 0] += tracks
            group.trackCount += tracks
            group.releaseCount += releases
            groups[key] = group
        }
        for release in releases {
            add(release.artist, tracks: release.titles.count, releases: 1)
            for title in release.titles {
                for name in ArtistNames.splitFeaturing(title).featuring { add(name, tracks: 1, releases: 0) }
            }
        }
        let entries = groups.map { key, group -> ArtistEntry in
            var display = ""
            var best = -1
            for (spelling, count) in group.spellings where count > best || (count == best && before(spelling, display)) {
                display = spelling
                best = count
            }
            return ArtistEntry(display: display, key: key, trackCount: group.trackCount, releaseCount: group.releaseCount)
        }
        return entries.sorted(by: ranksBefore)
    }

    static func suggest(_ index: [ArtistEntry], query: String, limit: Int) -> [ArtistEntry] {
        let queryKey = Array(ArtistNames.artistKey(query).unicodeScalars)
        if queryKey.isEmpty || limit <= 0 { return [] }
        var starts: [ArtistEntry] = []
        var inside: [ArtistEntry] = []
        let exact = query.precomposedStringWithCanonicalMapping
        for entry in index where entry.display != exact {
            guard let offset = matchOffset(Array(entry.key.unicodeScalars), queryKey) else { continue }
            if offset == 0 { starts.append(entry) } else { inside.append(entry) }
        }
        return Array((starts.sorted(by: ranksBefore) + inside.sorted(by: ranksBefore)).prefix(limit))
    }

    static func didYouMean(_ index: [ArtistEntry], typed: String) -> DidYouMean? {
        let key = ArtistNames.artistKey(typed)
        if key.isEmpty { return nil }
        if let same = index.first(where: { $0.key == key }) {
            if same.display == typed.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping { return nil }
            return DidYouMean(kind: .spelling, artist: same.display, trackCount: same.trackCount)
        }
        var best: ArtistEntry?
        for entry in index where ArtistNames.looksLike(typed, entry.display) {
            if best == nil || ranksBefore(entry, best!) { best = entry }
        }
        return best.map { DidYouMean(kind: .looksLike, artist: $0.display, trackCount: $0.trackCount) }
    }

    /// Plain code point order, the same as the web.
    private static func before(_ a: String, _ b: String) -> Bool {
        a.unicodeScalars.lexicographicallyPrecedes(b.unicodeScalars) { $0.value < $1.value }
    }

    /// Most tracks first, then A to Z.
    private static func ranksBefore(_ a: ArtistEntry, _ b: ArtistEntry) -> Bool {
        if a.trackCount != b.trackCount { return a.trackCount > b.trackCount }
        return before(a.display, b.display)
    }

    /// The query's key starts the artist's key or any word of it: "wee" finds "the weeknd".
    private static func matchOffset(_ key: [Unicode.Scalar], _ query: [Unicode.Scalar]) -> Int? {
        var from = 0
        while from <= key.count - query.count {
            if Array(key[from..<(from + query.count)]) == query { return from }
            guard let space = key[from...].firstIndex(of: " ") else { return nil }
            from = space + 1
        }
        return nil
    }
}
