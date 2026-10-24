#if DEBUG
import SwiftUI

/// Debug-only harness for deterministic screenshots of the immersive components. Launch the app
/// with `-componentGallery <name>`; see `LocallyApp`.
struct ComponentGallery: View {
    static let names = StatsPopupGallery.names + TrackActionsGallery.names + ["sleeve-filled", "sleeve-empty", "sleeve-ceremony", "sleeve-bright", "sleeve-dark", "backdrop-a", "backdrop-b", "inline-field", "cover-sheet",
        // #160: the studio backdrop and the real Settings with sample sync state.
        "studio-backdrop", "settings-signed-in", "settings-signed-out", "settings-code-sent", "settings-scrolled", "migration-banner", "root-banner",
        // #205: the release page's tracks panel (the shared `TrackRow`, preset rows).
        "release-tracks",
        // Kind switch and cover glow buttons, on the studio backdrop.
        "controls",
        // #336: the release page with a row playing under the mini player, at the default size and at accessibility3, and the bar paused.
        "player-release", "player-release-ax3", "player-mini-paused",
        // #226: Dynamic Type checks of screens that need no sample data.
        "library-empty", "onboarding", "paywall",
        // #204: the real Stats page over sample plays.
        "stats-week", "stats-albums-grid", "stats-artists", "stats-quiet", "stats-signed-out", "stats-large-text", "stats-week-scrolled", "stats-grid-scrolled",
        // #213: the Mac's glyphs on the real tab bar, library and release page, over seeded sample data.
        "icons-tabs-library", "icons-tabs-stats", "icons-library-list", "icons-library-grid", "icons-release", "icons-release-bottom", "icons-cover-edit", "icons-playlist-guide",
        // #269: the Library's "From your devices" button and tray, over sample pending records.
        "devices-header-0", "devices-header-1", "devices-header-3", "devices-tray-open", "devices-tray-large-text", "devices-tray-failed",
        // #296: view mode in the Mac's look, no cover, the empty sleeve in edit mode, the tray's sections.
        "release-view-nocover", "release-edit-nocover", "release-view-large-text", "release-view-large-text-bottom", "devices-tray-sections", "devices-tray-sections-large-text",
        // #287: the Featuring field. The import cases are `import-record-featuring` and `import-record-album-featuring-sheet`.
        "release-featuring-view", "release-featuring-edit", "featuring-fields-ax",
        // #288: the Artists view, artist pages, the sort control and linked names, over seeded sample data.
        "artists-view", "artist-page", "artist-page-featured", "artist-page-bottom", "library-sort-menu", "release-links",
        // #226: the library search box with a typed query, and the crop sheet's Square / Original pill.
        "icons-library-search", "crop-sheet", "devices-header-narrow",
        // #221: the Release date row. The import case is `import-record-date`.
        "release-date-edit", "release-date-view", "release-date-sheet", "release-date-invalid", "release-date-xxxl", "release-date-ax", "release-date-ax5", "release-date-narrow", "release-date-save",
        // #183: sharing. The share sheet, its Link option and result, the friends tray, "Shared by you".
        "share-sheet", "share-sheet-link", "share-sheet-result", "share-sheet-signed-out", "share-sheet-large-text",
        "devices-tray-friends", "devices-tray-friends-large-text", "shared-by-you", "shared-by-you-large-text", "release-share-blocked",
        // #362: a release opened from one of its tracks, the row mid-highlight.
        "release-track-highlight", "release-track-highlight-long", "release-track-highlight-ax", "release-track-highlight-bright", "release-track-highlight-dark", "release-track-plain-long", "stats-open-track",
        // #350: collections in List view over seeded sample collections.
        "collections-library", "collections-screen", "collections-queue", "collections-edit", "collections-empty", "collections-queue-ax", "collections-add", "collections-playing", "collections-add-failed", "collections-wont-play", "collections-playlist-guide", "collections-none-here",
        // #352: the record player on the Collections screen, over seeded collections and a player on fakes.
        "collections-player-playing", "collections-player-browsing", "collections-player-paused", "collections-player-vinyl", "collections-player-reduce-motion",
        "collections-player-ax", "collections-player-narrow", "collections-player-empty", "collections-player-wont-play", "collections-player-many", "collections-player-ax-lower", "collections-player-ax-controls", "collections-player-narrow-lower"]

    let name: String
    @State private var title = "Midnight Drive"
    @State private var empty = ""

    private static let paletteA = (
        primary: Color(red: 0.32, green: 0.10, blue: 0.45),
        secondary: Color(red: 0.45, green: 0.08, blue: 0.20),
        deep: Color(red: 0.12, green: 0.04, blue: 0.16)
    )
    private static let paletteB = (
        primary: Color(red: 0.05, green: 0.30, blue: 0.30),
        secondary: Color(red: 0.30, green: 0.18, blue: 0.02),
        deep: Color(red: 0.02, green: 0.10, blue: 0.10)
    )

    /// The #160 screens draw their own backdrop.
    private var drawsOwnBackdrop: Bool {
        name.hasPrefix("collections-") || name.hasPrefix("player-") || name.hasPrefix("stats-") || name.hasPrefix("icons-") || name.hasPrefix("devices-") || name.hasPrefix("share") || ["studio-backdrop", "settings-signed-in", "settings-signed-out", "settings-code-sent", "settings-scrolled", "root-banner", "release-tracks", "controls", "paywall", "onboarding", "library-empty", "crop-sheet", "release-featuring-view", "release-featuring-edit", "featuring-fields-ax", "artists-view", "artist-page", "artist-page-featured", "artist-page-bottom", "library-sort-menu", "release-links", "release-date-edit", "release-date-view", "release-date-sheet", "release-date-invalid", "release-date-xxxl", "release-date-ax", "release-date-ax5", "release-date-narrow", "release-date-save", "release-share-blocked", "release-track-highlight", "release-track-highlight-long", "release-track-highlight-ax", "release-track-highlight-bright", "release-track-highlight-dark", "release-track-plain-long"].contains(name)
    }

    var body: some View {
        if name.hasPrefix("import-record-") || name.hasPrefix("import-sent-") {
            ImportRecordGallery(name: name).preferredColorScheme(.dark)
        } else if name.hasPrefix("import-") {
            ZStack {
                StudioBackdrop()
                importContent
            }
            .preferredColorScheme(.dark)
        } else if drawsOwnBackdrop {
            content.preferredColorScheme(.dark)
        } else {
            sleeveGallery
        }
    }

    private var sleeveGallery: some View {
        let palette = name == "backdrop-b" ? Self.paletteB : Self.paletteA
        return ZStack {
            if let cover = Self.edgeCover(name) {
                // As on the release page: the wash is derived from the cover itself.
                ArtworkBackdrop(palette: ArtworkPalette.palette(forCover: cover.pngData()))
            } else {
                ArtworkBackdrop(primary: palette.primary, secondary: palette.secondary, deep: palette.deep)
            }
            content
        }
        .preferredColorScheme(.dark)
    }

    /// The bright and dark covers the sleeve's rim is checked against.
    private static func edgeCover(_ name: String) -> UIImage? {
        switch name {
        case "sleeve-bright": SampleArtwork.bright
        case "sleeve-dark": SampleArtwork.dark
        default: nil
        }
    }

