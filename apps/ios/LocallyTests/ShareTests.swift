import Foundation
import AVFoundation
import Testing
@testable import Locally

// Sharing on the iPhone (#146, #183): the wire types decoded from the spec's literal JSON, the
// share sheet's logic, the "From your friends" tray, and a claim imported tagged as the snapshot.

private let snapshotJSON = """
{ "kind": "album", "title": "Night Drive", "artist": "Chromatics", "year": "2024", "releaseDate": "2024-05-17",
  "genre": "Synthwave", "cover": "cover.jpg", "coverHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "tracks": [
    { "id": "11111111-1111-4111-8111-111111111111", "title": "Intro", "trackNumber": 1, "discNumber": 1, "file": "01 - Intro.mp3", "bytes": 5120000, "durationSec": 61.2 },
    { "id": "22222222-2222-4222-8222-222222222222", "title": "Outro", "trackNumber": 2, "discNumber": 2, "file": "02 - Outro.mp3", "bytes": 4096 } ] }
"""

struct ShareDecodingTests {
    @Test func decodesASentShareWithIsoDates() throws {
        let json = """
        { "id": "s1", "releaseId": "r1", "trackIds": null, "visibility": "public", "allowReshare": true,
          "expiresAt": "2026-11-22T10:00:00.000Z", "revokedAt": null, "createdAt": "2026-10-23T09:30:00Z",
          "snapshot": \(snapshotJSON),
          "recipients": [ { "email": "a@example.com", "claimedAt": "2026-10-23T11:00:00.500Z" }, { "email": "b@example.com", "claimedAt": null } ],
          "hasLink": true, "parentShareId": null, "downloads": 3 }
        """
        let share = try JSONDecoder.syncApi.decode(SentShare.self, from: Data(json.utf8))
        #expect(share.id == "s1")
        #expect(share.trackIds == nil)
        #expect(share.visibility == .public)
        #expect(share.hasLink && share.downloads == 3 && share.parentShareId == nil)
        #expect(share.expiresAt == SyncDateFormat.decode("2026-11-22T10:00:00.000Z"))
        #expect(share.createdAt == Date(timeIntervalSince1970: 1_792_747_800))
        #expect(share.revokedAt == nil)
        #expect(share.recipients.map(\.email) == ["a@example.com", "b@example.com"])
        #expect(share.recipients[0].claimedAt != nil && share.recipients[1].claimedAt == nil)
        #expect(share.snapshot.releaseDate == "2024-05-17")
        #expect(share.snapshot.tracks[0].discNumber == 1 && share.snapshot.tracks[0].durationSec == 61.2)
        #expect(share.snapshot.tracks[1].durationSec == nil)
    }

    @Test func decodesAReceivedShareAndOmittedOptionalFields() throws {
        let json = """
        { "id": "s2", "from": { "email": "friend@example.com" }, "trackIds": ["22222222-2222-4222-8222-222222222222"],
          "allowReshare": false, "canReshare": false, "expiresAt": null, "createdAt": "2026-10-23T09:30:00Z", "claimedAt": null,
          "snapshot": { "kind": "single", "title": "Solo", "artist": "A", "year": null, "genre": null, "cover": null, "coverHash": null,
            "tracks": [ { "id": "22222222-2222-4222-8222-222222222222", "title": "Solo", "trackNumber": 1, "file": "solo.m4a", "bytes": 10 } ] } }
        """
        let share = try JSONDecoder.syncApi.decode(ReceivedShare.self, from: Data(json.utf8))
        #expect(share.from.email == "friend@example.com")
        #expect(share.trackIds?.count == 1)
        #expect(share.claimedAt == nil && share.expiresAt == nil)
        #expect(share.snapshot.releaseDate == nil && share.snapshot.year == nil)
        #expect(share.snapshot.tracks[0].discNumber == nil)
    }

