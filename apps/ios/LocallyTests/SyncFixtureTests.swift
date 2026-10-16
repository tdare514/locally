import Foundation
import Testing
@testable import Locally

/// Loads `spec/fixtures/sync/*.json`, the shared record fixtures every app's
/// tests parse (see `spec/sync.md`'s "Fixtures" section). File name prefix
/// says what this app must do with it: `valid-*` must be accepted, every
/// `invalid-*` must be rejected. The client parser checks extensions at
/// decode time, so every `invalid-*` fixture must fail `SyncRecord` decoding.
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
        allFixtureNames.filter { $0.hasPrefix("invalid-") }
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
        #expect(Self.invalidFixtureNames.count > 0)
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

    /// #185: the two origin fixtures decode with their origin kept as given.
    @Test func keepsTheOriginOfAReleaseFromTheWebOrFromAnUnknownClient() throws {
        func origin(of name: String) throws -> String {
            let data = try Data(contentsOf: Self.fixturesDir.appendingPathComponent(name))
            return try JSONDecoder.syncApi.decode(SyncRecord.self, from: data).origin
        }
        #expect(try origin(of: "valid-album-origin-web.json") == "web")
        #expect(try origin(of: "valid-single-origin-unknown.json") == "future-thing")
    }

    @Test(arguments: SyncFixtureTests.invalidFixtureNames)
    func rejectsInvalidFixture(name: String) {
        #expect(!Self.clientAccepts(name), "expected \(name) to be rejected")
    }

    /// #87: the extension list and byte limit are the ones in `spec/sync-file-names.json`.
    @Test func fileNameRulesEqualTheSpecJSON() throws {
        let url = Self.fixturesDir
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("sync-file-names.json")
        let object = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        #expect(SyncFileName.supportedExtensions == object["extensions"] as? [String])
        #expect(ReleaseLayout.maxPlainFileNameLength == object["maxNameBytes"] as? Int)
    }

    /// #87: the limit counts UTF-8 bytes, not characters.
    @Test func nameLimitCountsUTF8Bytes() {
        #expect(ReleaseLayout.isPlainFileName(String(repeating: "あ", count: 85)))
        #expect(!ReleaseLayout.isPlainFileName(String(repeating: "あ", count: 86)))
    }
}