    @ViewBuilder
    private var content: some View {
        switch name {
        case "sleeve-filled":
            RecordSleeve(cover: SampleArtwork.sunset, onAddCover: {})
        case "sleeve-bright":
            RecordSleeve(cover: SampleArtwork.bright, onAddCover: {})
        case "sleeve-dark":
            RecordSleeve(cover: SampleArtwork.dark, onAddCover: {})
        case "sleeve-empty":
            RecordSleeve(cover: nil, onAddCover: {})
        case "sleeve-ceremony":
            RecordSleeve(cover: SampleArtwork.sunset, pose: .halfTucked, onAddCover: {})
        case "inline-field":
            VStack(alignment: .leading, spacing: Theme.Spacing.sectionGap) {
                InlineField("Title", text: $empty, role: .pageTitle)
                InlineField("Title", text: $title, role: .pageTitle)
            }
            .padding(Theme.Spacing.pagePadding)
        case "cover-sheet":
            // Two stub recent covers; the sheet is the real one, held open.
            Color.clear.sheet(isPresented: .constant(true)) {
                CoverChoiceSheet(
                    recents: [
                        RecentCover(id: UUID(), title: "Midnight Drive", artist: "Neon Harbor", thumbnail: SampleArtwork.sunset),
                        RecentCover(id: UUID(), title: "Low Tide", artist: "The Salt Line", thumbnail: SampleArtwork.ocean)
                    ],
                    hasCover: true,
                    onChoose: { _ in }
                )
            }
        case "studio-backdrop":
            StudioBackdrop()
        case "root-banner":
            RootBannerGallery()
        case "migration-banner":
            VStack { MigrationNoticeBanner(text: Copy.Settings.songsMoved(count: 12), onDismiss: {}); Spacer() }
        case "settings-signed-in":
            Self.settings(signedIn: true)
        case "settings-signed-out":
            Self.settings(signedIn: false)
        case "settings-code-sent":
            // The sign-in's second step (a code was sent), without sending one.
            Self.settings(signedIn: false, codeSentTo: "sample@example.com")
        case "settings-scrolled":
            // Opens at the bottom of the page, to see the lower groups and the edge fade.
            Self.settings(signedIn: true)
        case _ where StatsPopupGallery.names.contains(name):
            StatsPopupGallery.page(name)
        case "stats-week":
            StatsGallery.page(.week)
        case "stats-week-scrolled":
            StatsGallery.page(.week)
        case "stats-albums-grid":
            StatsGallery.page(.albumsGrid)
        case "stats-grid-scrolled":
            StatsGallery.page(.albumsGrid)
        case "stats-artists":
            StatsGallery.page(.artists)
        case "stats-quiet":
            StatsGallery.page(.quiet)
        case "stats-signed-out":
            StatsGallery.page(.signedOut)
        case "stats-signed-out-ax3":
            StatsGallery.page(.signedOut).dynamicTypeSize(.accessibility3)
        case "stats-week-scrolled-ax3":
            StatsGallery.page(.week).dynamicTypeSize(.accessibility3)
        case "stats-large-text":
            StatsGallery.page(.week).dynamicTypeSize(.accessibility2)
        case "release-tracks":
            Self.releaseTracks
        case "release-review-error":
            ReleaseReviewErrorGallery()
        case "controls":
            ControlsGallery()
        case "library-empty":
            ZStack {
                Theme.background.ignoresSafeArea()
                LibraryEmptyState(onAddSingle: {}, onMakeAlbum: {})
            }
        case "onboarding":
            OnboardingView(onFinished: {}).environment(FolderStatus(isConnected: false))
        case "paywall":
            PaywallView()
        case "featuring-fields-ax":
            FeaturingFieldsGallery()
        case "artists-view":
            IconsGallery.artistsLibrary(layout: .artists)
        case "artist-page":
            IconsGallery.artistPage(name: "Mira Valdane")
        case "artist-page-featured":
            IconsGallery.artistPage(name: "Jonah Reyes")
        case "artist-page-bottom":
            IconsGallery.artistPage(name: "Mira Valdane")
        case "library-sort-menu":
            IconsGallery.artistsLibrary(layout: .list, sort: .title)
        case "release-links":
            IconsGallery.linkedRelease()
        case "release-date-edit":
            IconsGallery.dateRelease(editing: true)
        case "release-date-view":
            IconsGallery.dateRelease()
        case "release-date-sheet":
            ReleaseDateFieldGallery(text: "17 May 2024", opensSheet: true)
        case "release-date-invalid":
            ReleaseDateFieldGallery(text: "31/02/2024")
        case "release-date-xxxl":
            IconsGallery.dateRelease(editing: true).dynamicTypeSize(.xxxLarge)
        case "release-date-ax":
            ReleaseDateFieldGallery(text: "17 May 2024").dynamicTypeSize(.accessibility3)
        case "release-date-ax5":
            ReleaseDateFieldGallery(text: "17 September 2024").dynamicTypeSize(.accessibility5)
        case "release-date-narrow":
            ReleaseDateFieldGallery(text: "17 September 2024").frame(width: 300)
        case "release-date-save":
            IconsGallery.saveableDateRelease()
        case "release-featuring-view":
            IconsGallery.featuringRelease()
        case "release-featuring-edit":
            IconsGallery.featuringRelease(editing: true)
        case "collections-library":
            CollectionsGallery.library()
        case "collections-screen":
            CollectionsGallery.screen()
        case "collections-empty":
            CollectionsGallery.screen(seed: false)
        case "collections-queue":
            CollectionsGallery.queue()
        case "collections-queue-ax":
            CollectionsGallery.queue().dynamicTypeSize(.accessibility3)
        case "collections-playlist-guide":
            CollectionsGallery.queue(guideOpen: true)
        case "collections-none-here":
            CollectionsGallery.queue(guideOpen: true, id: CollectionsGallery.noneHereID)
        case "collections-edit":
            CollectionsGallery.queue(editing: true)
        case "collections-add":
            CollectionsGallery.addSheet()
        case "collections-add-failed":
            CollectionsGallery.addSheet(saveFails: true)
        case "collections-playing":
            CollectionsPlayingGallery()
        case "collections-player-playing", "collections-player-ax":
            CollectionsPlayerGallery()
        case "collections-player-browsing":
            CollectionsPlayerGallery(browsing: true)
        case "collections-player-paused":
            CollectionsPlayerGallery(paused: true)
        case "collections-player-vinyl":
            CollectionsPlayerGallery(vinyl: true)
        case "collections-player-reduce-motion":
            CollectionsPlayerGallery(reduceMotion: true)
        case "collections-player-ax-controls":
            CollectionsPlayerGallery(scrollsTo: CollectionsPlayerView.nowPlayingID)
        case "collections-player-ax-lower":
            CollectionsPlayerGallery(scrollsTo: CollectionsPlayerView.queueID)
        case "collections-player-narrow-lower":
            CollectionsPlayerGallery(scrollsTo: CollectionsPlayerView.nowPlayingID).frame(width: 320)
        case "collections-player-narrow":
            CollectionsPlayerGallery().frame(width: 320)
        case "collections-player-empty":
            CollectionsPlayerGallery(seed: false, playing: false)
        case "collections-player-wont-play":
            CollectionsPlayerGallery(scrollsTo: CollectionsPlayerView.queueID, missingFirst: true)
        case "collections-player-many":
            CollectionsPlayerGallery(many: 200)
        case "collections-wont-play":
            CollectionsPlayingGallery(missingFirst: true)
        case "icons-tabs-library", "icons-library-list":
            IconsGallery.tabs(selected: .library, layout: .list)
        case "icons-library-grid":
            IconsGallery.tabs(selected: .library, layout: .covers)
        case "icons-library-search":
            IconsGallery.tabs(selected: .library, layout: .list, search: "Night drive")
        case "crop-sheet":
            CoverCropView(imageData: SampleArtwork.sunset.pngData() ?? Data(), onDone: { _ in }, onCancel: {})
        case "icons-tabs-stats":
            IconsGallery.tabs(selected: .stats, layout: .list)
        case "icons-release":
            IconsGallery.release()
        case "icons-cover-edit":
            IconsGallery.coverEdit()
        case "icons-playlist-guide":
            ZStack { StudioBackdrop(); PlaylistGuide(albumTitle: "Night Bus to Nowhere").padding(24) }
        case "devices-header-0":
            IconsGallery.devices(pending: 0, open: false)
        case "devices-header-1":
            IconsGallery.devices(pending: 1, open: false)
        case "devices-header-narrow":
            // A 320 pt screen (an iPhone SE with Display Zoom), for the header at the largest sizes (#226).
            IconsGallery.devices(pending: 1, open: false).frame(width: 320)
        case "devices-header-3":
            IconsGallery.devices(pending: 3, open: false)
        case "devices-tray-open":
            IconsGallery.devices(pending: 3, open: true)
        case "devices-tray-failed":
            IconsGallery.devices(pending: 1, open: true, failedOnly: true)
        case "devices-tray-large-text":
            IconsGallery.devices(pending: 3, open: true).dynamicTypeSize(.accessibility3)
        case "icons-release-bottom":
            IconsGallery.release()
        case "release-view-nocover":
            IconsGallery.release(noCover: true)
        case "release-edit-nocover":
            IconsGallery.release(noCover: true, editing: true)
        case "player-release":
            PlayerGallery(paused: false)
        case "player-release-ax3":
            PlayerGallery(paused: false).dynamicTypeSize(.accessibility3)
        case "player-mini-paused":
            PlayerGallery(paused: true, showsLibrary: true)
        case "release-view-large-text":
            IconsGallery.release().dynamicTypeSize(.accessibility3)
        case "release-view-large-text-bottom":
            IconsGallery.release().dynamicTypeSize(.accessibility3)
        case "share-sheet":
            ShareGallery.sheet()
        case "queue-toast-next", "queue-toast-added", "queue-toast-left-out", "queue-toast-ax3", "queue-toast-long-ax5", "queue-toast-left-out-ax5":
            TrackActionsGallery(name: name)
        case "share-sheet-link":
            ShareGallery.sheet(link: true)
        case "share-sheet-result":
            ShareGallery.sheet(result: true)
        case "share-sheet-signed-out":
            ShareGallery.sheet(signedOut: true)
        case "share-sheet-large-text":
            ShareGallery.sheet(link: true).dynamicTypeSize(.accessibility3)
        case "devices-tray-friends":
            IconsGallery.devices(pending: 2, open: true, friends: 3)
        case "devices-tray-friends-large-text":
            IconsGallery.devices(pending: 0, open: true, friends: 3).dynamicTypeSize(.accessibility3)
        case "release-track-highlight":
            IconsGallery.highlightedRelease()
        case "release-track-highlight-long":
            IconsGallery.highlightedRelease(tracks: 12, track: 9)
        case "release-track-highlight-bright":
            IconsGallery.highlightedRelease(tracks: 12, track: 9, cover: [.systemYellow, .systemOrange, .systemYellow])
        case "release-track-highlight-dark":
            IconsGallery.highlightedRelease(tracks: 12, track: 9, cover: [UIColor(white: 0.04, alpha: 1), UIColor(white: 0.1, alpha: 1), .black])
        case "release-track-highlight-ax":
            IconsGallery.highlightedRelease(tracks: 12, track: 9).dynamicTypeSize(.accessibility3)
        case "release-track-plain-long":
            IconsGallery.highlightedRelease(tracks: 12, track: nil)
        case "stats-open-track":
            IconsGallery.environment(StatsGallery.page(.week), IconsGallery.container())
        case "release-share-blocked":
            IconsGallery.release(sharedFrom: SharedFrom(shareId: UUID().uuidString.lowercased(), allowReshare: false))
        case "shared-by-you":
            ShareGallery.sharedByYou()
        case "shared-by-you-large-text":
            ShareGallery.sharedByYou().dynamicTypeSize(.accessibility3)
        case "devices-tray-sections":
            IconsGallery.devices(pending: 5, open: true, sections: true)
        case "devices-tray-sections-large-text":
            IconsGallery.devices(pending: 5, open: true, sections: true).dynamicTypeSize(.accessibility2)
        default:
            EmptyView()
        }
    }

