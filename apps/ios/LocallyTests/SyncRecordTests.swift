import Foundation
import Testing
@testable import Locally

struct SyncRecordTests {
    /// Verbatim from `spec/sync.md`'s "Record" section, so this test fails
    /// the moment the wire shape drifts from the spec.
    private static let specExampleJSON = """
    {
      "syncVersion": 1,
      "id": "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90",
      "kind": "album",
      "title": "Night Drive",
      "artist": "Chromatics",
      "year": "2024",
      "genre": null,
      "cover": "cover.jpg",
      "tracks": [
        { "id": "d290f1ee-6c54-4b01-90e6-d701748f0851", "title": "Intro", "trackNumber": 1, "file": "01 - Intro.mp3", "bytes": 5120000, "durationSec": 61.2 }
      ],
      "origin": "mac",
      "originDevice": "Toby's MacBook",
      "createdAt": "2026-09-27T20:00:00Z",
      "updatedAt": "2026-09-27T20:00:00Z",
      "deleted": false
    }
    """

    @Test func decodesTheSpecExampleRecord() throws {
        let data = Self.specExampleJSON.data(using: .utf8)!
        let record = try JSONDecoder.syncApi.decode(SyncRecord.self, from: data)

        #expect(record.syncVersion == 1)
        #expect(record.id == "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90")
        #expect(record.kind == "album")
        #expect(record.title == "Night Drive")
        #expect(record.artist == "Chromatics")
        #expect(record.year == "2024")
        #expect(record.genre == nil)
        #expect(record.cover == "cover.jpg")
        #expect(record.tracks.count == 1)
        #expect(record.tracks[0].id == "d290f1ee-6c54-4b01-90e6-d701748f0851")
        #expect(record.tracks[0].title == "Intro")
        #expect(record.tracks[0].trackNumber == 1)
        #expect(record.tracks[0].file == "01 - Intro.mp3")
        #expect(record.tracks[0].bytes == 5_120_000)
        #expect(record.tracks[0].durationSec == 61.2)
        #expect(record.origin == "mac")
        #expect(record.originDevice == "Toby's MacBook")
        #expect(record.deleted == false)
        #expect(record.version == nil)

        let expectedDate = ISO8601DateFormatter().date(from: "2026-09-27T20:00:00Z")
        #expect(record.createdAt == expectedDate)
        #expect(record.updatedAt == expectedDate)
    }

    /// The server always returns `version` and dates with fractional seconds
    /// (`Date.toISOString()`'s own output), unlike the spec's example.
    @Test func decodesFractionalSecondsAndAServerAssignedVersion() throws {
        let json = """
        { "syncVersion": 1, "id": "abc", "kind": "single", "title": "T", "artist": "A",
          "year": null, "genre": null, "cover": null, "tracks": [],
          "origin": "ios", "originDevice": "Toby's iPhone",
          "createdAt": "2026-09-27T20:00:00.123Z", "updatedAt": "2026-09-27T20:00:01.500Z",
          "deleted": false, "version": 7 }
        """
        let record = try JSONDecoder.syncApi.decode(SyncRecord.self, from: json.data(using: .utf8)!)
        #expect(record.version == 7)
        #expect(record.updatedAt > record.createdAt)
    }

    @Test func roundTripsThroughEncodeAndDecode() throws {
        let original = SyncRecord(
            id: UUID().uuidString,
            kind: "album",
            title: "Some Album",
            artist: "Some Artist",
            year: "2020",
            genre: "Rock",
            cover: "cover.jpg",
            tracks: [
                SyncTrack(id: UUID().uuidString, title: "One", trackNumber: 1, file: "one.mp3", bytes: 100, durationSec: 10.5),
                SyncTrack(id: UUID().uuidString, title: "Two", trackNumber: 2, file: "two.mp3", bytes: 200, durationSec: nil),
            ],
            origin: "ios",
            originDevice: "Toby's iPhone",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            updatedAt: Date(timeIntervalSince1970: 1_700_000_100),
            deleted: false,
            version: 3
        )

        let data = try JSONEncoder.syncApi.encode(original)
        let decoded = try JSONDecoder.syncApi.decode(SyncRecord.self, from: data)

        #expect(decoded == original)
    }

    @Test func releaseToSyncRecordAndBackRoundTripsTheDomainShape() throws {
        let releaseId = UUID()
        let trackId = UUID()
        let release = Release(
            id: releaseId,
            kind: .single,
            title: "My Song",
            artist: "My Artist",
            year: "2021",
            genre: "Pop",
            coverPath: "/tmp/covers/\(releaseId.uuidString).jpg",
            folderPath: "/tmp/spotify",
            tracks: [
                Track(id: trackId, title: "My Song", trackNumber: 1, filePath: "/tmp/spotify/My Artist - My Song - 01 - My Song.mp3", originalName: "input.mp3", durationSec: 180),
            ]
        )

        let record = release.toSyncRecord(origin: "ios", originDevice: "Toby's iPhone", fileBytes: [trackId: 4096])

        #expect(record.id == releaseId.uuidString)
        #expect(record.kind == "single")
        #expect(record.origin == "ios")
        #expect(record.originDevice == "Toby's iPhone")
        #expect(record.cover == "cover.jpg")
        #expect(record.tracks.count == 1)
        #expect(record.tracks[0].id == trackId.uuidString)
        #expect(record.tracks[0].file == "My Artist - My Song - 01 - My Song.mp3")
        #expect(record.tracks[0].bytes == 4096)
        #expect(record.tracks[0].durationSec == 180)

        let downloadedTrackURL = URL(fileURLWithPath: "/tmp/downloaded/My Artist - My Song - 01 - My Song.mp3")
        let rebuilt = record.toRelease(fileURLs: [record.tracks[0].file: downloadedTrackURL])

        #expect(rebuilt.id == releaseId)
        #expect(rebuilt.kind == .single)
        #expect(rebuilt.title == "My Song")
        #expect(rebuilt.tracks[0].id == trackId)
        #expect(rebuilt.tracks[0].filePath == downloadedTrackURL.path)
        #expect(rebuilt.syncedUpdatedAt == record.updatedAt)
    }