    @Test func aPageSkipsAShareWhoseSnapshotNamesAFileThisAppRefuses() throws {
        let bad = snapshotJSON.replacingOccurrences(of: "01 - Intro.mp3", with: "01 - Intro.exe")
        func share(_ id: String, _ snapshot: String) -> String {
            """
            { "id": "\(id)", "from": { "email": "f@example.com" }, "trackIds": null, "allowReshare": false, "canReshare": false,
              "expiresAt": null, "createdAt": "2026-10-23T09:30:00Z", "claimedAt": null, "snapshot": \(snapshot) }
            """
        }
        let json = "{ \"shares\": [\(share("ok", snapshotJSON)), \(share("bad", bad))], \"nextCursor\": \"abc\" }"
        let page = try JSONDecoder.syncApi.decode(SharesPage<ReceivedShare>.self, from: Data(json.utf8))
        #expect(page.shares.map(\.id) == ["ok"])
        #expect(page.nextCursor == "abc")
    }

    @Test func decodesTheCreateReply() throws {
        let json = "{ \"share\": null, \"notOnLocally\": [\"x@example.com\"], \"link\": null }"
        let result = try JSONDecoder.syncApi.decode(ShareCreateResult.self, from: Data(json.utf8))
        #expect(result.share == nil && result.notOnLocally == ["x@example.com"] && result.link == nil)
    }

    @Test func statusSeparatesLiveRevokedAndExpired() throws {
        let now = Date()
        func make(expires: Date?, revoked: Date?) -> SentShare {
            SentShare(id: "s", releaseId: "r", trackIds: nil, visibility: .private, allowReshare: false, expiresAt: expires, revokedAt: revoked,
                      createdAt: now, snapshot: ShareSnapshot(kind: "single", title: "T", artist: "A", tracks: []), recipients: [], hasLink: false, parentShareId: nil, downloads: 0)
        }
        #expect(SentShareStatus(make(expires: nil, revoked: nil), now: now).isLive)
        #expect(SentShareStatus(make(expires: now.addingTimeInterval(60), revoked: nil), now: now).isLive)
        #expect(SentShareStatus(make(expires: now.addingTimeInterval(-60), revoked: nil), now: now) == .expired(now.addingTimeInterval(-60)))
        #expect(!SentShareStatus(make(expires: nil, revoked: now), now: now).isLive)
    }
}

@MainActor
struct ShareSheetTests {
    private func makeModel(api: FakeSyncApi = FakeSyncApi(), signedIn: Bool = true, store: ShareGroupStore = InMemoryShareGroupStore()) -> ShareSheetModel {
        ShareSheetModel(releaseId: UUID(), subject: "Night Drive", isSignedIn: signedIn, api: api, groupStore: store)
    }

    @Test func theLinkOptionIsHiddenWhenThePublicSharesAreDisabled() async {
        let api = FakeSyncApi()
        let model = makeModel(api: api)
        await model.loadOptions()
        #expect(!model.showsLinkOption)
        model.linkOn = true
        #expect(!model.usesLink, "a stale toggle never makes a public share")
    }

    @Test func theLinkOptionShowsWhenTheServerSaysPublicSharesAreOn() async {
        let api = FakeSyncApi()
        api.meResult = .success(SyncMeResult(email: "a@b.co", deviceId: "d", deviceName: "n", quota: SyncQuota(usedBytes: 0, limitBytes: 1), publicSharesEnabled: true))
        let model = makeModel(api: api)
        await model.loadOptions()
        #expect(model.showsLinkOption)
        model.linkOn = true
        #expect(model.usesLink)
        #expect(model.canSend, "a link alone is enough")
    }

    @Test func aFailedMeReadLeavesTheLinkOptionHidden() async {
        let api = FakeSyncApi()
        api.meResult = .failure(SyncApiError.unreachable("offline"))
        let model = makeModel(api: api)
        await model.loadOptions()
        #expect(!model.showsLinkOption)
    }

