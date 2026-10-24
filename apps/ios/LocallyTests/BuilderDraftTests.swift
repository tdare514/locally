import Foundation
import Testing
@testable import Locally

/// The collection builder's rules (#366): a tap, the order, what a collection already holds, the summary line and Done.
@MainActor
struct BuilderDraftTests {
    private static let heldAlbum = Release(
        kind: .album, title: "Low Tide", artist: "The Salt Line", folderPath: "/a", tracks: [
            Track(title: "One", trackNumber: 1, filePath: "1.mp3", originalName: "1.mp3", durationSec: 120),
            Track(title: "Two", trackNumber: 2, filePath: "2.mp3", originalName: "2.mp3", durationSec: 180),
        ])
    private static let single = Release(
        kind: .single, title: "Kitchen Radio", artist: "Mira Valdane", folderPath: "/b", tracks: [
            Track(title: "Kitchen Radio", trackNumber: 1, filePath: "k.mp3", originalName: "k.mp3", durationSec: 60),
        ])
    private static let adopted = Release(
        kind: .album, title: "Harbour Sessions", artist: "Okoro", folderPath: "/mac", tracks: [
            Track(title: "Low Light", trackNumber: 1, filePath: "", originalName: "", durationSec: 241),
        ], source: .adopted)

    private func draft(name: String = "Mix", existing: [CollectionItem]? = nil) -> BuilderDraft {
        BuilderDraft(releases: [Self.heldAlbum, Self.single, Self.adopted], name: name, existing: existing)
    }

    private func song(_ release: Release, _ index: Int = 0) -> BuilderPick {
        BuilderPick(releaseID: release.id, trackID: release.tracks[index].id)
    }

    private func whole(_ release: Release) -> BuilderPick { BuilderPick(releaseID: release.id) }

    @Test func tappingASongPicksItAndTappingAgainDropsIt() {
        let draft = draft()
        let pick = song(Self.heldAlbum)
        draft.toggle(pick)
        let picked: BuilderRowState = draft.state(of: pick)
        #expect(picked == .on)
        draft.toggle(pick)
        let dropped: BuilderRowState = draft.state(of: pick)
        #expect(dropped == .off)
        #expect(draft.picks.isEmpty)
    }

    @Test func aReleaseReplacesItsPickedSongs() {
        let draft = draft()
        draft.toggle(song(Self.heldAlbum, 0))
        draft.toggle(song(Self.single))
        draft.toggle(whole(Self.heldAlbum))
        let expected: [BuilderPick] = [song(Self.single), whole(Self.heldAlbum)]
        #expect(draft.picks == expected)
        let covered: BuilderRowState = draft.state(of: song(Self.heldAlbum, 1))
        #expect(covered == .viaRelease)
    }

    @Test func aSongOfAPickedReleaseCannotBeToggled() {
        let draft = draft()
        draft.toggle(whole(Self.heldAlbum))
        draft.toggle(song(Self.heldAlbum, 1))
        let expected: [BuilderPick] = [whole(Self.heldAlbum)]
        #expect(draft.picks == expected)
    }

    @Test func anExistingItemCannotBeToggled() {
        let draft = draft(existing: [.release(Self.heldAlbum.id), .track(releaseId: Self.single.id, trackId: Self.single.tracks[0].id)])
        draft.toggle(whole(Self.heldAlbum))
        draft.toggle(song(Self.heldAlbum, 1))
        draft.toggle(song(Self.single))
        #expect(draft.picks.isEmpty)
        let existing: BuilderRowState = draft.state(of: song(Self.heldAlbum, 1))
        #expect(existing == .existing)
        #expect(draft.isNew == false)
    }

    @Test func picksKeepTheOrderTheyWereMadeIn() {
        let draft = draft()
        draft.toggle(song(Self.single))
        draft.toggle(song(Self.heldAlbum, 1))
        draft.toggle(whole(Self.adopted))
        let expectedPicks: [BuilderPick] = [song(Self.single), song(Self.heldAlbum, 1), whole(Self.adopted)]
        #expect(draft.picks == expectedPicks)
        let expectedItems: [CollectionItem] = [
            .track(releaseId: Self.single.id, trackId: Self.single.tracks[0].id),
            .track(releaseId: Self.heldAlbum.id, trackId: Self.heldAlbum.tracks[1].id),
            .release(Self.adopted.id),
        ]
        #expect(draft.items == expectedItems)
    }

    @Test func summaryNamesSongsAndMinutes() {
        let draft = draft()
        let empty: String = draft.summary
        #expect(empty == "Pick some music")
        draft.toggle(song(Self.single))
        let one: String = draft.summary
        #expect(one == "1 song \u{00B7} 1 min")
        draft.toggle(whole(Self.heldAlbum))
        let three: String = draft.summary
        #expect(three == "3 songs \u{00B7} 6 min")
    }

    @Test func anAdoptedSongCountsInSongsButNotMinutes() {
        let draft = draft()
        draft.toggle(song(Self.adopted))
        let only: String = draft.summary
        #expect(only == "1 song")
        draft.toggle(song(Self.single))
        let both: String = draft.summary
        #expect(both == "2 songs \u{00B7} 1 min")
        let seconds: Double = draft.seconds
        #expect(seconds == 60)
    }

