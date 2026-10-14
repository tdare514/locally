import Foundation
import Testing
@testable import Locally

@Suite struct LibrarySearchTests {

    private func release(
        _ title: String, artist: String = "Artist", year: String? = nil,
        genre: String? = nil, tracks: [String] = ["Track"]
    ) -> Release {
        Release(
            kind: tracks.count > 1 ? .album : .single,
            title: title, artist: artist, year: year, genre: genre,
            folderPath: "/tmp/x",
            tracks: tracks.enumerated().map {
                Track(title: $0.element, trackNumber: $0.offset + 1, filePath: "\($0.offset).mp3", originalName: "\($0.offset).mp3")
            }
        )
    }

    @Test func emptyQueryReturnsAll() {
        let all = [release("A"), release("B")]
        #expect(LibrarySearch.filter(all, query: "").count == 2)
        #expect(LibrarySearch.filter(all, query: "   ").count == 2)
    }

    @Test func isCaseAndAccentInsensitive() {
        let all = [release("Homogenic", artist: "Björk"), release("Other")]
        #expect(LibrarySearch.filter(all, query: "bjork").map(\.title) == ["Homogenic"])
        #expect(LibrarySearch.filter(all, query: "BJÖRK").map(\.title) == ["Homogenic"])
    }

    @Test func everyTokenMustMatch() {
        let all = [release("Homogenic", artist: "Björk"), release("Debut", artist: "Björk")]
        #expect(LibrarySearch.filter(all, query: "bjork debut").map(\.title) == ["Debut"])
        #expect(LibrarySearch.filter(all, query: "bjork nothing").isEmpty)
    }

    @Test func matchesGenreYearAndTrackTitle() {
        let all = [release("A", year: "1997", genre: "Electronic", tracks: ["Jóga", "Bachelorette"]), release("B")]
        #expect(LibrarySearch.filter(all, query: "electronic").map(\.title) == ["A"])
        #expect(LibrarySearch.filter(all, query: "1997").map(\.title) == ["A"])
        #expect(LibrarySearch.filter(all, query: "joga").map(\.title) == ["A"])
    }

    @Test func extraWhitespaceInQueryIsIgnored() {
        let all = [release("Homogenic", artist: "Björk")]
        #expect(LibrarySearch.filter(all, query: "  bjork    homogenic  ").count == 1)
        #expect(LibrarySearch.normalize("  a \t b\n") == "a b")
    }
}