    @Test func commasAndReturnTurnEntriesIntoPills() {
        let model = makeModel()
        model.draft = "Ann@Example.com, bob@example.com,"
        model.draftChanged()
        #expect(model.emails == ["ann@example.com", "bob@example.com"])
        #expect(model.draft == "")
        model.draft = "cy@example.com"
        model.submitDraft()
        #expect(model.emails.count == 3 && model.draft == "")
        model.draft = "ann@example.com"
        model.submitDraft()
        #expect(model.emails.count == 3, "no duplicate pills")
        model.remove("bob@example.com")
        #expect(model.emails == ["ann@example.com", "cy@example.com"])
    }

    @Test func anInvalidEntryIsKeptTypedWithAnError() {
        let model = makeModel()
        model.draft = "nope"
        model.submitDraft()
        #expect(model.emails.isEmpty && model.draft == "nope" && model.emailError == Copy.Share.notAnEmail)
    }

    @Test func groupsAreSavedOnTheDeviceAndAddTheirMembers() {
        let store = InMemoryShareGroupStore()
        let model = makeModel(store: store)
        model.addEmail("a@example.com")
        model.addEmail("b@example.com")
        model.saveGroup(named: "Band")
        #expect(store.all().map(\.name) == ["Band"] && store.all()[0].emails == ["a@example.com", "b@example.com"])

        let other = makeModel(store: store)
        #expect(other.groups.count == 1)
        other.add(other.groups[0])
        #expect(other.emails == ["a@example.com", "b@example.com"])
        other.delete(other.groups[0])
        #expect(store.all().isEmpty)
    }

    @Test func sendBuildsTheRequestAndPluralisesWhoWasReached() async {
        let api = FakeSyncApi()
        let model = makeModel(api: api)
        model.addEmail("a@example.com")
        model.addEmail("ghost@example.com")
        model.allowReshare = true
        model.expiry = .thirtyDays
        let share = SentShare(id: "s", releaseId: "r", trackIds: nil, visibility: .private, allowReshare: true, expiresAt: nil, revokedAt: nil, createdAt: Date(),
                              snapshot: ShareSnapshot(kind: "single", title: "T", artist: "A", tracks: []),
                              recipients: [ShareRecipient(email: "a@example.com", claimedAt: nil)], hasLink: false, parentShareId: nil, downloads: 0)
        api.createShareResult = .success(ShareCreateResult(share: share, notOnLocally: ["ghost@example.com"], link: nil))

        await model.send()

        let request = api.createShareCalls[0]
        #expect(request.recipients == ["a@example.com", "ghost@example.com"])
        #expect(request.visibility == .private && request.allowReshare && request.expiresInDays == 30 && request.trackIds == nil)
        #expect(request.json["expiresInDays"] as? Int == 30)
        #expect(model.outcome == ShareOutcome(sharedCount: 1, notOnLocally: ["ghost@example.com"], link: nil))
        #expect(Copy.Share.sharedWith(1) == "Shared with 1 person")
        #expect(Copy.Share.sharedWith(3) == "Shared with 3 people")
        #expect(Copy.Share.notOnLocally == "Not on Locally yet")
        #expect(Copy.Share.reshareOff == "They can't share it on from Locally")
        #expect(Copy.Share.linkOn == "Anyone with the link can download this")
        #expect(Copy.Share.copyItNow == "Copy it now. Locally can't show this link again.")
    }

    @Test func aTypedButUnconfirmedAddressStillCountsOnSend() async {
        let api = FakeSyncApi()
        let model = makeModel(api: api)
        model.draft = "late@example.com"
        #expect(model.canSend)
        await model.send()
        #expect(api.createShareCalls.first?.recipients == ["late@example.com"])
    }

