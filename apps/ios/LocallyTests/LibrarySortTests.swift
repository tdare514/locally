import Foundation
import Testing
@testable import Locally

@Suite struct LibrarySortTests {

    private static func release(_ title: String, _ artist: String, year: String? = nil, updated: TimeInterval = 0) -> Release {
        Release(
            kind: .single, title: title, artist: artist, year: year, folderPath: "/lib/\(title)",
            tracks: [Track(title: title, trackNumber: 1, filePath: "t.mp3", originalName: "t.mp3")],
            createdAt: Date(timeIntervalSince1970: updated), updatedAt: Date(timeIntervalSince1970: updated)
        )
    }

    private func titles(_ releases: [Release], _ option: LibrarySortOption) -> [String] {
        LibrarySort.sorted(releases, by: option).map(\.title)
    }

    @Test func newestPutsTheLatestUpdateFirst() {
        let list = [Self.release("a", "x", updated: 1), Self.release("b", "x", updated: 3), Self.release("c", "x", updated: 2)]
        #expect(titles(list, .newest) == ["b", "c", "a"])
    }

    @Test func titleIgnoresCaseAccentsAndReadsDigitsByValue() {
        let list = [Self.release("track 10", "x"), Self.release("Track 2", "x"), Self.release("Émile", "x"), Self.release("emma", "x")]
        #expect(titles(list, .title) == ["Émile", "emma", "Track 2", "track 10"])
    }

    @Test func titleTiesGoByArtistThenNewestUpdate() {
        let list = [
            Self.release("Same", "Zed", updated: 1), Self.release("Same", "Amy", updated: 1),
            Self.release("Same", "Amy", updated: 5),
        ]
        let sorted = LibrarySort.sorted(list, by: .title)
        #expect(sorted.map(\.artist) == ["Amy", "Amy", "Zed"])
        #expect(sorted[0].updatedAt > sorted[1].updatedAt)
    }

    @Test func artistThenTitle() {
        let list = [Self.release("b", "Zed"), Self.release("z", "Amy"), Self.release("a", "Amy")]
        #expect(titles(list, .artist) == ["a", "z", "b"])
    }

    @Test func yearNewestFirstMissingLastTiesByTitle() {
        let list = [
            Self.release("m", "x", year: nil), Self.release("b", "x", year: "2020"), Self.release("a", "x", year: "2020"),
            Self.release("n", "x", year: "soon"), Self.release("c", "x", year: "2024"),
        ]
        #expect(titles(list, .year) == ["c", "a", "b", "m", "n"])
    }

    @Test func doesNotMutateAndKeepsInputOrderForEquals() {
        let list = [Self.release("same", "x"), Self.release("SAME", "x")]
        #expect(titles(list, .title) == ["same", "SAME"])
        #expect(list.map(\.title) == ["same", "SAME"])
    }

    @Test func storedOptionFallsBackToNewest() {
        #expect(LibrarySortOption(storedRaw: nil) == .newest)
        #expect(LibrarySortOption(storedRaw: "bogus") == .newest)
        for option in LibrarySortOption.allCases { #expect(LibrarySortOption(storedRaw: option.rawValue) == option) }
        #expect(LibraryViewPrefs.sortKey == "locally.library.sort")
    }
}
