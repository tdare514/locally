import Foundation
import Testing
@testable import Locally

/// Loads `spec/fixtures/filenames/*.json`, the shared sanitising cases every
/// app's tests run (see `spec/metadata.md`'s "Sanitising a segment" rule).
/// Each case's `expected` is what `ReleaseLayout.sanitizeSegment` must return.
struct FilenameFixtureTests {
    struct FilenameCase: Decodable, CustomTestStringConvertible {
        let name: String
        let input: String?
        let expected: String

        var testDescription: String { name }
    }

    private static let categories = ["illegal-characters", "dots", "control-and-bidi", "whitespace", "length"]

    private static let fixturesDir: URL = {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 {
            url.deleteLastPathComponent()
        }
        return url
            .appendingPathComponent("spec")
            .appendingPathComponent("fixtures")
            .appendingPathComponent("filenames")
    }()

    private static func load(_ category: String) -> [FilenameCase] {
        let url = fixturesDir.appendingPathComponent("\(category).json")
        guard let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([FilenameCase].self, from: data)) ?? []
    }

    private static let allCases: [FilenameCase] = categories.flatMap { load($0) }

    @Test func everyCategoryFileExistsAndIsNonEmpty() {
        for category in Self.categories {
            #expect(!Self.load(category).isEmpty, "\(category).json is missing, empty or unreadable")
        }
    }

    @Test(arguments: FilenameFixtureTests.allCases)
    func sanitizeSegmentMatchesFixture(_ fixture: FilenameCase) {
        #expect(ReleaseLayout().sanitizeSegment(fixture.input) == fixture.expected)
    }
}