    @Test func aFailedSendShowsTheErrorAndNoResult() async {
        let api = FakeSyncApi()
        api.createShareResult = .failure(SyncApiError.network(Copy.Share.errorNotSynced))
        let model = makeModel(api: api)
        model.addEmail("a@example.com")
        await model.send()
        #expect(model.outcome == nil && model.errorMessage == Copy.Share.errorNotSynced)
    }

    @Test func signedOutCannotSend() {
        let model = makeModel(signedIn: false)
        model.addEmail("a@example.com")
        #expect(!model.canSend)
    }

    @Test func theDeleteConfirmCountsDistinctLivePeople() async throws {
        let api = FakeSyncApi()
        let library = InMemoryLibraryStore()
        let release = Release(kind: .single, title: "T", artist: "A", folderPath: "/x", tracks: [])
        func sent(_ id: String, emails: [String], revoked: Bool = false, link: Bool = false) -> SentShare {
            SentShare(id: id, releaseId: release.id.uuidString.lowercased(), trackIds: nil, visibility: .private, allowReshare: false, expiresAt: nil,
                      revokedAt: revoked ? Date() : nil, createdAt: Date(), snapshot: ShareSnapshot(kind: "single", title: "T", artist: "A", tracks: []),
                      recipients: emails.map { ShareRecipient(email: $0, claimedAt: nil) }, hasLink: link, parentShareId: nil, downloads: 0)
        }
        api.sentSharesResult = .success([sent("1", emails: ["a@x.co", "b@x.co"]), sent("2", emails: ["A@x.co", "c@x.co"]), sent("3", emails: ["z@x.co"], revoked: true)])
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(), transcoder: FakeTranscoder(), m4aTagWriter: FakeTagWriter(), id3TagWriter: FakeTagWriter(),
            folder: FakeSpotifyFolder(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)),
            library: library, coverStore: FakeCoverStore(), durationReader: FakeDurationReader())
        let model = ReleaseDetailViewModel(release: release, coordinator: coordinator, coverStore: FakeCoverStore(), syncApi: api, isSignedIn: { true })

        await model.loadShareImpact()

        #expect(model.liveSharePeople == 3, "a, b, c: case-insensitive, the revoked share not counted")
        #expect(model.deleteShareWarning == "It's shared with 3 people. They'll lose access.")
        #expect(Copy.Share.deleteWarning(people: 1) == "It's shared with 1 person. They'll lose access.")
    }
}

@MainActor
struct FriendShareTests {
    private struct Harness {
        let library: InMemoryLibraryStore
        let folder: URL
        let api: FakeSyncApi
        let engine: SyncEngine
        let covers: FakeCoverStore
    }

    private func makeHarness(m4aWriter: TagWriter = M4ATagWriter()) -> Harness {
        let library = InMemoryLibraryStore()
        let api = FakeSyncApi()
        let folderDir = FileManager.default.temporaryDirectory.appendingPathComponent("ShareTests-\(UUID().uuidString)", isDirectory: true)
        let folder = FakeSpotifyFolder(directory: folderDir)
        let covers = FakeCoverStore()
        let coordinator = ReleaseCoordinator(
            importer: FakeFileImporter(), transcoder: FakeTranscoder(), m4aTagWriter: m4aWriter, id3TagWriter: ID3TagWriter(),
            folder: folder, library: library, coverStore: covers, durationReader: FakeDurationReader())
        let account = InMemorySyncAccountStore()
        account.save(email: "toby@example.com", deviceToken: "t", deviceId: "d")
        let engine = SyncEngine(api: api, account: account, library: library, coordinator: coordinator, coverStore: covers,
                                outbox: InMemorySyncOutbox(), deviceName: { "Phone" }, defaults: UserDefaults(suiteName: UUID().uuidString)!)
        return Harness(library: library, folder: folderDir, api: api, engine: engine, covers: covers)
    }

