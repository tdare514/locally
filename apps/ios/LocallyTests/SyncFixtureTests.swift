import Foundation
import Testing
@testable import Locally

/// Loads `spec/fixtures/sync/*.json`, the shared record fixtures every app's
/// tests parse (see `spec/sync.md`'s "Fixtures" section). File name prefix
/// says what this app must do with it: `valid-*` must be accepted, `invalid-*`
/// (but not `invalid-api-*`) must be rejected, and `invalid-api-*` is the
/// API's problem only — the client parser doesn't check file extensions, so
/// those fixtures are skipped here entirely.
struct SyncFixtureTests {
    private static let fixturesDir: URL = {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 {
            url.deleteLastPathComponent()
        }
        return url
            .appendingPathComponent("spec")
            .appendingPathComponent("fixtures")
            .appendingPathComponent("sync")
    }()

    private static let allFixtureNames: [String] = {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: fixturesDir.path)) ?? []
        return names.filter { $0.hasSuffix(".json") }.sorted()
    }()

    private static var validFixtureNames: [String] {
        allFixtureNames.filter { $0.hasPrefix("valid-") }
    }

    private static var invalidFixtureNames: [String] {
        allFixtureNames.filter { $0.hasPrefix("invalid-") && !$0.hasPrefix("invalid-api-") }
    }

    /// The client acceptance test SyncEngine actually applies to an incoming
    /// record: it must decode, and every file name it will use as a path
    /// component (`tracks[].file`, `cover` when present) must be a plain
    /// child name.
    private static func clientAccepts(_ name: String) -> Bool {
        let url = fixturesDir.appendingPathComponent(name)
        guard let data = try? Data(contentsOf: url) else { return false }
        guard let record = try? JSONDecoder.syncApi.decode(SyncRecord.self, from: data) else { return false }
        for track in record.tracks {
            guard ReleaseLayout.isPlainFileName(track.file) else { return false }
        }
        if let cover = record.cover {
            guard ReleaseLayout.isPlainFileName(cover) else { return false }
        }
        return true
    }

    @Test func fixturesDirectoryHasFilesMatchingKnownPrefixes() {
        #expect(!Self.allFixtureNames.isEmpty)
        #expect(!Self.validFixtureNames.isEmpty)
        let invalidApiCount = Self.allFixtureNames.filter { $0.hasPrefix("invalid-api-") }.count
        #expect(Self.invalidFixtureNames.count + invalidApiCount > 0)
        for name in Self.allFixtureNames {
            #expect(
                name.hasPrefix("valid-") || name.hasPrefix("invalid-"),
                "\(name) does not match a known fixture prefix"
            )
        }
    }

    @Test(arguments: SyncFixtureTests.validFixtureNames)
    func acceptsValidFixture(name: String) {
        #expect(Self.clientAccepts(name), "expected \(name) to be accepted")
    }

    @Test(arguments: SyncFixtureTests.invalidFixtureNames)
    func rejectsInvalidFixture(name: String) {
        #expect(!Self.clientAccepts(name), "expected \(name) to be rejected")
    }
}
