import Foundation
import Testing
@testable import Locally

/// Loads `spec/fixtures/artists/index.json`, the shared cases the web's `artistIndex.test.ts`
/// runs too (issue #287).
struct ArtistIndexFixtureTests {
    struct ReleaseCase: Decodable {
        let artist: String
        let tracks: [String]
    }

    struct EntryCase: Decodable {
        let display: String
        let key: String
        let trackCount: Int
        let releaseCount: Int
    }

    struct SuggestCase: Decodable {
        let query: String
        let limit: Int
        let expected: [String]
    }

    struct HintCase: Decodable {
        struct Expected: Decodable {
            let kind: String
            let artist: String
            let trackCount: Int
        }
        let typed: String
        let expected: Expected?
    }

    struct Scenario: Decodable, CustomTestStringConvertible {
        let name: String
        let releases: [ReleaseCase]
        let index: [EntryCase]?
        let suggest: [SuggestCase]?
        let didYouMean: [HintCase]?
        var testDescription: String { name }

        var built: [ArtistEntry] {
            ArtistIndex.build(releases.map { ArtistIndex.Source(artist: $0.artist, titles: $0.tracks) })
        }
    }

    private static let fileURL: URL = {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { url.deleteLastPathComponent() }
        return url.appendingPathComponent("spec").appendingPathComponent("fixtures")
            .appendingPathComponent("artists").appendingPathComponent("index.json")
    }()

    private static let scenarios: [Scenario] = {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        return (try? JSONDecoder().decode([Scenario].self, from: data)) ?? []
    }()

    @Test func fixtureFileLoads() {
        #expect(Self.scenarios.count > 0, "index.json is missing, empty or unreadable")
    }

    @Test(arguments: ArtistIndexFixtureTests.scenarios.filter { $0.index != nil })
    func buildMatchesFixture(_ scenario: Scenario) {
        let expected = (scenario.index ?? []).map {
            ArtistEntry(display: $0.display, key: $0.key, trackCount: $0.trackCount, releaseCount: $0.releaseCount)
        }
        #expect(scenario.built == expected)
    }

    @Test(arguments: ArtistIndexFixtureTests.scenarios.filter { $0.suggest != nil })
    func suggestMatchesFixture(_ scenario: Scenario) {
        let index = scenario.built
        for item in scenario.suggest ?? [] {
            #expect(ArtistIndex.suggest(index, query: item.query, limit: item.limit).map(\.display) == item.expected, "query \(item.query)")
        }
    }

    @Test(arguments: ArtistIndexFixtureTests.scenarios.filter { $0.didYouMean != nil })
    func didYouMeanMatchesFixture(_ scenario: Scenario) {
        let index = scenario.built
        for item in scenario.didYouMean ?? [] {
            let got = ArtistIndex.didYouMean(index, typed: item.typed)
            if let expected = item.expected {
                #expect(got?.kind == (expected.kind == "spelling" ? .spelling : .looksLike), "typed \(item.typed)")
                #expect(got?.artist == expected.artist, "typed \(item.typed)")
                #expect(got?.trackCount == expected.trackCount, "typed \(item.typed)")
            } else {
                #expect(got == nil, "typed \(item.typed)")
            }
        }
    }

    @Test func copyMatchesTheWeb() {
        let like = DidYouMean(kind: .looksLike, artist: "The Weeknd", trackCount: 12)
        let spelling = DidYouMean(kind: .spelling, artist: "The Weeknd", trackCount: 12)
        #expect(Copy.ArtistSuggest.line(for: like) == "You have 12 tracks by The Weeknd.")
        #expect(Copy.ArtistSuggest.line(for: spelling) == "Matches The Weeknd. Use that spelling?")
        #expect(Copy.ArtistSuggest.useButton(artist: "The Weeknd") == "Use The Weeknd")
        #expect(Copy.ArtistSuggest.trackCount(1) == "1 track")
        #expect(Copy.ArtistSuggest.pill(artist: "The Weeknd", trackCount: 12) == "The Weeknd · 12")
        #expect(Copy.ArtistSuggest.pillLabel(artist: "The Weeknd", trackCount: 12) == "The Weeknd, 12 tracks")
    }
}