    private func received(_ id: String = "share-1", claimed: Date? = nil, snapshot: ShareSnapshot) -> ReceivedShare {
        ReceivedShare(id: id, from: ShareSender(email: "friend@example.com"), trackIds: nil, allowReshare: false, canReshare: false,
                      expiresAt: nil, createdAt: Date(), claimedAt: claimed, snapshot: snapshot)
    }

    private func albumSnapshot() throws -> ShareSnapshot {
        try JSONDecoder.syncApi.decode(ShareSnapshot.self, from: Data(snapshotJSON.utf8))
    }

    // MARK: ID3 read-back

    private func id3Frames(_ url: URL) throws -> [String: String] {
        let bytes = [UInt8](try Data(contentsOf: url))
        #expect(Array(bytes[0..<3]) == [0x49, 0x44, 0x33])
        let end = 10 + ID3TagWriter.desynchsafe(Array(bytes[6...9]))
        var frames: [String: String] = [:]
        var offset = 10
        while offset + 10 <= end {
            let id = String(bytes: bytes[offset..<(offset + 4)], encoding: .ascii) ?? ""
            let size = ID3TagWriter.desynchsafe(Array(bytes[(offset + 4)..<(offset + 8)]))
            if id.isEmpty || id.first == "\0" { break }
            let payload = Data(bytes[(offset + 10)..<(offset + 10 + size)])
            if id.hasPrefix("T") { frames[id] = String(data: payload.dropFirst(), encoding: .utf8) ?? "" } else { frames[id] = "<\(size) bytes>" }
            offset += 10 + size
        }
        return frames
    }

    @Test func aClaimImportsAnAlbumTaggedExactlyAsTheSnapshot() async throws {
        let h = makeHarness()
        defer { try? FileManager.default.removeItem(at: h.folder) }
        let snapshot = try albumSnapshot()
        h.api.fileContents = ["01 - Intro.mp3": Data([0xFF, 0xFB, 1, 2, 3, 4]), "02 - Outro.mp3": Data([0xFF, 0xFB, 5, 6, 7, 8]), "cover.jpg": Data([0xFF, 0xD8, 0xFF, 0xD9])]
        h.api.receivedSharesResult = .success([received(snapshot: snapshot)])
        await h.engine.refreshReceivedShares()
        #expect(h.engine.status.receivedShares.map(\.id) == ["share-1"])

        await h.engine.sendShareToSpotify("share-1")

        #expect(h.engine.status.lastError == nil)
        #expect(h.api.claimedShareIds == ["share-1"])
        #expect(Set(h.api.shareFileRequests.map(\.name)) == ["01 - Intro.mp3", "02 - Outro.mp3", "cover.jpg"])
        #expect(h.api.shareFileRequests.allSatisfy { $0.shareId == "share-1" })
        let release = try #require(try h.library.all().first)
        #expect(h.engine.status.receivedShares.isEmpty)
        #expect(release.title == "Night Drive" && release.artist == "Chromatics" && release.genre == "Synthwave")
        #expect(release.year == "2024" && release.releaseDate == "2024-05-17")
        #expect(release.kind == .album && release.coverPath != nil)
        #expect(release.tracks.map(\.title) == ["Intro", "Outro"])
        #expect(release.tracks.map(\.trackNumber) == [1, 2] && release.tracks.map(\.discNumber) == [1, 2])
        #expect(release.id.uuidString != snapshot.tracks[0].id && Set(release.tracks.map(\.id)).isDisjoint(with: snapshot.tracks.map { UUID(uuidString: $0.id)! }))

        let first = try id3Frames(URL(fileURLWithPath: release.tracks[0].filePath))
        #expect(first["TIT2"] == "Intro" && first["TPE1"] == "Chromatics" && first["TALB"] == "Night Drive")
        #expect(first["TCON"] == "Synthwave" && first["TDRC"] == "2024-05-17" && first["TYER"] == "2024")
        #expect(first["TRCK"] == "1/1" && first["TPOS"] == "1/2")
        #expect(first["APIC"] != nil)
        let second = try id3Frames(URL(fileURLWithPath: release.tracks[1].filePath))
        #expect(second["TIT2"] == "Outro" && second["TRCK"] == "1/1" && second["TPOS"] == "2/2")
        // In the Spotify folder, under the usual flat name.
        #expect((release.tracks[0].filePath as NSString).lastPathComponent == "Chromatics - Night Drive - 01 - Intro.mp3")
        #expect(release.tracks[0].filePath.hasPrefix(h.folder.path))
    }

