import Foundation
import Testing
@testable import Locally

/// Loads `spec/fixtures/local-id/cases.json`, the shared `spotify:local:` cases the Mac's
/// `localIdFixtures.test.ts` also runs (#332 step 1). Each `expected` was produced by the Mac encoder.
struct LocalIdFixtureTests {
    struct LocalIdCase: Decodable, CustomTestStringConvertible {
        let name: String
        let artist: String
        let album: String
        let title: String
        let durationSec: Double
        let expected: String

        var testDescription: String { name }
    }

    private static let fixtureURL: URL = {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 {
            url.deleteLastPathComponent()
        }
        return url
            .appendingPathComponent("spec")
            .appendingPathComponent("fixtures")
            .appendingPathComponent("local-id")
            .appendingPathComponent("cases.json")
    }()

    static let allCases: [LocalIdCase] = {
        guard let data = try? Data(contentsOf: fixtureURL) else { return [] }
        return (try? JSONDecoder().decode([LocalIdCase].self, from: data)) ?? []
    }()

    @Test func theFixtureFileExistsAndIsNonEmpty() {
        #expect(!Self.allCases.isEmpty, "cases.json is missing, empty or unreadable")
    }

    @Test(arguments: LocalIdFixtureTests.allCases)
    func buildMatchesFixture(_ fixture: LocalIdCase) {
        #expect(LocalId.build(artist: fixture.artist, album: fixture.album, title: fixture.title, durationSec: fixture.durationSec) == fixture.expected)
    }
}