    /// The release page's tracks panel: `TrackRow` with plays and the grip, no replace.
    private static var releaseTracks: some View {
        let rows = [("Headlights", "12 plays"), ("Overpass On The Neon Harbor Road, The Long Way Round", "1 play"), ("Last Exit", nil)]
        return ZStack {
            StudioBackdrop()
            List {
                Section {
                    Text(Copy.Import.tracks)
                        .font(Theme.ScaledFont.headline)
                        .importPanelRow(.top)
                    ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                        TrackRow(number: index + 1, title: row.0, titleBinding: .constant(row.0), plays: row.1, showsGrip: true)
                            .importTrackRow(isFirst: index == 0, isLast: index == rows.count - 1)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .environment(\.defaultMinListRowHeight, 0)
            .scrollContentBackground(.hidden)
        }
    }

    /// #205: the Make a record invitation and the cover beat, on the studio backdrop. The real record
    /// on prefilled models is `import-record-single`, `-album`, `-album-empty`, `-live` and `-album-live` (see
    /// `ImportRecordGallery`). Names:
    /// `import-invite`, `import-invite-lit`, `import-beat-<ms>`,
    /// `import-beat-reduced-<ms>` (a fixed frame), `import-beat-live` (plays in real time),
    /// `import-send-seal-<ms>` (Send's disc sliding in, frozen at a time) and, over a record page,
    /// `import-sent-single`, `import-sent-album` and `import-sent-nocover` (the Sent card).
    @ViewBuilder
    private var importContent: some View {
        switch name {
        case "import-invite":
            ImportInvitation(onAddTrack: {})
        case "import-invite-lit":
            ImportInvitation(onAddTrack: {}, pinnedLit: true)
        case "import-beat-live":
            ImportBeatLive()
        default:
            if let ms = Self.sealMs(name) {
                RecordSleeve(cover: SampleArtwork.sunset, beat: ImportBeat.sendSealFrame(at: ms, reduced: false), onAddCover: {})
            } else if let beat = Self.beatFrame(name) {
                RecordSleeve(cover: SampleArtwork.sunset, beat: beat, onAddCover: {})
            }
        }
    }

    /// The time an `import-send-seal-<ms>` name asks for.
    static func sealMs(_ name: String) -> Double? {
        let prefix = "import-send-seal-"
        return name.hasPrefix(prefix) ? Double(name.dropFirst(prefix.count)) : nil
    }

    /// The frame a `import-beat-[reduced-]<ms>` name asks for.
    static func beatFrame(_ name: String) -> ImportBeat.Frame? {
        for (prefix, reduced) in [("import-beat-reduced-", true), ("import-beat-", false)] {
            if name.hasPrefix(prefix), let ms = Double(name.dropFirst(prefix.count)) {
                return ImportBeat.frame(at: ms, reduced: reduced)
            }
        }
        return nil
    }

    /// The real Settings in a tab bar, with sample state: no container, so nothing reaches a
    /// service or the network.
    private static func settings(signedIn: Bool, codeSentTo: String? = nil) -> some View {
        TabView {
            SettingsView()
                .tabItem { Label(Copy.Settings.title, systemImage: "gearshape") }
        }
        .tint(Theme.accent)
        .environment(FolderStatus(isConnected: true))
        .environment(PurchaseStatus(isFullUnlocked: false))
        .environment(sampleSyncStatus(signedIn: signedIn, codeSentTo: codeSentTo))
    }

    private static func sampleSyncStatus(signedIn: Bool, codeSentTo: String?) -> SyncStatus {
        guard signedIn else {
            let status = SyncStatus()
            status.codeSentTo = codeSentTo
            return status
        }
        let status = SyncStatus(
            signedIn: true,
            email: "sample@example.com",
            deviceName: "iPhone 17",
            lastRunAt: Date().addingTimeInterval(-120)
        )
        status.quota = SyncQuota(usedBytes: 42 * 1_048_576, limitBytes: 500 * 1_048_576)
        return status
    }
}

// MARK: - Stats sample data (#204)

/// A `PlayStatsReading` that answers with a fixed read, for the gallery.
final class GalleryPlayStats: PlayStatsReading {
    private let read: PlayStatsRead
    init(_ read: PlayStatsRead) { self.read = read }
    func summary(from: String, to: String, force: Bool) async -> PlayStatsRead { read }
}

/// The real `StatsView` over eight sample releases (fourteen tracks, three to forty-eight plays).
enum StatsGallery {
    enum Mode { case week, albumsGrid, artists, quiet, signedOut }

    private static func id(_ n: Int) -> UUID { UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))! }

    struct Seed {
        var n: Int
        var artist: String
        var title: String
        var genre: String
        var colors: [UIColor]
        var tracks: [(title: String, plays: Int, daysAgo: Int)]
        var releaseID: UUID { UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))! }
    }

    private static let seeds: [Seed] = [
        Seed(n: 1, artist: "Mira Valdane", title: "Night Bus to Nowhere", genre: "Indie pop", colors: [.systemIndigo, .systemPurple, .systemPink],
             tracks: [("Night Bus to Nowhere", 48, 0), ("Orange Streetlight", 31, 1), ("Paper Moon (feat. Okoro)", 12, 4)]),
        Seed(n: 2, artist: "The Salt Line", title: "Low Tide", genre: "Folk", colors: [.systemTeal, .systemBlue, .systemIndigo],
             tracks: [("Low Tide", 36, 0), ("Harbour Lights", 22, 2)]),
        Seed(n: 3, artist: "Okoro", title: "Saltwater Hymns", genre: "Ambient", colors: [UIColor(red: 0.95, green: 0.75, blue: 0.30, alpha: 1), .systemOrange, .systemRed],
             tracks: [("Tide", 27, 1), ("Hymn", 9, 5)]),
        Seed(n: 4, artist: "Quiet Orchard", title: "Paper Lanterns", genre: "Dream pop", colors: [.systemGreen, .systemMint, .systemTeal],
             tracks: [("Lanterns", 19, 3)]),
        Seed(n: 5, artist: "Neon Harbor", title: "Midnight Drive", genre: "Synthwave", colors: [.systemPink, .systemPurple, .systemBlue],
             tracks: [("Midnight Drive", 15, 2), ("Afterglow", 8, 6)]),
        Seed(n: 6, artist: "Mira Valdane", title: "Kitchen Radio", genre: "Indie pop", colors: [.systemYellow, .systemOrange, .systemPink],
             tracks: [("Kitchen Radio", 7, 6)]),
        Seed(n: 7, artist: "Juniper Hale", title: "Slow Fires", genre: "Country", colors: [UIColor(red: 0.45, green: 0.20, blue: 0.10, alpha: 1), .systemOrange, .systemYellow],
             tracks: [("Slow Fires", 5, 4), ("Cold Coffee", 3, 6)]),
        Seed(n: 8, artist: "Okoro", title: "Night Bus", genre: "Ambient", colors: [UIColor(red: 0.05, green: 0.06, blue: 0.12, alpha: 1), UIColor(red: 0.09, green: 0.11, blue: 0.20, alpha: 1)],
             tracks: [("Night Bus", 4, 5)]),
    ]

    private static func trackID(_ seed: Seed, _ index: Int) -> UUID { id(seed.n * 100 + index + 1) }

    static let releases: [Release] = seeds.map { seed in
        Release(
            id: id(seed.n), kind: seed.tracks.count > 1 ? .album : .single, title: seed.title, artist: seed.artist,
            genre: seed.genre, coverPath: "/cover/\(seed.n).png", folderPath: "/lib/\(seed.n)",
            tracks: seed.tracks.enumerated().map { i, t in
                Track(id: trackID(seed, i), title: t.title, trackNumber: i + 1, filePath: "t\(seed.n)-\(i).mp3", originalName: "t\(seed.n)-\(i).mp3", durationSec: 200)
            }
        )
    }

    static let covers: [UUID: Data] = Dictionary(uniqueKeysWithValues: seeds.map { ($0.releaseID, SampleArtwork.cover($0.colors, size: 360).pngData() ?? Data()) })

    private static func summary(empty: Bool) -> PlaysSummary {
        var tracks: [PlayCount] = []
        var allTime: [PlayCount] = []
        for seed in seeds {
            for (i, t) in seed.tracks.enumerated() {
                let day = PlayPeriods.localDayString(Date().addingTimeInterval(-86_400 * Double(t.daysAgo)), calendar: .current)
                let tid = trackID(seed, i).uuidString.lowercased()
                let rid = id(seed.n).uuidString.lowercased()
                if !empty { tracks.append(PlayCount(trackId: tid, releaseId: rid, plays: t.plays, lastPlayedDay: day)) }
                allTime.append(PlayCount(trackId: tid, releaseId: rid, plays: t.plays * 4, lastPlayedDay: nil))
            }
        }
        return PlaysSummary(tracks: tracks, allTime: allTime)
    }

    @MainActor
    static func page(_ mode: Mode) -> some View {
        TabView {
            statsView(mode)
                .tabItem { Label(Copy.Stats.tabLabel, image: "Icon/Stats") }
        }
        .tint(Theme.accent)
        .environment(FolderStatus(isConnected: true))
        .environment(PurchaseStatus(isFullUnlocked: false))
        .environment(SyncStatus())
    }

    /// The Stats page alone, over sample plays (the tab bar is the caller's).
    @MainActor
    static func statsView(_ mode: Mode) -> some View {
        let defaults = UserDefaults(suiteName: "gallery.stats")!
        defaults.removePersistentDomain(forName: "gallery.stats")
        defaults.set(StatsPeriodKind.week.rawValue, forKey: StatsViewModel.periodKey)
        switch mode {
        case .albumsGrid:
            defaults.set(StatsKind.albums.rawValue, forKey: StatsViewModel.tabKey)
            defaults.set(StatsLayout.grid.rawValue, forKey: StatsViewModel.layoutKey)
        case .artists:
            defaults.set(StatsKind.artists.rawValue, forKey: StatsViewModel.tabKey)
        default:
            break
        }
        let read: PlayStatsRead = mode == .signedOut ? .signedOut : .ok(summary(empty: mode == .quiet))
        let model = StatsViewModel(stats: GalleryPlayStats(read), releases: { releases }, defaults: defaults)
        let cache = StatsCoverCache(loader: { covers[$0] })
        return StatsView(model: model, cache: cache, selectedTab: .constant(.stats), librarySearchRequest: .constant(nil))
    }
}

