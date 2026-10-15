import Foundation
import Testing
@testable import Locally

/// Per-device play counts on the release page (#108): wire decoding and the
/// view model's read-only loading. The phone never adds counts.
@MainActor
struct ReleasePlaysTests {
    private let sampleJSON = """
    { "tracks": [ { "trackId": "AAAAAAAA-0000-0000-0000-000000000001", "total": 12, "devices": [
      { "deviceId": "d1", "name": "Tom's MacBook", "platform": "macos", "count": 9, "current": false },
      { "deviceId": "d2", "name": "Tom's iPhone", "platform": "ios", "count": 3, "current": true } ] } ] }
    """

    private func makeModel(
        trackIds: [UUID],
        api: FakeSyncApi,
        signedIn: Bool
    ) -> ReleaseDetailViewModel {
        let coverStore = FakeCoverStore()
        let tagWriter = FakeTagWriter()
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: tagWriter,
            id3TagWriter: tagWriter,
            folder: FakeSpotifyFolder(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)),
            library: InMemoryLibraryStore(),
            coverStore: coverStore
        )
        let tracks = trackIds.enumerated().map {
            Track(id: $0.element, title: "T\($0.offset + 1)", trackNumber: $0.offset + 1, filePath: "/x/\($0.offset).mp3", originalName: "\($0.offset).mp3")
        }
        let release = Release(kind: .album, title: "A", artist: "B", folderPath: "/x", tracks: tracks)
        return ReleaseDetailViewModel(release: release, coordinator: coordinator, coverStore: coverStore, syncApi: api, isSignedIn: { signedIn })
    }

    private func device(_ name: String, _ count: Int, current: Bool = false) -> SyncDevicePlays {
        SyncDevicePlays(deviceId: name, name: name, platform: "macos", count: count, current: current)
    }

    /// #185: a device on a platform this build has never heard of decodes,
    /// and keeps its name and platform, so it shows as a generic device.
    @Test func decodesADeviceOnAPlatformItHasNeverHeardOf() throws {
        let json = """
        { "tracks": [ { "trackId": "AAAAAAAA-0000-0000-0000-000000000001", "total": 5, "devices": [
          { "deviceId": "d1", "name": "Browser", "platform": "web", "count": 3, "current": false },
          { "deviceId": "d2", "name": "Gadget", "platform": "future-thing", "count": 2, "current": false } ] } ] }
        """
        let plays = try JSONDecoder().decode(SyncReleasePlays.self, from: Data(json.utf8))
        #expect(plays.tracks[0].devices.map(\.name) == ["Browser", "Gadget"])
        #expect(plays.tracks[0].devices.map(\.platform) == ["web", "future-thing"])
    }

    @Test func decodesTheSampleResponse() throws {
        let plays = try JSONDecoder().decode(SyncReleasePlays.self, from: Data(sampleJSON.utf8))
        #expect(plays.tracks.count == 1)
        #expect(plays.tracks[0].total == 12)
        #expect(plays.tracks[0].devices.map(\.count) == [9, 3])
        #expect(plays.tracks[0].devices[1].current)
        #expect(plays.tracks[0].devices[0].platform == "macos")
    }

    @Test func decodesAnEmptyTrackList() throws {
        let plays = try JSONDecoder().decode(SyncReleasePlays.self, from: Data(#"{"tracks":[]}"#.utf8))
        #expect(plays.tracks.isEmpty)
    }

    @Test func totalsLandPerTrackAcrossDevices() async {
        let first = UUID(), second = UUID(), third = UUID()
        let api = FakeSyncApi()
        api.releasePlaysResult = .success(SyncReleasePlays(tracks: [
            SyncTrackPlays(trackId: first.uuidString.lowercased(), total: 12, devices: [device("Phone", 3, current: true), device("Mac", 9)]),
            SyncTrackPlays(trackId: second.uuidString, total: 0, devices: [device("Mac", 0)]),
            SyncTrackPlays(trackId: third.uuidString, total: 5, devices: []),
        ]))
        let model = makeModel(trackIds: [first, second, third], api: api, signedIn: true)
        await model.loadPlays()

        #expect(model.playTotal(for: model.trackRows[0]) == 12)
        #expect(model.playTotal(for: model.trackRows[1]) == nil)
        #expect(model.playTotal(for: model.trackRows[2]) == 5)
        #expect(model.hasPlays)
        #expect(api.releasePlaysCalls == [model.releaseId.uuidString])
    }

    @Test func signedOutDoesNotCallTheApi() async {
        let id = UUID()
        let api = FakeSyncApi()
        api.releasePlaysResult = .success(SyncReleasePlays(tracks: [SyncTrackPlays(trackId: id.uuidString, total: 2, devices: [device("Mac", 2)])]))
        let model = makeModel(trackIds: [id], api: api, signedIn: false)
        await model.loadPlays()
        #expect(api.releasePlaysCalls.isEmpty)
        #expect(model.playTotal(for: model.trackRows[0]) == nil)
        #expect(!model.hasPlays)
    }

    @Test func aThrowingApiShowsNothing() async {
        let id = UUID()
        let api = FakeSyncApi()
        api.releasePlaysResult = .failure(SyncApiError.network("offline"))
        let model = makeModel(trackIds: [id], api: api, signedIn: true)
        await model.loadPlays()
        #expect(api.releasePlaysCalls.count == 1)
        #expect(model.playTotal(for: model.trackRows[0]) == nil)
        #expect(!model.hasPlays)
    }
}
