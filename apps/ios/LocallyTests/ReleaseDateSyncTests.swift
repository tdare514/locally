import Foundation
import Testing
@testable import Locally

struct ReleaseDateSyncTests {
    private static func recordJSON(year: String, releaseDate: String?) -> String {
        let extra = releaseDate.map { ", \"releaseDate\": \"\($0)\"" } ?? ""
        return """
        {"syncVersion": 2, "id": "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90", "kind": "album", "title": "T", "artist": "A",
         "year": "\(year)"\(extra), "genre": null, "cover": null, "tracks": [], "origin": "mac", "originDevice": "M",
         "createdAt": "2026-09-27T20:00:00Z", "updatedAt": "2026-09-27T20:00:00Z", "deleted": false}
        """
    }

    private static func release(_ date: ReleaseDate?) -> Release {
        var release = Release(kind: .single, title: "T", artist: "A", folderPath: "/x", tracks: [],
                              createdAt: Date(timeIntervalSince1970: 1_700_000_000), updatedAt: Date(timeIntervalSince1970: 1_700_000_100))
        release.date = date
        return release
    }

    private func json(of record: SyncRecord) throws -> [String: Any] {
        let data = try JSONEncoder.syncApi.encode(record)
        return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @Test func aDayDateEncodesYearAndReleaseDate() throws {
        let record = Self.release(ReleaseDate("2024-05-17")).toSyncRecord(origin: "ios", originDevice: "P", fileBytes: [:])
        let object = try json(of: record)
        #expect(object["year"] as? String == "2024")
        #expect(object["releaseDate"] as? String == "2024-05-17")
    }

    @Test func aYearOnlyReleaseHasNoReleaseDateKey() throws {
        let record = Self.release(ReleaseDate("2024")).toSyncRecord(origin: "ios", originDevice: "P", fileBytes: [:])
        let object = try json(of: record)
        #expect(object["year"] as? String == "2024")
        #expect(!object.keys.contains("releaseDate"), "absent, never null")
        let none = try json(of: Self.release(nil).toSyncRecord(origin: "ios", originDevice: "P", fileBytes: [:]))
        #expect(none["year"] is NSNull)
        #expect(!none.keys.contains("releaseDate"))
    }

    @Test func decodesTheSharedFixture() throws {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { url.deleteLastPathComponent() }
        url = url.appendingPathComponent("spec/fixtures/sync/valid-album-with-release-date.json")
        let record = try JSONDecoder.syncApi.decode(SyncRecord.self, from: Data(contentsOf: url))
        #expect(record.year == "2024")
        #expect(record.releaseDate == "2024-05-17")
        #expect(record.toRelease().date?.isoString == "2024-05-17")
    }

    @Test func decodesAServerReplyThatCarriesReleaseDate() throws {
        let record = try JSONDecoder.syncApi.decode(SyncRecord.self, from: Data(Self.recordJSON(year: "2024", releaseDate: "2024-05").utf8))
        #expect(record.releaseDate == "2024-05")
        let release = record.toRelease()
        #expect(release.year == "2024" && release.releaseDate == "2024-05")
    }

    @Test(arguments: [("2024", "2024-02-30"), ("2023", "2024-05-17"), ("2024", "2024"), ("2024", "garbage")])
    func aBadOrDisagreeingDateKeepsTheRecordWithItsYear(year: String, releaseDate: String) throws {
        let record = try JSONDecoder.syncApi.decode(SyncRecord.self, from: Data(Self.recordJSON(year: year, releaseDate: releaseDate).utf8))
        let release = record.toRelease()
        #expect(release.year == year)
        #expect(release.releaseDate == nil)
    }

    @Test func aRecordWithoutTheKeyRoundTripsUnchanged() throws {
        let record = try JSONDecoder.syncApi.decode(SyncRecord.self, from: Data(Self.recordJSON(year: "2024", releaseDate: nil).utf8))
        #expect(record.releaseDate == nil)
        let again = try JSONDecoder.syncApi.decode(SyncRecord.self, from: JSONEncoder.syncApi.encode(record))
        #expect(again == record)
        #expect(!(try json(of: record)).keys.contains("releaseDate"))
    }

    @Test func aDayRecordRoundTrips() throws {
        let record = Self.release(ReleaseDate("2024-05-17")).toSyncRecord(origin: "ios", originDevice: "P", fileBytes: [:])
        let again = try JSONDecoder.syncApi.decode(SyncRecord.self, from: JSONEncoder.syncApi.encode(record))
        #expect(again == record)
        #expect(again.toRelease().date == ReleaseDate("2024-05-17"))
    }
}
