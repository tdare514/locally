import Foundation

/// A track that features an artist on a release by someone else.
struct ArtistAppearance: Hashable {
    let release: Release
    let track: Track
}

/// A track in an artist's Most played list.
struct ArtistPlayedTrack: Hashable {
    let release: Release
    let track: Track
    let plays: Int
}

/// One artist the library holds, with everything the artist page and the Artists view show (#288).
struct ArtistCatalogEntry: Hashable {
    /// `ArtistNames.artistKey` of the name: the identity.
    let key: String
    /// The most-used spelling.
    let name: String
    /// Own releases of kind album whose main artist is this key, newest first.
    let albums: [Release]
    /// Own releases of kind single, newest first.
    let singles: [Release]
    /// Tracks that feature this artist on someone else's release, newest first.
    let appearsOn: [ArtistAppearance]
    /// Tracks on the artist's own releases.
    let trackCount: Int
    /// Albums plus singles.
    let releaseCount: Int
    /// Up to three releases whose covers make the stack: own releases newest first, else the ones appeared on.
    let covers: [Release]
    /// The newest own release, else the newest one appeared on: it gives the page's wash.
    let newest: Release?

    /// True when the artist has no release of their own, only features.
    var isFeaturedOnly: Bool { releaseCount == 0 }
}

/// The artist catalogue (#288, step 3 of `docs/plans/224-artist-list.md`): one entry per artist key,
/// built from the library's releases. Pure. Same rules as the web's `artist-catalog.ts`.
struct ArtistCatalog {
    /// One letter group of the A to Z list.
    struct Group: Equatable {
        let letter: String
        let entries: [ArtistCatalogEntry]
    }

    /// How many tracks Most played shows.
    static let mostPlayedLimit = 5
    /// How many covers the stack fans.
    static let coverLimit = 3
    /// The heading every non-letter first character files under.
    static let otherLetter = "#"

    private(set) var entries: [ArtistCatalogEntry]
    private let byKey: [String: ArtistCatalogEntry]

    init(releases: [Release]) {
        struct Draft {
            var spellings: [String: Int] = [:]
            var albums: [Release] = []
            var singles: [Release] = []
            var appearsOn: [ArtistAppearance] = []
            var trackCount = 0
        }
        var drafts: [String: Draft] = [:]

        func spell(_ name: String, key: String, weight: Int) {
            // NFC first, so "e" + U+0301 and U+00E9 are one spelling, as in `ArtistIndex`.
            let display = name.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping
            drafts[key, default: Draft()].spellings[display, default: 0] += weight
        }

        for release in releases {
            let credit = ArtistNames.splitArtistFeaturing(release.artist)
            let mainKey = ArtistNames.artistKey(credit.artist)
            if !mainKey.isEmpty {
                spell(credit.artist, key: mainKey, weight: release.tracks.count)
                drafts[mainKey, default: Draft()].trackCount += release.tracks.count
                if release.kind == .album {
                    drafts[mainKey, default: Draft()].albums.append(release)
                } else {
                    drafts[mainKey, default: Draft()].singles.append(release)
                }
            }
            for track in release.tracks {
                var seen: Set<String> = [mainKey]
                for name in Self.features(of: track, in: release) {
                    let key = ArtistNames.artistKey(name)
                    if key.isEmpty || !seen.insert(key).inserted { continue }
                    spell(name, key: key, weight: 1)
                    drafts[key, default: Draft()].appearsOn.append(ArtistAppearance(release: release, track: track))
                }
            }
        }

        let built = drafts.map { key, draft -> ArtistCatalogEntry in
            let albums = Self.newestFirst(draft.albums)
            let singles = Self.newestFirst(draft.singles)
            let appearsOn = draft.appearsOn.sorted { Self.isNewer($0.release, $1.release) }
            let own = Self.newestFirst(draft.albums + draft.singles)
            var appearedReleases: [Release] = []
            for appearance in appearsOn where !appearedReleases.contains(where: { $0.id == appearance.release.id }) {
                appearedReleases.append(appearance.release)
            }
            let coverSource = own.isEmpty ? appearedReleases : own
            return ArtistCatalogEntry(
                key: key, name: Self.mostUsed(draft.spellings), albums: albums, singles: singles, appearsOn: appearsOn,
                trackCount: draft.trackCount, releaseCount: albums.count + singles.count,
                covers: Array(coverSource.prefix(Self.coverLimit)), newest: coverSource.first
            )
        }
        entries = built.sorted { Self.atoZ($0, $1) }
        byKey = Dictionary(uniqueKeysWithValues: entries.map { ($0.key, $0) })
    }

    /// The entry for a key, or nil when the library has no release of theirs and none featuring them.
    func entry(forKey key: String) -> ArtistCatalogEntry? { byKey[key] }

    // MARK: - Credits

    /// A track's featured names: the title's "(feat. B)" merged with the release artist's own
    /// "A feat. B", each name once.
    static func features(of track: Track, in release: Release) -> [String] {
        let fromTitle = ArtistNames.splitFeaturing(track.title).featuring
        let fromRelease = ArtistNames.splitArtistFeaturing(release.artist).featuring
        var seen: Set<String> = []
        var names: [String] = []
        for name in fromTitle + fromRelease {
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            let key = ArtistNames.artistKey(trimmed)
            if !key.isEmpty, seen.insert(key).inserted { names.append(trimmed) }
        }
        return names
    }

    /// The artist line of a track: "{main}, feat. {names}".
    static func credit(of track: Track, in release: Release) -> (main: String, featuring: [String]) {
        let main = ArtistNames.splitArtistFeaturing(release.artist).artist
        return (main, features(of: track, in: release))
    }

