import Testing
@testable import Locally

/// Guards the "Make it a playlist" copy split done for issue #21: the done
/// screen's heading no longer carries the inline step list, and the shared
/// steps/fallback strings stay stable and free of leftover placeholders.
struct CopyTests {
    @Test func doneAlbumNoLongerInlinesThePlaylistSteps() {
        #expect(!Copy.Import.doneAlbum.contains("select these tracks"))
        #expect(!Copy.Import.doneAlbum.contains("Add to playlist"))
    }

    @Test func makeItAPlaylistStepsNamesTheAlbumAndHasNoPlaceholder() {
        let steps = Copy.Detail.makeItAPlaylistSteps(albumTitle: "Rumours")
        #expect(steps.contains("Rumours"))
        #expect(steps.hasSuffix("Rumours."))
        #expect(!steps.contains("<album>"))
        #expect(steps.hasPrefix("Open Spotify, then Your Library, then Local Files."))
    }

    @Test func makeItAPlaylistFallbackIsExact() {
        #expect(Copy.Detail.makeItAPlaylistFallback == "If Add to playlist is missing, update Spotify and open it again.")
    }

    @Test func noPlaylistCopyUsesAnExclamationMark() {
        let strings = [
            Copy.Import.doneAlbum,
            Copy.Detail.makeItAPlaylistSteps(albumTitle: "Rumours"),
            Copy.Detail.makeItAPlaylistFallback
        ]
        for string in strings {
            #expect(!string.contains("!"))
        }
    }

    @Test func importSilhouetteAndReorderHintCopyIsStable() {
        #expect(Copy.Import.noTracksYet == "No tracks yet")
        #expect(Copy.Import.noTracksHint == "Add audio files above and they'll appear here.")
        #expect(Copy.Import.reorderHint == "Hold and drag a track to reorder.")
        #expect(Copy.Detail.reorderHint == Copy.Import.reorderHint)
        #expect(!Copy.Import.reorderHint.contains("!"))
        #expect(!Copy.Import.noTracksHint.contains("!"))
    }
}