/// #213: the real tab bar, library and release page over seeded sample data, for the icon screenshots.
/// The services are the production ones over an in-memory index, and nothing here signs in or syncs.
@MainActor
enum IconsGallery {
    static func container(
        releases: [Release] = StatsGallery.releases, covers: [UUID: Data] = StatsGallery.covers, playStats: PlayStatsReading? = nil,
        folder: SpotifyFolderAccess = UserDefaultsSpotifyFolder(), tagWriter: TagWriter? = nil
    ) -> AppContainer {
        // swiftlint:disable:next force_try
        let modelContainer = try! ModelStore.open(at: nil)
        let library = SwiftDataLibraryStore(context: modelContainer.mainContext)
        let coverStore = FileCoverStore()
        let coordinator = ReleaseCoordinator(
            importer: LocalFileImporter(), transcoder: AVTranscoder(), m4aTagWriter: tagWriter ?? M4ATagWriter(), id3TagWriter: tagWriter ?? ID3TagWriter(),
            folder: folder, library: library, coverStore: coverStore, durationReader: TrackLengthLoader.shared
        )
        let account = UserDefaultsSyncAccountStore()
        let api = HttpSyncApi(account: account)
        let engine = SyncEngine(
            api: api, account: account, library: library, coordinator: coordinator, coverStore: coverStore,
            outbox: SwiftDataSyncOutbox(context: modelContainer.mainContext), deviceName: { "Gallery" }
        )
        let container = AppContainer(
            folder: folder, library: library, importer: LocalFileImporter(), coordinator: coordinator, coverStore: coverStore,
            inbox: AppGroupInboxStore(), purchase: StoreKitPurchaseService(), syncAccount: account, syncApi: api, syncEngine: engine,
            playStats: playStats ?? SyncPlayStatsService(api: api, account: account), modelContainer: modelContainer
        )
        for release in releases {
            var release = release
            if let data = covers[release.id] { release.coverPath = (try? coverStore.save(data, for: release.id)) ?? release.coverPath }
            try? library.upsert(release)
        }
        return container
    }

    static func environment<V: View>(_ view: V, _ container: AppContainer) -> some View {
        view
            .environment(\.appContainer, container)
            .environment(\.playback, container.playback)
            .environment(FolderStatus(isConnected: true))
            .environment(PurchaseStatus(isFullUnlocked: false))
            .environment(container.syncStatus)
            .tint(Theme.accent)
            .preferredColorScheme(.dark)
    }

    /// The four tabs as `RootView` builds them, with one selected.
    static func tabs(selected: RootView.Tab, layout: LibraryLayout, search: String? = nil) -> some View {
        UserDefaults.standard.set(layout.rawValue, forKey: LibraryViewPrefs.layoutKey)
        let container = container()
        return environment(IconsTabs(selected: selected, search: search), container)
    }

    /// The real Library over sample pending records (#269): the first is ready, the second's last
    /// send failed, the third is sending now. `failedOnly` shows just the failed one.
    static func devices(pending: Int, open: Bool, failedOnly: Bool = false, sections: Bool = false, friends: Int = 0) -> some View {
        UserDefaults.standard.set(LibraryLayout.list.rawValue, forKey: LibraryViewPrefs.layoutKey)
        let container = container()
        let now = Date()
        let samples: [(String, String, String, String, Int)] = [
            ("Night Bus to Nowhere", "Neon Harbor", "mac", "ready", 11),
            ("Low Tide", "The Salt Line", "mac", "failed", 1),
            ("Paper Lanterns Over the Long Way Home", "Amelia Rowe", "web", "sending", 9),
        ]
        // #296: two ready, one being sent (still in Ready to add), two that couldn't send.
        let sectionSamples: [(String, String, String, String, Int)] = [
            ("Night Bus to Nowhere", "Neon Harbor", "mac", "ready", 11),
            ("Slow Fires", "Juniper Hale", "mac", "ready", 1),
            ("Paper Lanterns Over the Long Way Home", "Amelia Rowe", "web", "sending", 9),
            ("Low Tide", "The Salt Line", "mac", "failed", 1),
            ("Kitchen Radio", "Mira Valdane", "web", "failed", 4),
        ]
        let shown = sections ? sectionSamples : failedOnly ? [samples[1]] : Array(samples.prefix(pending))
        let status = container.syncStatus
        status.pendingFromMac = shown.enumerated().map { index, sample in
            SyncRecord(
                id: "gallery-\(index)", kind: sample.4 > 1 ? "album" : "single", title: sample.0, artist: sample.1,
                tracks: (0..<sample.4).map { SyncTrack(id: "t\($0)", title: "Track \($0 + 1)", trackNumber: $0 + 1, file: "t\($0).m4a", bytes: 0, durationSec: nil) },
                origin: sample.2, originDevice: "Gallery", createdAt: now, updatedAt: now)
        }
        status.failedAcceptIds = Set(shown.enumerated().filter { $0.element.3 == "failed" }.map { "gallery-\($0.offset)" })
        status.acceptingIds = Set(shown.enumerated().filter { $0.element.3 == "sending" }.map { "gallery-\($0.offset)" })
        status.lastError = "The network connection was lost."
        status.receivedShares = Array(ShareGallery.received.prefix(friends))
        // Covers as the engine would have downloaded them (once each).
        let sampleCovers = StatsGallery.releases.compactMap { StatsGallery.covers[$0.id] }
        for (index, share) in status.receivedShares.enumerated() where !sampleCovers.isEmpty {
            status.shareCoverData[share.id] = sampleCovers[index % sampleCovers.count]
        }
        status.failedShareIds = friends > 2 ? [ShareGallery.received[2].id] : []
        return environment(IconsLibrary(openTray: open), container)
    }

    /// The cover picker's hero style: the cover with its Edit pill (the pencil).
    static func coverEdit() -> some View {
        ZStack {
            StudioBackdrop()
            CoverPicker(imageData: .constant(StatsGallery.covers[StatsGallery.releases[0].id]), rawPick: .constant(nil), style: .hero, onPickFromFiles: {})
                .padding(48)
        }
    }

    /// A single's release page in view mode, with two featured artists (#287).
    static func featuringRelease(editing: Bool = false) -> some View {
        let container = container()
        let track = Track(title: "Headlights (feat. Mira Vale & Jonah Reyes)", trackNumber: 1, filePath: "/gallery/Headlights.mp3", originalName: "Headlights.mp3", durationSec: 214)
        var release = Release(kind: .single, title: "Headlights", artist: "Neon Harbor", year: "2026", genre: "Synthwave", folderPath: "/gallery", tracks: [track])
        let cover = StatsGallery.covers[StatsGallery.releases[0].id]
        release.coverPath = cover.flatMap { try? container.coverStore.save($0, for: release.id) }
        return environment(NavigationStack { ReleaseDetailView(release: release, startsEditing: editing) }, container)
    }

    /// A release page whose release carries a day-precision date (#221): year "2024", releaseDate "2024-05-17".
    static func dateRelease(editing: Bool = false) -> some View {
        let container = container()
        var release = StatsGallery.releases[0]
        release.year = "2024"
        release.releaseDate = "2024-05-17"
        return environment(NavigationStack { ReleaseDetailView(release: release, startsEditing: editing) }, container)
    }

    /// `release-date-save`: the release page in edit mode over a release whose track is a real
    /// scratch file in a temp folder, with a tag writer that writes nothing, so a UI test can save.
    static func saveableDateRelease() -> some View {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("gallery-date-save", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("Headlights.mp3")
        try? Data([0xFF, 0xFB, 1, 2, 3, 4]).write(to: file)
        let track = Track(title: "Headlights", trackNumber: 1, filePath: file.path, originalName: "Headlights.mp3", durationSec: 214)
        var release = Release(kind: .single, title: "Headlights", artist: "Neon Harbor", year: "2024", genre: "Synthwave", folderPath: dir.path, tracks: [track])
        release.releaseDate = "2024-05-17"
        let container = container(releases: [release], covers: [:], folder: GalleryFolder(directory: dir), tagWriter: GalleryTagWriter())
        return environment(NavigationStack { ReleaseDetailView(release: release, startsEditing: true) }, container)
    }

    /// An album's release page, with its cover (Edit) and the playlist guide (Copy).
    static func release(noCover: Bool = false, editing: Bool = false, sharedFrom: SharedFrom? = nil) -> some View {
        let container = container()
        var release = StatsGallery.releases[0]
        release.year = "2025"
        release.sharedFrom = sharedFrom
        if noCover { release.coverPath = nil }
        return environment(NavigationStack { ReleaseDetailView(release: release, startsEditing: editing) }, container)
    }
}

/// The real `RootView` with the "moved N songs" banner showing and one song waiting from the Mac, so
/// the Library's cloud button is on screen under it.
private struct RootBannerGallery: View {
    @State private var container: AppContainer = {
        let container = IconsGallery.container()
        let now = Date()
        container.syncStatus.pendingFromMac = [SyncRecord(
            id: "gallery-0", kind: "single", title: "Night Bus to Nowhere", artist: "Neon Harbor",
            tracks: [SyncTrack(id: "t0", title: "Night Bus to Nowhere", trackNumber: 1, file: "t0.m4a", bytes: 0, durationSec: nil)],
            origin: "mac", originDevice: "Gallery", createdAt: now, updatedAt: now)]
        return container
    }()

