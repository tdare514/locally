#if DEBUG
import SwiftUI

/// Debug-only harness for deterministic screenshots of the immersive components. Launch the app
/// with `-componentGallery <name>`; see `LocallyApp`.
struct ComponentGallery: View {
    static let names = ["sleeve-filled", "sleeve-empty", "sleeve-ceremony", "sleeve-bright", "sleeve-dark", "backdrop-a", "backdrop-b", "inline-field", "cover-sheet",
        // #160 design prototypes: three Settings directions, the shared studio backdrop, and today's Settings for comparison.
        "settings-a", "settings-b", "settings-c", "studio-backdrop", "settings-current"]

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

    /// The #160 screens draw their own backdrop (or, for `settings-current`, the real screen's black).
    private var drawsOwnBackdrop: Bool {
        ["settings-a", "settings-b", "settings-c", "studio-backdrop", "settings-current"].contains(name)
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
        case "settings-a":
            SettingsPrototypeA()
        case "settings-b":
            SettingsPrototypeB()
        case "settings-c":
            SettingsPrototypeC()
        case "studio-backdrop":
            StudioBackdrop()
        case "settings-current":
            // Today's Settings, signed in with the same sample state, for side-by-side screenshots.
            TabView {
                SettingsView()
                    .tabItem { Label(Copy.Settings.title, systemImage: "gearshape") }
            }
            .tint(Theme.accent)
            .environment(FolderStatus(isConnected: true))
            .environment(PurchaseStatus(isFullUnlocked: false))
            .environment(Self.sampleSyncStatus)
        default:
            EmptyView()
        }
    }

    private static var sampleSyncStatus: SyncStatus {
        let status = SyncStatus(
            signedIn: true,
            email: SettingsSample.email,
            deviceName: SettingsSample.device,
            lastRunAt: Date().addingTimeInterval(-120)
        )
        status.quota = SyncQuota(usedBytes: SettingsSample.usedMB * 1_048_576, limitBytes: SettingsSample.limitMB * 1_048_576)
        return status
    }
}
#endif
