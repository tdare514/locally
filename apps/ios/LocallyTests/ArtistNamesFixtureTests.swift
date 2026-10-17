import Foundation
import Testing
@testable import Locally

/// Loads `spec/fixtures/artists/*.json`, the shared cases every app's tests
/// run (see `spec/artist-names.md`).
struct ArtistNamesFixtureTests {
    struct KeyCase: Decodable, CustomTestStringConvertible {
        let name: String
        let inputs: [String]
        let key: String
        var testDescription: String { name }
    }

    struct LooksCase: Decodable, CustomTestStringConvertible {
        let name: String
        let a: String
        let b: String
        let expected: Bool
        var testDescription: String { name }
    }

    struct SplitCase: Decodable, CustomTestStringConvertible {
        let name: String
        let input: String
        let title: String?
        let artist: String?
        let featuring: [String]
        var testDescription: String { name }
    }

    struct JoinCase: Decodable, CustomTestStringConvertible {
        let name: String
        let title: String
        let featuring: [String]
        let expected: String
        var testDescription: String { name }
    }

    private static let files = ["keys", "looks-like", "title-split", "title-join", "artist-split"]

    private static let fixturesDir: URL = {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 {
            url.deleteLastPathComponent()
        }
        return url
            .appendingPathComponent("spec")
            .appendingPathComponent("fixtures")
            .appendingPathComponent("artists")
    }()

    private static func load<T: Decodable>(_ file: String) -> [T] {
        let url = fixturesDir.appendingPathComponent("\(file).json")
        guard let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([T].self, from: data)) ?? []
    }

    private static let keyCases: [KeyCase] = load("keys")
    private static let looksCases: [LooksCase] = load("looks-like")
    private static let titleSplitCases: [SplitCase] = load("title-split")
    private static let joinCases: [JoinCase] = load("title-join")
    private static let artistSplitCases: [SplitCase] = load("artist-split")

    @Test func everyFixtureFileExistsAndIsNonEmpty() {
        for file in Self.files {
            let data = try? Data(contentsOf: Self.fixturesDir.appendingPathComponent("\(file).json"))
            let count = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [Any] }?.count ?? 0
            #expect(count > 0, "\(file).json is missing, empty or unreadable")
        }
        #expect(Self.keyCases.count > 0)
        #expect(Self.looksCases.count > 0)
        #expect(Self.titleSplitCases.count > 0)
        #expect(Self.joinCases.count > 0)
        #expect(Self.artistSplitCases.count > 0)
    }

    @Test(arguments: ArtistNamesFixtureTests.keyCases)
    func artistKeyMatchesFixture(_ fixture: KeyCase) {
        for input in fixture.inputs {
            #expect(ArtistNames.artistKey(input) == fixture.key, "\(input)")
        }
    }

    @Test(arguments: ArtistNamesFixtureTests.looksCases)
    func looksLikeMatchesFixture(_ fixture: LooksCase) {
        #expect(ArtistNames.looksLike(fixture.a, fixture.b) == fixture.expected)
        #expect(ArtistNames.looksLike(fixture.b, fixture.a) == fixture.expected)
    }

    @Test(arguments: ArtistNamesFixtureTests.titleSplitCases)
    func splitFeaturingMatchesFixture(_ fixture: SplitCase) {
        let result = ArtistNames.splitFeaturing(fixture.input)
        #expect(result.title == fixture.title)
        #expect(result.featuring == fixture.featuring)
    }

    @Test(arguments: ArtistNamesFixtureTests.joinCases)
    func joinFeaturingMatchesFixtureAndRoundTrips(_ fixture: JoinCase) {
        #expect(ArtistNames.joinFeaturing(fixture.title, fixture.featuring) == fixture.expected)
        let split = ArtistNames.splitFeaturing(fixture.expected)
        #expect(split.title == fixture.title)
        #expect(split.featuring == fixture.featuring)
        #expect(ArtistNames.joinFeaturing(split.title, split.featuring) == fixture.expected)
    }

    @Test(arguments: ArtistNamesFixtureTests.artistSplitCases)
    func splitArtistFeaturingMatchesFixture(_ fixture: SplitCase) {
        let result = ArtistNames.splitArtistFeaturing(fixture.input)
        #expect(result.artist == fixture.artist)
        #expect(result.featuring == fixture.featuring)
    }
}