    var body: some View {
        IconsGallery.environment(RootView(demoNotice: Copy.Settings.songsMoved(count: 12)), container)
    }
}

private struct IconsLibrary: View {
    let openTray: Bool
    @State private var tab = RootView.Tab.library
    @State private var importKind: ImportKind?
    @State private var search: String?

    var body: some View {
        LibraryView(selectedTab: $tab, requestedImportKind: $importKind, librarySearchRequest: $search, openTrayOnAppear: openTray)
    }
}

private struct IconsTabs: View {
    @State var selected: RootView.Tab
    @State private var importKind: ImportKind?
    @State private var search: String?

    private let initialSearch: String?

    init(selected: RootView.Tab, search: String? = nil) {
        _selected = State(initialValue: selected)
        initialSearch = search
    }

    var body: some View {
        TabView(selection: $selected) {
            LibraryView(selectedTab: $selected, requestedImportKind: $importKind, librarySearchRequest: $search)
                .environment(\.isTabSelected, selected == .library)
                .tabItem { Label(Copy.Library.title, image: "Icon/Library") }
                .tag(RootView.Tab.library)
            ImportView(requestedKind: $importKind)
                .environment(\.isTabSelected, selected == .importSong)
                .tabItem { Label(Copy.Import.title, image: "Icon/Plus") }
                .tag(RootView.Tab.importSong)
            StatsGallery.statsView(.week)
                .environment(\.isTabSelected, selected == .stats)
                .tabItem { Label(Copy.Stats.tabLabel, image: "Icon/Stats") }
                .tag(RootView.Tab.stats)
            SettingsView()
                .environment(\.isTabSelected, selected == .settings)
                .tabItem { Label(Copy.Settings.title, systemImage: "gearshape") }
                .tag(RootView.Tab.settings)
        }
        .task {
            guard let initialSearch else { return }
            try? await Task.sleep(for: .milliseconds(600))
            search = initialSearch
        }
    }
}

/// Plays the beat in real time and starts it again every 4 s (a replacing cover after the first).
private struct ImportBeatLive: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start = Date()

    var body: some View {
        TimelineView(.animation) { timeline in
            let elapsed = timeline.date.timeIntervalSince(start) * 1000
            let cycle = (elapsed / 4000).rounded(.down)
            RecordSleeve(
                cover: SampleArtwork.sunset,
                beat: ImportBeat.frame(at: elapsed - cycle * 4000, reduced: reduceMotion),
                onAddCover: {}
            )
        }
    }
}

/// #205: the real Import tab (`ImportView`) in a tab bar, on models prefilled in memory. The models
/// use the production services over an in-memory library and a temp-folder cover store, and
/// nothing here sends.
/// The release page's review sheet after a failed save, with a long error and several changes,
/// drawn full screen so its layout can be checked at the accessibility sizes. Nothing saves.
private struct ReleaseReviewErrorGallery: View {
    @State private var model: ReleaseDetailViewModel

    init() {
        let container = try! ModelStore.open(at: nil)
        let coverStore = FileCoverStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("gallery-covers", isDirectory: true))
        let coordinator = ReleaseCoordinator(
            importer: LocalFileImporter(),
            transcoder: AVTranscoder(),
            m4aTagWriter: M4ATagWriter(),
            id3TagWriter: ID3TagWriter(),
            folder: UserDefaultsSpotifyFolder(),
            library: SwiftDataLibraryStore(context: container.mainContext),
            coverStore: coverStore,
            durationReader: AVTrackDurationReader()
        )
        let tracks = ["Headlights", "Overpass", "Last Exit"].enumerated().map { index, title in
            Track(title: title, trackNumber: index + 1, filePath: "/gallery/\(title).mp3", originalName: "\(title).mp3")
        }
        let release = Release(kind: .album, title: "Midnight Drive", artist: "Neon Harbor", year: "2024", genre: "Synthwave", folderPath: "/gallery", tracks: tracks)
        let model = ReleaseDetailViewModel(release: release, coordinator: coordinator, coverStore: coverStore, syncApi: nil, isSignedIn: { false })
        model.beginEditing()
        model.title = "Midnight Drive Along The Neon Harbor Road"
        model.genre = "Late night synthwave and slow highway pop for the drive home"
        model.releaseDateText = "2026"
        model.errorMessage = "Couldn't save \"Midnight Drive Along The Neon Harbor Road\": Locally doesn't have permission to write to the Spotify folder. Open Settings and choose the folder again."
        _model = State(initialValue: model)
    }

    var body: some View {
        ReleaseReviewSheet(model: model, glowColors: Theme.coverGlowColors(nil)) {}
            .background(Theme.card)
    }
}

/// A connected folder that is a temp directory, for `release-date-save`.
private struct GalleryFolder: SpotifyFolderAccess {
    let directory: URL
    var isConnected: Bool { true }
    func connect(url: URL) throws {}
    func withAccess<T>(_ body: (URL) throws -> T) throws -> T { try body(directory) }
    func withAccess<T>(_ body: (URL) async throws -> T) async throws -> T { try await body(directory) }
    func disconnect() {}
}

/// Writes no tags: a gallery save changes the in-memory library and nothing on disk.
private struct GalleryTagWriter: TagWriter {
    func write(_ tags: TagSet, cover: Data?, to url: URL) async throws {}
}

/// `release-date-sheet` and `release-date-invalid`: Title, Artist and the date and Genre rows on their
/// own, with the sheet open or the message showing (#221).
private struct ReleaseDateFieldGallery: View {
    @State var text: String
    var opensSheet = false
    @State private var genre = "Synthwave"

