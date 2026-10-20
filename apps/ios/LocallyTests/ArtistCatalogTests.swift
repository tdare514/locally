import Foundation
import Testing
@testable import Locally

@Suite struct ArtistCatalogTests {

    private static func track(_ title: String, _ n: Int = 1) -> Track {
        Track(title: title, trackNumber: n, filePath: "t\(n).mp3", originalName: "t\(n).mp3")
    }

    private static func release(
        _ title: String, by artist: String, kind: ReleaseKind = .album, year: String? = nil,
        tracks: [String]? = nil, created: TimeInterval = 0
    ) -> Release {
        let titles = tracks ?? [title]
        return Release(
            kind: kind, title: title, artist: artist, year: year, folderPath: "/lib/\(title)",
            tracks: titles.enumerated().map { track($1, $0 + 1) },
            createdAt: Date(timeIntervalSince1970: created), updatedAt: Date(timeIntervalSince1970: created)
        )
    }

    @Test func caseAndAccentVariantsShareOneKeyWithTheMostUsedName() {
        let catalog = ArtistCatalog(releases: [
            Self.release("One", by: "Beyoncé", tracks: ["a", "b", "c"]),
            Self.release("Two", by: "BEYONCE", kind: .single),
            Self.release("Three", by: "beyonce", kind: .single),
        ])
        #expect(catalog.entries.count == 1)
        let entry = catalog.entry(forKey: ArtistNames.artistKey("Beyonce"))
        #expect(entry?.name == "Beyoncé")
        #expect(entry?.releaseCount == 3)
        #expect(entry?.trackCount == 5)
    }

    @Test func featuringReleaseArtistGoesToTheMainArtistAndAppearsOnForTheFeature() {
        let release = Self.release("Headlights", by: "Neon Harbor feat. Mira Vale", kind: .single)
        let catalog = ArtistCatalog(releases: [release])
        let neon = catalog.entry(forKey: ArtistNames.artistKey("Neon Harbor"))
        let mira = catalog.entry(forKey: ArtistNames.artistKey("Mira Vale"))
        #expect(neon?.singles.map(\.id) == [release.id])
        #expect(neon?.appearsOn.isEmpty == true)
        #expect(mira?.releaseCount == 0)
        #expect(mira?.appearsOn.map(\.release.id) == [release.id])
        #expect(mira?.isFeaturedOnly == true)
        #expect(catalog.entry(forKey: ArtistNames.artistKey("Neon Harbor feat. Mira Vale")) == nil)
    }

    @Test func ampersandDuoStaysOneArtist() {
        let catalog = ArtistCatalog(releases: [Self.release("Duo", by: "Hall & Oates")])
        #expect(catalog.entries.count == 1)
        #expect(catalog.entries.first?.name == "Hall & Oates")
    }

    @Test func splitsAlbumsFromSingles() {
        let album = Self.release("LP", by: "Okoro", kind: .album, tracks: ["a", "b"])
        let single = Self.release("Tide", by: "Okoro", kind: .single)
        let entry = ArtistCatalog(releases: [album, single]).entries.first
        #expect(entry?.albums.map(\.id) == [album.id])
        #expect(entry?.singles.map(\.id) == [single.id])
        #expect(entry?.releaseCount == 2)
        #expect(entry?.trackCount == 3)
    }

    @Test func featuredOnlyEntryAndAppearsOnExcludesOwnReleases() {
        let own = Self.release("Mine", by: "Mira", kind: .single, tracks: ["Solo (feat. Mira)"])
        let other = Self.release("Theirs", by: "Okoro", kind: .album, tracks: ["Tide", "Hymn (feat. Mira & Jonah)"])
        let catalog = ArtistCatalog(releases: [own, other])
        let mira = catalog.entry(forKey: "mira")
        #expect(mira?.appearsOn.map(\.track.title) == ["Hymn (feat. Mira & Jonah)"])
        let jonah = catalog.entry(forKey: "jonah")
        #expect(jonah?.isFeaturedOnly == true)
        #expect(jonah?.trackCount == 0)
        #expect(jonah?.newest?.id == other.id)
        #expect(jonah?.covers.map(\.id) == [other.id])
        #expect(catalog.entry(forKey: "nobody") == nil)
    }