    /// A track's title without its "(feat. B)".
    static func plainTitle(_ track: Track) -> String {
        let plain = ArtistNames.splitFeaturing(track.title).title
        return plain.isEmpty ? track.title : plain
    }

    // MARK: - Lists

    /// Entries A to Z in letter groups, with "#" last. A non-empty `query` narrows by name with
    /// the library search's case and accent folding; every word must match.
    func groups(query: String = "") -> [Group] {
        let tokens = LibrarySearch.normalize(query).split(separator: " ").map(String.init)
        let shown = tokens.isEmpty ? entries : entries.filter { entry in
            let name = LibrarySearch.normalize(entry.name)
            return tokens.allSatisfy { name.contains($0) }
        }
        var order: [String] = []
        var grouped: [String: [ArtistCatalogEntry]] = [:]
        for entry in shown {
            let letter = Self.letter(of: entry)
            if grouped[letter] == nil { order.append(letter) }
            grouped[letter, default: []].append(entry)
        }
        // `entries` is already A to Z with "#" last, so `order` is too.
        return order.map { Group(letter: $0, entries: grouped[$0] ?? []) }
    }

    /// The top tracks of an entry across its albums, singles and appearances, by all-time plays
    /// (`plays` is keyed by track id). Zero plays are left out; ties go A to Z by title.
    func mostPlayed(forKey key: String, plays: [UUID: Int], limit: Int = ArtistCatalog.mostPlayedLimit) -> [ArtistPlayedTrack] {
        guard let entry = byKey[key], limit > 0 else { return [] }
        var candidates: [ArtistPlayedTrack] = []
        var seen: Set<UUID> = []
        for release in entry.albums + entry.singles {
            for track in release.tracks where seen.insert(track.id).inserted {
                candidates.append(ArtistPlayedTrack(release: release, track: track, plays: plays[track.id] ?? 0))
            }
        }
        for appearance in entry.appearsOn where seen.insert(appearance.track.id).inserted {
            candidates.append(ArtistPlayedTrack(release: appearance.release, track: appearance.track, plays: plays[appearance.track.id] ?? 0))
        }
        let ranked = candidates.filter { $0.plays > 0 }.sorted { a, b in
            if a.plays != b.plays { return a.plays > b.plays }
            let titles = Self.compareText(Self.plainTitle(a.track), Self.plainTitle(b.track))
            if titles != .orderedSame { return titles == .orderedAscending }
            return a.track.id.uuidString < b.track.id.uuidString
        }
        return Array(ranked.prefix(limit))
    }

    var isEmpty: Bool { entries.isEmpty }

    // MARK: - Ordering

    private static func compareText(_ a: String, _ b: String) -> ComparisonResult {
        a.compare(b, options: [.caseInsensitive, .diacriticInsensitive], range: nil, locale: Locale(identifier: "en"))
    }

    /// The year as a number: its leading digits, nil when there are none.
    private static func yearNumber(_ year: String?) -> Int? {
        guard let year else { return nil }
        let digits = year.trimmingCharacters(in: .whitespaces).prefix { $0.isASCII && $0.isNumber }
        return Int(digits)
    }

    /// Year descending (missing year last), then created date descending, then title and id so the order never flickers.
    private static func isNewer(_ a: Release, _ b: Release) -> Bool {
        let ay = yearNumber(a.year)
        let by = yearNumber(b.year)
        if ay != by {
            guard let ay else { return false }
            guard let by else { return true }
            return ay > by
        }
        if a.createdAt != b.createdAt { return a.createdAt > b.createdAt }
        return a.id.uuidString < b.id.uuidString
    }

    private static func newestFirst(_ releases: [Release]) -> [Release] {
        releases.sorted(by: isNewer)
    }

    /// The most-used spelling; the first in code point order on a tie (as `ArtistIndex`).
    private static func mostUsed(_ spellings: [String: Int]) -> String {
        var display = ""
        var best = -1
        for (spelling, count) in spellings {
            let earlier = spelling.unicodeScalars.lexicographicallyPrecedes(display.unicodeScalars) { $0.value < $1.value }
            if count > best || (count == best && earlier) {
                display = spelling
                best = count
            }
        }
        return display
    }

    /// The key with a leading "the " dropped: "The Weeknd" files under W.
    static func sortKey(_ key: String) -> String {
        key.hasPrefix("the ") && key.count > 4 ? String(key.dropFirst(4)) : key
    }

    /// The group an entry files under: its sort key's first letter A to Z, else "#".
    private static func letter(of entry: ArtistCatalogEntry) -> String {
        guard let first = sortKey(entry.key).unicodeScalars.first, first.value >= 0x61, first.value <= 0x7A else { return otherLetter }
        return String(Character(Unicode.Scalar(first.value - 32)!))
    }

    private static func atoZ(_ a: ArtistCatalogEntry, _ b: ArtistCatalogEntry) -> Bool {
        let la = letter(of: a)
        let lb = letter(of: b)
        if la != lb {
            if la == otherLetter { return false }
            if lb == otherLetter { return true }
            return la < lb
        }
        let ka = sortKey(a.key)
        let kb = sortKey(b.key)
        if ka != kb { return ka.unicodeScalars.lexicographicallyPrecedes(kb.unicodeScalars) { $0.value < $1.value } }
        return a.name.unicodeScalars.lexicographicallyPrecedes(b.name.unicodeScalars) { $0.value < $1.value }
    }
}