    var body: some View {
        ZStack {
            StudioBackdrop()
            VStack(alignment: .leading, spacing: Theme.Immersive.labeledFieldRowGap) {
                LabeledField(Copy.Import.fieldTitle, placeholder: "", text: .constant("Midnight Drive"), font: Theme.ScaledFont.fieldTitle, metricsStyle: .title3, wraps: true)
                LabeledField(Copy.Import.fieldArtist, placeholder: "", text: .constant("Neon Harbor"))
                ReleaseDateGenreRows(releaseDate: $text, genre: $genre, message: ReleaseDateText.parse(text).message, startsWithSheetOpen: opensSheet)
            }
            .padding(Theme.Spacing.pagePadding)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

/// `featuring-fields-ax`: Title, Artist and the Featuring row (edit and view) at an accessibility
/// size, where the label sits above its value. The import record scrolls past these at that size.
private struct FeaturingFieldsGallery: View {
    @State private var names = ["Mira Vale", "Jonah Reyes"]
    @State private var draft = ""
    @State private var title = "Headlights"
    @State private var artist = "Neon Harbor"

    var body: some View {
        ZStack {
            StudioBackdrop()
            VStack(alignment: .leading, spacing: Theme.Immersive.labeledFieldRowGap) {
                LabeledField(Copy.Import.fieldTitle, placeholder: "", text: $title, font: Theme.ScaledFont.fieldTitle, metricsStyle: .title3, wraps: true)
                LabeledField(Copy.Import.fieldArtist, placeholder: "", text: $artist, wraps: true)
                FeaturingField(names: $names, draft: $draft)
                FeaturingField(names: $names, draft: $draft, isEditable: false)
            }
            .padding(Theme.Spacing.pagePadding)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .dynamicTypeSize(.accessibility2)
        }
    }
}

private struct ImportRecordGallery: View {
    let name: String

    @State private var preset: ImportViewPreset
    /// Only the artist cases (#287) get a library to suggest from.
    @State private var container: AppContainer?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(name: String) {
        self.name = name
        _container = State(initialValue: name.contains("artist") || name.contains("featuring") ? IconsGallery.container() : nil)
        let container = try! ModelStore.open(at: nil)
        let coordinator = ReleaseCoordinator(
            importer: LocalFileImporter(),
            transcoder: AVTranscoder(),
            m4aTagWriter: M4ATagWriter(),
            id3TagWriter: ID3TagWriter(),
            folder: UserDefaultsSpotifyFolder(),
            library: SwiftDataLibraryStore(context: container.mainContext),
            coverStore: FileCoverStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("gallery-covers", isDirectory: true)),
            durationReader: AVTrackDurationReader()
        )
        let single = ImportSingleViewModel(importer: LocalFileImporter(), coordinator: coordinator)
        let album = AlbumBuilderViewModel(importer: LocalFileImporter(), coordinator: coordinator)
        let driver = ImportBeatDriver()
        let cover = SampleArtwork.sunset.pngData()
        var kind = ImportKind.single
        var sent: ImportSentInfo?

        switch name {
        case "import-sent-single", "import-sent-nocover":
            Self.fill(single)
            if name == "import-sent-single", let cover {
                single.coverData = cover
                driver.showAtRest(cover: cover)
            }
            sent = ImportSentInfo(kind: .single, cover: name == "import-sent-single" ? cover : nil, spotifyInstalled: true)
        case "import-sent-album":
            kind = .album
            album.albumTitle = "Low Tide"
            album.artist = "The Salt Line"
            if let cover {
                album.coverData = cover
                driver.showAtRest(cover: cover)
            }
            sent = ImportSentInfo(kind: .album, cover: cover, spotifyInstalled: true)
        case "import-record-album-empty":
            kind = .album
            album.albumTitle = "Low Tide"
            album.artist = "The Salt Line"
        case "import-record-album", "import-record-album-live":
            kind = .album
            // Long values, so wrapping at large text sizes is visible.
            album.albumTitle = "Midnight Drive Along The Neon Harbor Road"
            album.artist = "Neon Harbor And The Salt Line Orchestra"
            album.releaseDateText = "2026"
            album.genre = "Synthwave and late night highway pop"
            album.rows = ["Headlights", "Overpass", "Last Exit"].map {
                AlbumBuilderViewModel.TrackRow(url: URL(fileURLWithPath: "/gallery/\($0).mp3"), title: $0)
            }
            // The live case sets its cover as the screen appears instead.
            if name == "import-record-album", let cover {
                album.coverData = cover
                driver.showAtRest(cover: cover)
            }
        case "import-record-featuring":
            // #287: two pills and the field, under Artist.
            Self.fill(single)
            single.featuring = ["Mira Vale", "Jonah Reyes"]
        case "import-record-album-featuring-sheet", "import-record-album-featuring-sheet-many":
            // #287: the feat. sheet open on the second track.
            kind = .album
            album.albumTitle = "Midnight Drive"
            album.artist = "Neon Harbor"
            album.rows = ["Headlights", "Overpass", "Last Exit"].map {
                AlbumBuilderViewModel.TrackRow(url: URL(fileURLWithPath: "/gallery/\($0).mp3"), title: $0)
            }
            album.rows[0].featuring = ["Mira Vale"]
            album.rows[1].featuring = ["Jonah Reyes", "Mira Vale"]
            if name.hasSuffix("-many") {
                // Eight long names: the sheet must scroll (use with a large text size).
                album.rows[1].featuring = (1...8).map { "Bartholomew Featherstonehaugh \($0)" }
            }
            album.featuringRowID = album.rows[1].id
        case "import-record-date":
            // #221: a single with a day-precision date.
            Self.fill(single)
            single.releaseDateText = ReleaseDate(year: 2024, month: 5, day: 17)?.formatted() ?? ""
        case "import-record-live":
            Self.fill(single)
        case "import-record-artist-pills", "import-record-artist-typo":
            // #287: the library's artists (the seeded Stats releases) behind the Artist field. Tap the
            // field to see the keyboard pills; for the typo, tap the field, then tap away.
            Self.fill(single)
            single.artist = name == "import-record-artist-pills" ? "ne" : "Neon Harbour"
        default:
            // import-record-single: a file, the fields, no cover.
            Self.fill(single)
        }
        _preset = State(initialValue: ImportViewPreset(single: single, album: album, driver: driver, kind: kind, sent: sent))
    }

    private static func fill(_ single: ImportSingleViewModel) {
        single.pickedURL = URL(fileURLWithPath: "/gallery/Headlights.mp3")
        single.pickedName = "Headlights.mp3"
        single.title = "Headlights On The Neon Harbor Overpass"
        single.artist = "Neon Harbor And The Salt Line Orchestra"
        single.releaseDateText = "2026"
        single.genre = "Synthwave and late night highway pop"
    }

    var body: some View {
        TabView {
            ImportView(preset: preset)
                .tabItem { Label(Copy.Import.title, image: "Icon/Plus") }
        }
        .tint(Theme.accent)
        .environment(SyncStatus())
        .environment(\.appContainer, container)
        .onAppear {
            // The live case sets its cover as the screen appears, so the beat plays in the record.
            guard name == "import-record-live" || name == "import-record-album-live", let cover = SampleArtwork.sunset.pngData() else { return }
            if name == "import-record-album-live" {
                preset.album.coverData = cover
            } else {
                preset.single.coverData = cover
            }
            preset.driver.coverChanged(cover, reduced: reduceMotion)
        }
        // The album's live case plays the beat again every 3 s, to try gestures during and after it.
        .task {
            guard name == "import-record-album-live", let cover = SampleArtwork.sunset.pngData() else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(3))
                preset.driver.coverChanged(cover, reduced: reduceMotion)
            }
        }
    }
}

/// `controls`: the kind switch and the cover glow buttons, enabled, disabled and pressed.
private struct ControlsGallery: View {
    @State private var single = ImportKind.single
    @State private var album = ImportKind.album
    private let warm = [ArtworkBackdrop.color(hex: "#E2552E"), ArtworkBackdrop.color(hex: "#F2B134")]

    var body: some View {
        ZStack {
            StudioBackdrop()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    KindSwitch(kind: $single, tint: Theme.accent)
                    KindSwitch(kind: $album, tint: ArtworkBackdrop.color(hex: "#E2552E"))
                    send(Theme.coverGlowColors(nil))
                    send(warm)
                    send(warm).disabled(true)
                    Button {} label: {
                        HStack(spacing: 6) {
                            Image(systemName: "checkmark").accessibilityHidden(true)
                            Text(Copy.Detail.saveChanges)
                        }
                    }
                    .buttonStyle(CoverGlowButtonStyle(colors: warm, isFullWidth: false))
                    Button {} label: { sendLabel }
                        .buttonStyle(CoverGlowButtonStyle(colors: warm, pinnedPressed: true))
                }
                .padding(Theme.Spacing.pagePadding)
            }
        }
    }

    private func send(_ colors: [Color]) -> some View {
        Button {} label: { sendLabel }
            .buttonStyle(CoverGlowButtonStyle(colors: colors))
    }

    private var sendLabel: some View {
        HStack(spacing: 8) {
            Image(systemName: "paperplane.fill").accessibilityHidden(true)
            Text(Copy.Import.send)
        }
    }
}

// MARK: - Artists sample data (#288)