    @Test func newestFirstWithMissingYearsLast() {
        let old = Self.release("Old", by: "A", kind: .single, year: "2019", created: 5)
        let none = Self.release("None", by: "A", kind: .single, year: nil, created: 99)
        let new = Self.release("New", by: "A", kind: .single, year: "2024", created: 1)
        let sameYearLater = Self.release("Later", by: "A", kind: .single, year: "2024", created: 7)
        let entry = ArtistCatalog(releases: [old, none, new, sameYearLater]).entries.first
        #expect(entry?.singles.map(\.title) == ["Later", "New", "Old", "None"])
        #expect(entry?.newest?.title == "Later")
        #expect(entry?.covers.map(\.title) == ["Later", "New", "Old"])
    }

    @Test func aToZIgnoresLeadingTheAndFilesNonLettersLast() {
        let catalog = ArtistCatalog(releases: [
            Self.release("1", by: "The Weeknd"), Self.release("2", by: "Beck"), Self.release("3", by: "808 State"),
            Self.release("4", by: "Adele"), Self.release("5", by: "The Anchors"), Self.release("6", by: "Zed"),
        ])
        #expect(catalog.entries.map(\.name) == ["Adele", "The Anchors", "Beck", "The Weeknd", "Zed", "808 State"])
        let groups = catalog.groups()
        #expect(groups.map(\.letter) == ["A", "B", "W", "Z", "#"])
        #expect(groups[0].entries.map(\.name) == ["Adele", "The Anchors"])
    }

    @Test func searchFoldsCaseAndAccents() {
        let catalog = ArtistCatalog(releases: [Self.release("1", by: "Björk"), Self.release("2", by: "Beck")])
        #expect(catalog.groups(query: "BJORK").flatMap(\.entries).map(\.name) == ["Björk"])
        #expect(catalog.groups(query: "  b ").flatMap(\.entries).count == 2)
        #expect(catalog.groups(query: "zzz").isEmpty)
    }

    @Test func mostPlayedTopFiveExcludesZeroAndTiesGoByTitle() {
        let album = Self.release("LP", by: "Okoro", tracks: ["Echo", "Delta", "Alpha", "Bravo", "Charlie", "Foxtrot", "Silent"])
        let other = Self.release("Elsewhere", by: "Mira", kind: .single, tracks: ["Guest (feat. Okoro)"])
        let catalog = ArtistCatalog(releases: [album, other])
        var plays: [UUID: Int] = [:]
        let t = album.tracks
        plays[t[0].id] = 3   // Echo
        plays[t[1].id] = 9   // Delta
        plays[t[2].id] = 3   // Alpha
        plays[t[3].id] = 3   // Bravo
        plays[t[4].id] = 1   // Charlie
        plays[t[5].id] = 2   // Foxtrot
        plays[t[6].id] = 0   // Silent
        plays[other.tracks[0].id] = 5
        let top = catalog.mostPlayed(forKey: "okoro", plays: plays)
        #expect(top.map { ArtistCatalog.plainTitle($0.track) } == ["Delta", "Guest", "Alpha", "Bravo", "Echo"])
        #expect(top.map(\.plays) == [9, 5, 3, 3, 3])
        #expect(catalog.mostPlayed(forKey: "okoro", plays: [:]).isEmpty)
        #expect(catalog.mostPlayed(forKey: "missing", plays: plays).isEmpty)
    }

    @Test func creditMergesTitleAndReleaseFeatures() {
        let release = Self.release("Song", by: "A feat. B", kind: .single, tracks: ["Song (feat. C & b)"])
        let credit = ArtistCatalog.credit(of: release.tracks[0], in: release)
        #expect(credit.main == "A")
        #expect(credit.featuring == ["C", "b"])
        #expect(ArtistCatalog.plainTitle(release.tracks[0]) == "Song")
    }
}