    /// A track's byte count is looked up by id; one missing from the map
    /// (e.g. a `stat` failure) encodes as 0 rather than failing the whole
    /// push — `SyncEngine.push` relies on this to never block on a stat error.
    @Test func aTrackMissingFromFileBytesEncodesAsZero() throws {
        let release = Release(
            kind: .single,
            title: "T",
            artist: "A",
            folderPath: "/tmp",
            tracks: [Track(title: "T", trackNumber: 1, filePath: "/tmp/t.mp3", originalName: "t.mp3")]
        )
        let record = release.toSyncRecord(origin: "ios", originDevice: "Device", fileBytes: [:])
        #expect(record.tracks[0].bytes == 0)
    }

    /// The server's `year` schema is `z.string().regex(/^\d{4}$/).nullable()`
    /// (see `apps/api/src/shared/types.ts`) — an empty string fails that
    /// regex and 400s the whole `PUT`. Confirmed live against the running
    /// API during this pass (`{"error":"year: Invalid"}`) against a release
    /// with `year: ""`, so this is encoded as a real regression test, not
    /// just a defensive guess.
    @Test func aBlankYearEncodesAsNilNotAnEmptyString() throws {
        let release = Release(
            kind: .single,
            title: "T",
            artist: "A",
            year: "",
            folderPath: "/tmp",
            tracks: [Track(title: "T", trackNumber: 1, filePath: "/tmp/t.mp3", originalName: "t.mp3")]
        )
        let record = release.toSyncRecord(origin: "ios", originDevice: "Device", fileBytes: [:])
        #expect(record.year == nil)
    }

    /// The actual root cause behind a live-verified 400 during this pass:
    /// Swift's synthesized `Encodable` for an `Optional` property (the
    /// default, `encodeIfPresent`-like behaviour) *omits the JSON key
    /// entirely* when the value is `nil`. The server's `durationSec`,
    /// `year`, `genre` and `cover` fields are all `z.<type>().nullable()` —
    /// the key must be present (`null` is fine); a missing key is a zod
    /// "Required" error, not "Invalid". Reproduced live: `PUT`ing a track
    /// with no `durationSec` key at all returned
    /// `{"error":"tracks.0.durationSec: Required"}}`; adding an explicit
    /// `"durationSec": null` made the identical request succeed. This test
    /// inspects the actual JSON `Data`, not just the decoded Swift value —
    /// a JSONDecoder round trip alone can't catch a missing-vs-null key,
    /// since both decode to the same `nil`.
    /// `coverHash` arrived with `syncVersion` 2. A v1 record has no key at
    /// all, a v2 record without a cover has `null`; both decode to `nil`.
    @Test func coverHashDecodesWhetherPresentNullOrAbsent() throws {
        let hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        let base = Self.specExampleJSON
        let v1 = try JSONDecoder.syncApi.decode(SyncRecord.self, from: base.data(using: .utf8)!)
        #expect(v1.coverHash == nil)

        let withHash = base.replacingOccurrences(of: "\"cover\": \"cover.jpg\",", with: "\"cover\": \"cover.jpg\", \"coverHash\": \"\(hash)\",")
            .replacingOccurrences(of: "\"syncVersion\": 1", with: "\"syncVersion\": 2")
        let v2 = try JSONDecoder.syncApi.decode(SyncRecord.self, from: withHash.data(using: .utf8)!)
        #expect(v2.syncVersion == 2)
        #expect(v2.coverHash == hash)

        let withNull = base.replacingOccurrences(of: "\"cover\": \"cover.jpg\",", with: "\"cover\": null, \"coverHash\": null,")
        let v2NoCover = try JSONDecoder.syncApi.decode(SyncRecord.self, from: withNull.data(using: .utf8)!)
        #expect(v2NoCover.coverHash == nil)
    }

    @Test func nilOptionalFieldsEncodeAsExplicitNullNeverAsAMissingKey() throws {
        let track = SyncTrack(id: "t1", title: "T", trackNumber: 1, file: "t.mp3", bytes: 0, durationSec: nil)
        let record = SyncRecord(
            id: "r1", kind: "single", title: "T", artist: "A",
            year: nil, genre: nil, cover: nil, tracks: [track],
            origin: "ios", originDevice: "Device", createdAt: Date(), updatedAt: Date()
        )

        let data = try JSONEncoder.syncApi.encode(record)
        let json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let tracksJSON = try #require(json["tracks"] as? [[String: Any]])

        #expect(json.keys.contains("year"), "the key must be present, not omitted")
        #expect(json["year"] is NSNull)
        #expect(json.keys.contains("genre"))
        #expect(json["genre"] is NSNull)
        #expect(json.keys.contains("cover"))
        #expect(json["cover"] is NSNull)
        #expect(json.keys.contains("coverHash"))
        #expect(json["coverHash"] is NSNull)
        #expect(tracksJSON[0].keys.contains("durationSec"))
        #expect(tracksJSON[0]["durationSec"] is NSNull)
    }
}