/// Sample artists for the Artists view and artist pages: the Stats sample releases with years, plus
/// releases that feature other artists (one, Jonah Reyes, only features), and all-time plays.
@MainActor
extension IconsGallery {
    private static func artistsID(_ n: Int) -> UUID { UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", 9000 + n))! }

    private static func sample(
        _ n: Int, _ kind: ReleaseKind, _ title: String, by artist: String, year: String, tracks: [String], colors: [UIColor]
    ) -> (release: Release, cover: Data) {
        let id = artistsID(n)
        let release = Release(
            id: id, kind: kind, title: title, artist: artist, year: year, genre: "Indie", coverPath: "/cover/x\(n).png", folderPath: "/lib/x\(n)",
            tracks: tracks.enumerated().map { i, t in
                Track(id: UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", 90000 + n * 10 + i))!, title: t, trackNumber: i + 1, filePath: "x\(n)-\(i).mp3", originalName: "x\(n)-\(i).mp3", durationSec: 200)
            },
            createdAt: Date(timeIntervalSince1970: 1_700_000_000 + Double(n) * 86_400), updatedAt: Date(timeIntervalSince1970: 1_700_000_000 + Double(n) * 86_400)
        )
        return (release, SampleArtwork.cover(colors, size: 360).pngData() ?? Data())
    }

    private static let extras: [(release: Release, cover: Data)] = [
        sample(1, .single, "Headlights", by: "Neon Harbor", year: "2026", tracks: ["Headlights (feat. Mira Valdane & Okoro)"], colors: [.systemPink, .systemOrange, .systemPurple]),
        sample(2, .album, "Tidelines", by: "Okoro", year: "2024", tracks: ["Slow Water", "Glass Harbor (feat. Mira Valdane)", "Low Light"], colors: [.systemTeal, .systemCyan, .systemBlue]),
        sample(3, .single, "Late Trains", by: "Mira Valdane", year: "2023", tracks: ["Late Trains"], colors: [.systemYellow, .systemOrange, .systemRed]),
        sample(4, .album, "Salt and Sparrow", by: "The Salt Line", year: "2022", tracks: ["Sparrow", "Harbour Lights (feat. Jonah Reyes)", "Salt"], colors: [.systemBlue, .systemIndigo, .systemMint]),
        sample(5, .single, "Static", by: "5 Seconds of Static", year: "2021", tracks: ["Static"], colors: [.systemGray, .systemGray2, .systemGray4]),
    ]

    private static let years = [1: "2025", 2: "2021", 3: "2020", 4: "2023", 5: "2024", 6: "2022", 7: "2019", 8: "2023"]

    /// The Stats sample releases (with years) and the extras, and their covers.
    private static var artistsLibrarySeed: (releases: [Release], covers: [UUID: Data]) {
        var releases = StatsGallery.releases
        for index in releases.indices {
            let n = Int(releases[index].folderPath.split(separator: "/").last ?? "") ?? 0
            releases[index].year = years[n]
            releases[index].createdAt = Date(timeIntervalSince1970: 1_600_000_000 + Double(n) * 86_400)
        }
        var covers = StatsGallery.covers
        for extra in extras { covers[extra.release.id] = extra.cover }
        return (releases + extras.map(\.release), covers)
    }

    /// All-time plays: most tracks have some, a few have none.
    private static func artistsPlays(_ releases: [Release]) -> PlayStatsRead {
        let byTitle: [String: Int] = [
            "Night Bus to Nowhere": 192, "Orange Streetlight": 124, "Paper Moon (feat. Okoro)": 48, "Kitchen Radio": 28, "Tide": 108, "Hymn": 36,
            "Night Bus": 16, "Late Trains": 61, "Glass Harbor (feat. Mira Valdane)": 71, "Slow Water": 0, "Low Light": 9,
            "Headlights (feat. Mira Valdane & Okoro)": 90, "Harbour Lights (feat. Jonah Reyes)": 22, "Sparrow": 14,
        ]
        let counts = releases.flatMap { release in
            release.tracks.compactMap { track -> PlayCount? in
                guard let plays = byTitle[track.title], plays > 0 else { return nil }
                return PlayCount(trackId: track.id.uuidString.lowercased(), releaseId: release.id.uuidString.lowercased(), plays: plays, lastPlayedDay: nil)
            }
        }
        return .ok(PlaysSummary(tracks: [], allTime: counts))
    }

    private static func artistsContainer() -> AppContainer {
        let seed = artistsLibrarySeed
        return container(releases: seed.releases, covers: seed.covers, playStats: GalleryPlayStats(artistsPlays(seed.releases)))
    }

    /// The real Library over the artists sample, in the given layout and sort.
    static func artistsLibrary(layout: LibraryLayout, sort: LibrarySortOption = .newest) -> some View {
        UserDefaults.standard.set(layout.rawValue, forKey: LibraryViewPrefs.layoutKey)
        UserDefaults.standard.set(sort.rawValue, forKey: LibraryViewPrefs.sortKey)
        return environment(IconsLibrary(openTray: false), artistsContainer())
    }

    /// An artist's page, as pushed from the library.
    static func artistPage(name: String) -> some View {
        environment(NavigationStack { ArtistPageView(route: ArtistRoute(key: ArtistNames.artistKey(name))) }, artistsContainer())
    }

    /// Tidelines opened from one of its tracks (#362), the wash held at full strength. `tracks` pads it to a
    /// long release so the scroll shows; a nil `track` is a plain push with no highlight.
    static func highlightedRelease(tracks: Int? = nil, track: Int? = 2, cover: [UIColor]? = nil) -> some View {
        let seed = artistsLibrarySeed
        var covers = seed.covers
        var release = seed.releases.first { $0.title == "Tidelines" } ?? StatsGallery.releases[0]
        if let cover { covers[release.id] = SampleArtwork.cover(cover, size: 360).pngData() ?? Data() }
        let container = Self.container(releases: seed.releases, covers: covers, playStats: GalleryPlayStats(artistsPlays(seed.releases)))
        if let tracks, release.tracks.count < tracks {
            for n in release.tracks.count..<tracks {
                release.tracks.append(Track(id: UUID(), title: "Interlude \(n + 1)", trackNumber: n + 1, filePath: "x\(n).mp3", originalName: "x\(n).mp3", durationSec: 200))
            }
        }
        let id = track.map { release.tracks.indices.contains($0) ? release.tracks[$0].id : release.tracks[0].id }
        return environment(HighlightedReleaseHost(release: release, trackID: id), container)
    }

    /// The album Tidelines in view mode: a track featuring Mira Valdane, linked.
    static func linkedRelease() -> some View {
        let container = artistsContainer()
        let release = artistsLibrarySeed.releases.first { $0.title == "Tidelines" } ?? StatsGallery.releases[0]
        return environment(NavigationStack { ReleaseDetailView(release: release) }, container)
    }
}


/// Sample data and frames for sharing (#183). Nothing here reaches the network: the sheet is given
/// its state directly.
enum ShareGallery {
    private static func snapshot(_ title: String, _ artist: String, tracks: Int) -> ShareSnapshot {
        ShareSnapshot(
            kind: tracks > 1 ? "album" : "single", title: title, artist: artist, year: "2025", genre: "Synthwave",
            tracks: (0..<tracks).map { ShareSnapshotTrack(id: UUID().uuidString, title: "Track \($0 + 1)", trackNumber: $0 + 1, file: "t\($0).mp3", bytes: 1) })
    }

    static let received: [ReceivedShare] = [
        ("Night Bus to Nowhere", "Neon Harbor", 11, "alex.rivera@example.com"),
        ("Slow Fires", "Juniper Hale", 1, "mira@example.com"),
        ("Paper Lanterns Over the Long Way Home", "Amelia Rowe", 9, "a.very.long.email.address.for.testing@subdomain.example.org"),
    ].enumerated().map { index, sample in
        ReceivedShare(id: "gallery-share-\(index)", from: ShareSender(email: sample.3), trackIds: nil, allowReshare: false, canReshare: false,
                      expiresAt: nil, createdAt: Date(), claimedAt: nil, snapshot: snapshot(sample.0, sample.1, tracks: sample.2))
    }

    @MainActor
    static func sheet(link: Bool = false, result: Bool = false, signedOut: Bool = false) -> some View {
        let container = IconsGallery.container()
        let groups = InMemoryShareGroupStore([
            ShareGroup(name: "Band", emails: ["jo@example.com", "sam@example.com", "kit@example.com"]),
            ShareGroup(name: "Family", emails: ["mum@example.com"]),
        ])
        let model = ShareSheetModel(
            releaseId: UUID(), subject: "Night Bus to Nowhere", isSignedIn: !signedOut, api: container.syncApi, groupStore: groups,
            publicSharesEnabled: link || result, loadsOptions: false)
        if !signedOut {
            model.addEmail("alex.rivera@example.com")
            model.addEmail("mira@example.com")
            model.addEmail("a.very.long.email.address.for.testing@subdomain.example.org")
            model.linkOn = link
            model.expiry = .sevenDays
        }
        if result {
            model.outcome = ShareOutcome(sharedCount: 2, notOnLocally: ["new.friend@example.com"], link: "https://locally-sync-api.vercel.app/s/4f9c2b7e1a8d")
        }
        return ShareSheet(model: model, onClose: {}).preferredColorScheme(.dark)
    }

    @MainActor
    static func sharedByYou() -> some View {
        let container = IconsGallery.container()
        let now = Date()
        func day(_ n: Int) -> Date { now.addingTimeInterval(Double(n) * 86_400) }
        func sent(_ id: String, _ title: String, people: [(String, Bool)], link: Bool, expires: Date? = nil, revoked: Date? = nil) -> SentShare {
            SentShare(id: id, releaseId: StatsGallery.releases[0].id.uuidString, trackIds: nil, visibility: link ? .public : .private, allowReshare: false,
                      expiresAt: expires, revokedAt: revoked, createdAt: day(-3), snapshot: snapshot(title, "Neon Harbor", tracks: 3),
                      recipients: people.map { ShareRecipient(email: $0.0, claimedAt: $0.1 ? day(-2) : nil) }, hasLink: link, parentShareId: nil, downloads: 4)
        }
        let model = SharedByYouModel(api: container.syncApi, shares: [
            sent("a", "Night Bus to Nowhere", people: [("alex.rivera@example.com", true), ("mira@example.com", false), ("jo@example.com", true)], link: true, expires: day(12)),
            sent("b", "Slow Fires", people: [("mira@example.com", false)], link: false),
            sent("c", "Low Tide", people: [("jo@example.com", true)], link: false, revoked: day(-1)),
            sent("d", "Kitchen Radio", people: [], link: true, expires: day(-2)),
        ], now: { now })
        return IconsGallery.environment(
            ZStack {
                StudioBackdrop()
                ScrollView { SharedByYouList(model: model, onRevoke: { _ in }).padding(20) }
            },
            container)
    }
}

/// #336: the real release page (or Library) in a tab bar, with the mini player over a player that has
/// one track playing. The player runs on fakes, so no audio session or file is touched.
private struct PlayerGallery: View {
    let paused: Bool
    var showsLibrary = false

    @State private var container = IconsGallery.container()
    @State private var playback = PlaybackService(
        engine: GalleryEngine(), access: GalleryAccess(), session: GallerySession(),
        nowPlaying: GalleryNowPlaying(), remote: GalleryRemote(), coverData: { FileCoverStore().load($0.id) }
    )
    @State private var selected = RootView.Tab.library
    @State private var importKind: ImportKind?
    @State private var search: String?

    private var release: Release {
        var release = StatsGallery.releases[0]
        release.year = "2025"
        return release
    }

    var body: some View {
        IconsGallery.environment(
            TabView(selection: $selected) {
                Group {
                    if showsLibrary {
                        LibraryView(selectedTab: $selected, requestedImportKind: $importKind, librarySearchRequest: $search)
                    } else {
                        NavigationStack { ReleaseDetailView(release: release) }
                    }
                }
                .miniPlayerInset()
                .tabItem { Label(Copy.Library.title, image: "Icon/Library") }
                .tag(RootView.Tab.library)
                Color.clear
                    .tabItem { Label(Copy.Stats.tabLabel, image: "Icon/Stats") }
                    .tag(RootView.Tab.stats)
            }
            .miniPlayerAccessory(playback)
            .environment(\.playback, playback),
            container
        )
        .task {
            playback.play(release: release, startingAt: release.tracks[1].id)
            try? await Task.sleep(for: .milliseconds(400))
            if paused { playback.pause() }
        }
    }
}

@MainActor private final class GalleryEngine: PlaybackEngine {
    var onProgress: ((Double, Double?) -> Void)?
    private var continuation: CheckedContinuation<PlaybackEnd, Never>?
    func play(url: URL) async -> PlaybackEnd {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            onProgress?(70, 200)
        }
    }
    func pause() {}
    func resume() {}
    func seek(to seconds: Double) {}
    func stop() {
        continuation?.resume(returning: .stopped)
        continuation = nil
    }
}

private struct GalleryAccess: PlaybackFileAccess {
    /// A track whose file is gone (the player marks it missing and moves on).
    var missing: UUID?
    func withFile<T>(for track: Track, _ body: (URL?) async -> T) async throws -> T {
        if track.id == missing { return await body(nil) }
        return await body(URL(fileURLWithPath: "/tmp/gallery.mp3"))
    }
}

@MainActor private final class GallerySession: PlaybackSession {
    var onInterruption: ((InterruptionEvent) -> Void)?
    var onRouteChange: ((RouteChangeEvent) -> Void)?
    func activate() throws {}
    func deactivate() {}
}

@MainActor private final class GalleryNowPlaying: NowPlayingPublisher {
    func publish(_ info: NowPlayingInfo?) {}
}

@MainActor private final class GalleryRemote: RemoteCommandRegistrar {
    func register(_ handler: @escaping (RemoteCommand) -> Void) {}
}


/// #350: the Library row, the Collections screen, a queue (with a Mac-only release), its edit mode and the add sheet,
/// over sample collections in the in-memory store. Nothing here signs in or syncs.
@MainActor
enum CollectionsGallery {
    /// A release this phone has only the details of (adopted from the Mac): its rows show "On your Mac".
    private static let macOnly = Release(
        id: UUID(uuidString: "00000000-0000-0000-0000-0000000000a1")!, kind: .album, title: "Harbour Sessions", artist: "Okoro",
        coverPath: "/cover/3.png", folderPath: "/mac", tracks: [
            Track(title: "Low Light", trackNumber: 1, filePath: "", originalName: "", durationSec: 241),
            Track(title: "Fog Horn", trackNumber: 2, filePath: "", originalName: "", durationSec: 198),
        ], source: .adopted)