    @Test func aClaimImportsAnM4aSingleWithItsTagsReadBackFromTheFile() async throws {
        let h = makeHarness()
        defer { try? FileManager.default.removeItem(at: h.folder) }
        let snapshot = ShareSnapshot(
            kind: "single", title: "Solo", artist: "Ann", year: "2023", releaseDate: "2023-03", genre: "Pop", cover: nil, coverHash: nil,
            tracks: [ShareSnapshotTrack(id: UUID().uuidString, title: "Solo", trackNumber: 1, discNumber: 2, file: "solo.m4a", bytes: 10)])
        let m4a = try makeTinyM4A()
        defer { try? FileManager.default.removeItem(at: m4a.dir) }
        h.api.fileContents = ["solo.m4a": try Data(contentsOf: m4a.url)]
        h.api.receivedSharesResult = .success([received(snapshot: snapshot)])
        await h.engine.refreshReceivedShares()

        await h.engine.sendShareToSpotify("share-1")

        #expect(h.engine.status.lastError == nil)
        let release = try #require(try h.library.all().first)
        #expect(release.kind == .single && release.releaseDate == "2023-03" && release.year == "2023")
        let asset = AVAsset(url: URL(fileURLWithPath: release.tracks[0].filePath))
        var values: [String: String] = [:]
        var disc: [UInt8] = [], track: [UInt8] = []
        for format in try await asset.load(.availableMetadataFormats) {
            for item in try await asset.loadMetadata(for: format) {
                guard let identifier = item.identifier else { continue }
                switch identifier {
                case .iTunesMetadataSongName: values["title"] = try await item.load(.stringValue)
                case .iTunesMetadataArtist: values["artist"] = try await item.load(.stringValue)
                case .iTunesMetadataAlbum: values["album"] = try await item.load(.stringValue)
                case .iTunesMetadataUserGenre: values["genre"] = try await item.load(.stringValue)
                case .iTunesMetadataReleaseDate: values["date"] = try await item.load(.stringValue)
                case .iTunesMetadataDiscNumber: disc = [UInt8](try await item.load(.dataValue) ?? Data())
                case .iTunesMetadataTrackNumber: track = [UInt8](try await item.load(.dataValue) ?? Data())
                default: break
                }
            }
        }
        #expect(values["title"] == "Solo" && values["artist"] == "Ann" && values["album"] == "Solo" && values["genre"] == "Pop")
        #expect(values["date"] == "2023-03")
        #expect(disc.count == 8 && disc[3] == 2 && disc[5] == 2, "disc 2 of 2")
        #expect(track.count == 8 && track[3] == 1 && track[5] == 1)
    }

