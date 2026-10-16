#if DEBUG
import SwiftUI

/// Debug-only harness for deterministic screenshots of the immersive components. Launch the app
/// with `-componentGallery <name>`; see `LocallyApp`.
struct ComponentGallery: View {
    static let names = ["sleeve-filled", "sleeve-empty", "sleeve-ceremony", "sleeve-bright", "sleeve-dark", "backdrop-a", "backdrop-b", "inline-field", "cover-sheet",
        // #160: the studio backdrop and the real Settings with sample sync state.
        "studio-backdrop", "settings-signed-in", "settings-signed-out", "settings-code-sent", "settings-scrolled",
        // #204: the real Stats page over sample plays.
        "stats-week", "stats-albums-grid", "stats-artists", "stats-quiet", "stats-signed-out", "stats-large-text", "stats-week-scrolled", "stats-grid-scrolled"]

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
        name.hasPrefix("stats-") || ["studio-backdrop", "settings-signed-in", "settings-signed-out", "settings-code-sent", "settings-scrolled"].contains(name)
    }

    var body: some View {
        if drawsOwnBackdrop {
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
                InlineField("Title", text: $empty, font: Theme.Font.pageTitle)
                InlineField("Title", text: $title, font: Theme.Font.pageTitle)
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
        case "settings-signed-in":
            Self.settings(signedIn: true)
        case "settings-signed-out":
            Self.settings(signedIn: false)
        case "settings-code-sent":
            // The sign-in's second step (a code was sent), without sending one.
            Self.settings(signedIn: false, codeSentTo: "sample@example.com")
        case "settings-scrolled":
            // Opens at the bottom of the page, to see the lower groups and the edge fade.
            Self.settings(signedIn: true).defaultScrollAnchor(.bottom)
        case "stats-week":
            StatsGallery.page(.week)
        case "stats-week-scrolled":
            StatsGallery.page(.week).defaultScrollAnchor(.bottom)
        case "stats-albums-grid":
            StatsGallery.page(.albumsGrid)
        case "stats-grid-scrolled":
            StatsGallery.page(.albumsGrid).defaultScrollAnchor(.bottom)
        case "stats-artists":
            StatsGallery.page(.artists)
        case "stats-quiet":
            StatsGallery.page(.quiet)
        case "stats-signed-out":
            StatsGallery.page(.signedOut)
        case "stats-large-text":
            StatsGallery.page(.week).dynamicTypeSize(.accessibility2)
        default:
            EmptyView()
        }
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
             tracks: [("Night Bus to Nowhere", 48, 0), ("Orange Streetlight", 31, 1), ("Paper Moon", 12, 4)]),
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

    private static let covers: [UUID: Data] = Dictionary(uniqueKeysWithValues: seeds.map { ($0.releaseID, SampleArtwork.cover($0.colors, size: 360).pngData() ?? Data()) })

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
        return TabView {
            StatsView(model: model, cache: cache, selectedTab: .constant(.stats), librarySearchRequest: .constant(nil))
                .tabItem { Label(Copy.Stats.tabLabel, systemImage: "chart.bar") }
        }
        .tint(Theme.accent)
        .environment(FolderStatus(isConnected: true))
        .environment(PurchaseStatus(isFullUnlocked: false))
        .environment(SyncStatus())
    }
}

#endif
