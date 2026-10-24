import Foundation
import Testing
@testable import Locally

@Suite("Track actions per place (#364 part B)")
struct TrackActionRulesTests {
    private func release(artist: String = "Mira Valdane", source: ReleaseSource? = nil, sharedFrom: SharedFrom? = nil) -> Release {
        let track = Track(title: "Orange Streetlight", trackNumber: 1, filePath: "a.mp3", originalName: "a.mp3", durationSec: 200)
        return Release(kind: .album, title: "Night Bus", artist: artist, folderPath: "/lib", tracks: [track], source: source, sharedFrom: sharedFrom)
    }

    @Test("an own release can be edited; an adopted one cannot")
    func edit() {
        let own = TrackActionRules.canEdit(release())
        let adopted = TrackActionRules.canEdit(release(source: .adopted))
        #expect(own)
        #expect(!adopted)
    }

    @Test("share follows the release page: adopted never, received releases only when reshare is allowed, received songs never")
    func share() {
        let own = release()
        let adopted = release(source: .adopted)
        let allowed = release(sharedFrom: SharedFrom(shareId: UUID().uuidString, allowReshare: true))
        let blocked = release(sharedFrom: SharedFrom(shareId: UUID().uuidString, allowReshare: false))
        let song = TrackActionsTarget.track(releaseId: own.id, trackId: own.tracks[0].id)
        let whole = TrackActionsTarget.release(own.id)
        let ownRelease = TrackActionRules.canShare(own, target: whole)
        let ownSong = TrackActionRules.canShare(own, target: song)
        let adoptedRelease = TrackActionRules.canShare(adopted, target: whole)
        let allowedRelease = TrackActionRules.canShare(allowed, target: whole)
        let allowedSong = TrackActionRules.canShare(allowed, target: song)
        let blockedRelease = TrackActionRules.canShare(blocked, target: whole)
        #expect(ownRelease)
        #expect(ownSong)
        #expect(!adoptedRelease)
        #expect(allowedRelease)
        #expect(!allowedSong)
        #expect(!blockedRelease)
    }

    @Test("Go to artist opens the main artist of an 'A feat. B' release, and nothing without a name")
    func artist() {
        let plain = TrackActionRules.artistRoute(for: release(artist: "Mira Valdane"))
        let featured = TrackActionRules.artistRoute(for: release(artist: "Mira Valdane feat. Okoro"))
        let none = TrackActionRules.artistRoute(for: release(artist: ""))
        let expected = ArtistRoute(key: ArtistNames.artistKey("Mira Valdane"))
        #expect(plain == expected)
        #expect(featured == expected)
        #expect(none == nil)
    }

    @Test("the share sheet names the song, or the title for a single")
    func subject() {
        let album = release()
        let song = TrackActionsTarget.track(releaseId: album.id, trackId: album.tracks[0].id)
        let songSubject = TrackActionRules.shareSubject(album, target: song)
        let wholeSubject = TrackActionRules.shareSubject(album, target: .release(album.id))
        #expect(songSubject == "Orange Streetlight")
        #expect(wholeSubject == "Night Bus")
    }
    @Test("a song's page routes Edit to the release in edit mode at the song, and the Album row to the release at the song")
    func songRoutes() {
        let album = release()
        let trackId = album.tracks[0].id
        let route = SongRoute(release: album, trackId: trackId)
        let edit = route.editRoute(for: album)
        let expectedEdit: ReleaseEditRoute? = ReleaseEditRoute(release: album, trackId: trackId)
        let albumRoute = route.albumRoute(for: album)
        let expectedAlbum = ReleaseTrackRoute(release: album, trackId: trackId)
        #expect(edit == expectedEdit)
        #expect(albumRoute == expectedAlbum)
    }

    @Test("an adopted song's page has no Edit route")
    func adoptedSongHasNoEdit() {
        let adopted = release(source: .adopted)
        let route = SongRoute(release: adopted, trackId: adopted.tracks[0].id)
        let edit = route.editRoute(for: adopted)
        #expect(edit == nil)
    }

    @Test("a song's route holds ids only, so it is the same route after the release is edited")
    func songRouteIgnoresEdits() {
        let album = release()
        let trackId = album.tracks[0].id
        var edited = album
        edited.title = "Renamed"
        let before = SongRoute(release: album, trackId: trackId)
        let after = SongRoute(release: edited, trackId: trackId)
        let editRoute = before.editRoute(for: edited)
        let expected: ReleaseEditRoute? = ReleaseEditRoute(release: edited, trackId: trackId)
        #expect(before == after)
        #expect(editRoute == expected)
    }
}