    private func makeTinyM4A() throws -> (dir: URL, url: URL) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("ShareM4A-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("src.m4a")
        let file = try AVAudioFile(forWriting: url, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44100.0, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 64000])
        let buffer = try #require(AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 4410))
        buffer.frameLength = buffer.frameCapacity
        try file.write(from: buffer)
        return (dir, url)
    }

    @Test func aFileNameThatEscapesIsRefusedAndNothingIsWritten() async throws {
        let h = makeHarness()
        defer { try? FileManager.default.removeItem(at: h.folder) }
        // `ShareSnapshot.init(from:)` only checks the extension; the engine's plain-name check refuses the rest.
        let snapshot = ShareSnapshot(kind: "single", title: "T", artist: "A", tracks: [
            ShareSnapshotTrack(id: UUID().uuidString, title: "T", trackNumber: 1, file: "../evil.mp3", bytes: 1)])
        h.api.receivedSharesResult = .success([received(snapshot: snapshot)])
        await h.engine.refreshReceivedShares()

        await h.engine.sendShareToSpotify("share-1")

        #expect(try h.library.all().isEmpty)
        #expect(h.api.downloadFileCalls.isEmpty)
        #expect(h.engine.status.failedShareIds == ["share-1"])
        let written = (try? FileManager.default.contentsOfDirectory(atPath: h.folder.path)) ?? []
        #expect(written.isEmpty)
    }

    @Test func aFailedSendKeepsTheRowEvenOnceTheServerMarksItClaimed() async throws {
        let h = makeHarness()
        defer { try? FileManager.default.removeItem(at: h.folder) }
        let snapshot = try albumSnapshot()
        h.api.receivedSharesResult = .success([received(snapshot: snapshot)])
        h.api.downloadFailCountRemaining = ["01 - Intro.mp3": 1]
        await h.engine.refreshReceivedShares()

        await h.engine.sendShareToSpotify("share-1")
        #expect(h.engine.status.failedShareIds == ["share-1"])
        #expect(try h.library.all().isEmpty)

        // The server now lists it as claimed (the claim came first), but it has not been imported.
        h.api.receivedSharesResult = .success([received(claimed: Date(), snapshot: snapshot)])
        await h.engine.refreshReceivedShares()
        #expect(h.engine.status.receivedShares.map(\.id) == ["share-1"])
        let rows = DevicesTrayModel.friendRows(shares: h.engine.status.receivedShares, accepting: [], failed: h.engine.status.failedShareIds)
        #expect(rows.first?.state == .failed && rows.first?.showsRetry == true)

        await h.engine.sendShareToSpotify("share-1")
        #expect(h.engine.status.receivedShares.isEmpty && h.engine.status.failedShareIds.isEmpty)
        #expect(try h.library.all().count == 1)
    }

    @Test func theTrayHidesAClaimedShareAndShowsTheSenderAsTheOriginLine() async throws {
        let h = makeHarness()
        let snapshot = try albumSnapshot()
        h.api.receivedSharesResult = .success([received("open", snapshot: snapshot), received("done", claimed: Date(), snapshot: snapshot)])

        await h.engine.refreshReceivedShares()

        #expect(h.engine.status.receivedShares.map(\.id) == ["open"])
        let rows = DevicesTrayModel.friendRows(shares: h.engine.status.receivedShares, accepting: [], failed: [])
        #expect(rows.count == 1 && rows[0].originLine == "from friend@example.com" && rows[0].trackCount == 2)
        #expect(DevicesTrayModel.friendRows(shares: [received("done", claimed: Date(), snapshot: snapshot)], accepting: [], failed: []).isEmpty)
    }

    @Test func dismissHidesTheShareOnTheServerAndInTheTray() async throws {
        let h = makeHarness()
        h.api.receivedSharesResult = .success([received(snapshot: try albumSnapshot())])
        await h.engine.refreshReceivedShares()

        await h.engine.dismissShare("share-1")

        #expect(h.api.hiddenShareIds == ["share-1"])
        #expect(h.engine.status.receivedShares.isEmpty)
    }

    @Test func aReconcileRefreshesTheFriendsTrayAndAnOlderApiLeavesItAlone() async throws {
        let h = makeHarness()
        h.api.receivedSharesResult = .success([received(snapshot: try albumSnapshot())])
        await h.engine.reconcile()
        #expect(h.engine.status.receivedShares.count == 1)

        h.api.receivedSharesResult = .failure(SyncApiError.notFound)
        await h.engine.reconcile()
        #expect(h.engine.status.receivedShares.count == 1, "a failed read keeps the list")
        #expect(h.engine.status.lastError == nil)
    }
}