    static let queueID = UUID(uuidString: "00000000-0000-0000-0000-0000000000c1")!
    /// A collection of only the Mac-only release: the playlist guide has nothing to add.
    static let noneHereID = UUID(uuidString: "00000000-0000-0000-0000-0000000000c2")!

    private static func container(seed: Bool, many: Int = 0) -> (AppContainer, CollectionsModel) {
        let container = IconsGallery.container(releases: StatsGallery.releases + [macOnly])
        if seed {
            let r = StatsGallery.releases
            let stamp = Date()
            func make(_ id: UUID, _ name: String, _ items: [CollectionItem], _ age: Double) -> MusicCollection {
                MusicCollection(id: id, name: name, items: items, origin: "ios", originDevice: "Gallery", createdAt: stamp, updatedAt: stamp.addingTimeInterval(-age))
            }
            let collections = [
                make(queueID, "Late drives", [.release(r[0].id), .track(releaseId: r[1].id, trackId: r[1].tracks[0].id), .release(macOnly.id), .release(r[2].id)], 0),
                make(UUID(), "Sunday morning, slow coffee", [.release(r[3].id), .release(r[4].id)], 60),
                make(UUID(), "Gym", [.track(releaseId: r[5].id, trackId: r[5].tracks[0].id)], 120),
                make(UUID(), "Someday", [], 180),
                make(noneHereID, "From the Mac", [.release(macOnly.id)], 240),
            ]
            for collection in collections { try? container.collections.upsert(collection) }
            // The record player's 200-collection frame: the same few releases, shuffled into many names.
            for n in 0..<many {
                try? container.collections.upsert(make(UUID(), "Collection \(n + 1)", [.release(r[n % r.count].id)], 300 + Double(n)))
            }
        }
        let model = container.makeCollectionsModel()
        model.reload()
        return (container, model)
    }

    static func playingSetup(missingFirst: Bool = false, seed: Bool = true, many: Int = 0) -> (container: AppContainer, model: CollectionsModel, playback: PlaybackService) {
        let (container, model) = container(seed: seed, many: many)
        let firstPlayable = model.collection(queueID).flatMap { model.playQueue(of: $0).first?.trackID }
        let playback = PlaybackService(
            engine: GalleryEngine(), access: missingFirst ? GalleryAccess(missing: firstPlayable) : GalleryAccess(), session: GallerySession(),
            nowPlaying: GalleryNowPlaying(), remote: GalleryRemote(), coverData: { _ in nil }
        )
        return (container, model, playback)
    }

    static func library() -> some View {
        UserDefaults.standard.set(LibraryLayout.list.rawValue, forKey: LibraryViewPrefs.layoutKey)
        let (container, _) = container(seed: true)
        return IconsGallery.environment(IconsLibrary(openTray: false), container)
    }

    static func screen(seed: Bool = true) -> some View {
        let (container, model) = container(seed: seed)
        return IconsGallery.environment(NavigationStack { CollectionsView(model: model) { _ in } }, container)
    }

    static func queue(editing: Bool = false, guideOpen: Bool = false, id: UUID = queueID) -> some View {
        let (container, model) = container(seed: true)
        return IconsGallery.environment(NavigationStack { CollectionDetailView(model: model, id: id, startsEditing: editing, startsGuideOpen: guideOpen) {} }, container)
    }

    static func addSheet(saveFails: Bool = false) -> some View {
        let (container, model) = container(seed: true)
        let target = StatsGallery.releases[5]
        let failing = CollectionsModel(store: FailingCollectionStore(base: container.collections), library: container.library, hook: nil)
        failing.reload()
        return IconsGallery.environment(
            Color.black.sheet(isPresented: .constant(true)) {
                AddToCollectionSheet(
                    model: saveFails ? failing : model, items: [.release(target.id)],
                    initialFailure: saveFails ? Copy.Collections.addFailed(to: "Late drives") : nil
                ) {}
            },
            container)
    }
}

/// A store that reads but never saves, for the add sheet's failure frame.
private struct FailingCollectionStore: CollectionStore {
    let base: CollectionStore
    func all() throws -> [MusicCollection] { try base.all() }
    func get(_ id: UUID) throws -> MusicCollection? { try base.get(id) }
    func upsert(_ collection: MusicCollection) throws { throw CocoaError(.fileWriteUnknown) }
    func delete(id: UUID) throws { throw CocoaError(.fileWriteUnknown) }
}

/// #352: the Collections screen as a record player over a player on fakes.
private struct CollectionsPlayerGallery: View {
    var seed = true
    var playing = true
    var paused = false
    /// The wheel is turned to another collection than the playing one.
    var browsing = false
    var vinyl = false
    var missingFirst = false
    var many = 0
    @State private var built: (container: AppContainer, model: CollectionsModel, playback: PlaybackService)

    init(reduceMotion: Bool = false, scrollsTo: String? = nil, seed: Bool = true, playing: Bool = true, paused: Bool = false, browsing: Bool = false, vinyl: Bool = false, missingFirst: Bool = false, many: Int = 0) {
        self.seed = seed
        self.playing = playing
        self.paused = paused
        self.browsing = browsing
        self.vinyl = vinyl
        self.missingFirst = missingFirst
        self.many = many
        UserDefaults.standard.set(reduceMotion, forKey: WheelMotion.debugReduceMotionKey)
        UserDefaults.standard.set(scrollsTo ?? "", forKey: CollectionsPlayerView.debugScrollKey)
        UserDefaults.standard.set(vinyl ? SpinningRecord.vinyl.rawValue : SpinningRecord.picture.rawValue, forKey: CollectionsViewPrefs.recordKey)
        UserDefaults.standard.set(CollectionsViewMode.player.rawValue, forKey: CollectionsViewPrefs.viewKey)
        _built = State(initialValue: CollectionsGallery.playingSetup(missingFirst: missingFirst, seed: seed, many: many))
    }

    var body: some View {
        IconsGallery.environment(
            NavigationStack { CollectionsView(model: built.model, onOpen: { _ in }, startsOn: browsing ? built.model.collections.dropFirst(3).first?.id : nil) }
                .environment(\.playback, built.playback),
            built.container
        )
        .task {
            guard playing else { return }
            let queue = built.model.collection(CollectionsGallery.queueID).map { built.model.playQueue(of: $0) } ?? []
            let releases = Set(queue.map(\.releaseID)).compactMap { built.model.releases[$0] }
            built.playback.play(
                items: queue.map { QueueItem(releaseId: $0.releaseID, trackId: $0.trackID) }, releases: releases,
                context: QueueContext(kind: .collection, id: CollectionsGallery.queueID), startingAt: missingFirst ? 0 : 2
            )
            if paused {
                try? await Task.sleep(for: .milliseconds(400))
                built.playback.togglePlayPause()
            }
        }
    }
}

/// A collection page whose player (on fakes) is playing the collection's second playable track.
private struct CollectionsPlayingGallery: View {
    /// The first playable track's file is gone: its row shows "Couldn't play this track" with Try again.
    var missingFirst = false
    @State private var built: (container: AppContainer, model: CollectionsModel, playback: PlaybackService)
    init(missingFirst: Bool = false) {
        self.missingFirst = missingFirst
        _built = State(initialValue: CollectionsGallery.playingSetup(missingFirst: missingFirst))
    }
    var body: some View {
        IconsGallery.environment(
            NavigationStack { CollectionDetailView(model: built.model, id: CollectionsGallery.queueID) {} }
                .environment(\.playback, built.playback),
            built.container
        )
        .task {
            let queue = built.model.collection(CollectionsGallery.queueID).map { built.model.playQueue(of: $0) } ?? []
            let releases = Set(queue.map(\.releaseID)).compactMap { built.model.releases[$0] }
            built.playback.play(
                items: queue.map { QueueItem(releaseId: $0.releaseID, trackId: $0.trackID) }, releases: releases,
                context: QueueContext(kind: .collection, id: CollectionsGallery.queueID), startingAt: missingFirst ? 0 : 2
            )
        }
    }
}

/// The highlighted release in a stack that opens artist links like the Library does, so a test can push an
/// artist page off it (#362).
private struct HighlightedReleaseHost: View {
    let release: Release
    let trackID: UUID?
    @State private var path: [ArtistRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            ReleaseDetailView(release: release, highlightTrackID: trackID, holdsHighlight: true)
                .navigationDestination(for: ArtistRoute.self) { ArtistPageView(route: $0) }
        }
        .artistLinks { path.append($0) }
    }
}

#endif