    @Test func addingToACollectionSaysNewSongs() {
        let draft = draft(existing: [.release(Self.heldAlbum.id)])
        draft.toggle(song(Self.single))
        let one: String = draft.summary
        #expect(one == "1 new song \u{00B7} 1 min")
    }

    @Test func doneNeedsAValidNameAndSomethingPicked() {
        let draft = draft(name: "")
        draft.toggle(song(Self.single))
        #expect(draft.canFinish == false)
        draft.name = "   "
        #expect(draft.canFinish == false)
        draft.name = String(repeating: "x", count: 101)
        #expect(draft.canFinish == false)
        draft.name = " Rainy Sunday "
        #expect(draft.canFinish)
        draft.toggle(song(Self.single))
        #expect(draft.canFinish == false)
    }

    @Test func addMusicNeedsNoNameButAPick() {
        let draft = draft(name: "", existing: [.release(Self.heldAlbum.id)])
        #expect(draft.canFinish == false)
        draft.toggle(song(Self.single))
        #expect(draft.canFinish)
    }

    @Test func closeAsksOnlyWhenANameIsTypedOrSomethingIsPicked() {
        let draft = draft(name: "")
        #expect(draft.hasChanges == false)
        draft.name = "Mix"
        #expect(draft.hasChanges)
        draft.name = ""
        draft.toggle(song(Self.single))
        #expect(draft.hasChanges)
    }

    @Test func searchFindsSongsByTitleOrArtistWords() {
        let draft = draft()
        draft.query = "salt one"
        let titles: [String] = draft.songMatches.map(\.track.title)
        #expect(titles == ["One"])
        let releases: [String] = draft.releaseMatches.map(\.title)
        #expect(releases == ["Low Tide"])
    }

    @Test func aDraftOneAwayFromFullTakesOnePickAndRefusesTheNext() {
        let draft = BuilderDraft(releases: [Self.heldAlbum, Self.single], name: "Mix", limit: 1)
        draft.toggle(song(Self.heldAlbum, 0))
        let picked: Int = draft.picks.count
        #expect(picked == 1)
        draft.toggle(song(Self.single))
        let after: Int = draft.picks.count
        #expect(after == 1)
        #expect(draft.isFull)
    }

    @Test func oneAwayFromFullAcceptsOneThenRefuses() {
        let draft = BuilderDraft(releases: [Self.heldAlbum, Self.single], name: "Mix", limit: 2)
        draft.toggle(song(Self.heldAlbum, 0))
        let left: Int = draft.remaining
        #expect(left == 1)
        draft.toggle(song(Self.single))
        let picked: Int = draft.picks.count
        #expect(picked == 2)
        draft.toggle(song(Self.heldAlbum, 1))
        let after: Int = draft.picks.count
        #expect(after == 2)
    }

    @Test func aFullDraftRefusesButStillDropsAPick() {
        let draft = BuilderDraft(releases: [Self.heldAlbum, Self.single], name: "Mix", limit: 1)
        draft.toggle(whole(Self.single))
        draft.toggle(whole(Self.heldAlbum))
        let expected: [BuilderPick] = [whole(Self.single)]
        #expect(draft.picks == expected)
        draft.toggle(whole(Self.single))
        #expect(draft.picks.isEmpty)
    }

    @Test func remainingCountsExistingItemsAndAReleaseIsOneItem() {
        let existing: [CollectionItem] = [.release(Self.single.id)]
        let draft = BuilderDraft(releases: [Self.heldAlbum, Self.single], name: "Mix", existing: existing, limit: 4)
        let start: Int = draft.remaining
        #expect(start == 3)
        draft.toggle(whole(Self.heldAlbum))
        let afterRelease: Int = draft.remaining
        #expect(afterRelease == 2)
        #expect(draft.songCount == 2)
    }

    @Test func aWholeReleaseTapFitsWhenItFreesItsPickedSongs() {
        let draft = BuilderDraft(releases: [Self.heldAlbum], name: "Mix", limit: 2)
        draft.toggle(song(Self.heldAlbum, 0))
        draft.toggle(song(Self.heldAlbum, 1))
        draft.toggle(whole(Self.heldAlbum))
        let expected: [BuilderPick] = [whole(Self.heldAlbum)]
        #expect(draft.picks == expected)
    }

    @Test func atCapacityOnlyAPickedRowOrAFreeingReleaseCanBePicked() {
        let draft = BuilderDraft(releases: [Self.heldAlbum, Self.single], name: "Mix", limit: 2)
        draft.toggle(song(Self.heldAlbum, 0))
        draft.toggle(song(Self.heldAlbum, 1))
        let unpickedSong: Bool = draft.canPick(song(Self.single))
        let removing: Bool = draft.canPick(song(Self.heldAlbum, 0))
        let freeing: Bool = draft.canPick(whole(Self.heldAlbum))
        let unpickedRelease: Bool = draft.canPick(whole(Self.single))
        #expect(unpickedSong == false)
        #expect(removing == true)
        #expect(freeing == true)
        #expect(unpickedRelease == false)
    }

    @Test func anEmptyQueryReturnsEverySongInOrder() {
        let draft = draft()
        let titles: [String] = draft.songMatches.map(\.track.title)
        let expected: [String] = ["One", "Two", "Kitchen Radio", "Low Light"]
        #expect(titles == expected)
    }
}
