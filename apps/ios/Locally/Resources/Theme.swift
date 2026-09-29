import SwiftUI
import UIKit

/// The app's dark palette, defined once so every screen matches: true-black
/// background, a lighter card surface, white/secondary text, and the blue
/// accent (deliberately not Spotify's green — see App Store brand rules in
/// `docs/ios-plan.md`). Tokens mirror `docs/design.md` v2, the shared design
/// language that folds in the owner's MagicPath mobile designs; every screen
/// should read these rather than hard-coding a color, font, radius or
/// spacing value.
enum Theme {
    /// `bg`: every screen's background.
    static let background = Color(red: 0, green: 0, blue: 0)
    /// `card`: cards, list containers, file rows, dialogs, the cover placeholder.
    static let card = Color(red: 0x12 / 255, green: 0x12 / 255, blue: 0x12 / 255)
    /// `elevated`: inputs, segmented control track, secondary buttons, badges, icon tiles.
    static let elevated = Color(red: 0x28 / 255, green: 0x28 / 255, blue: 0x28 / 255)
    static let elevatedHover = Color(red: 0x3A / 255, green: 0x3A / 255, blue: 0x3A / 255)
    /// `row-hover`: pressed/hovered list rows.
    static let rowHover = Color(red: 0x1C / 255, green: 0x1C / 255, blue: 0x1C / 255)
    static let primaryText = Color.white
    /// `text-muted`: secondary text, metadata on the right of headers.
    static let secondaryText = Color(red: 0xB3 / 255, green: 0xB3 / 255, blue: 0xB3 / 255)
    /// `border`: 1 pt borders on cards, rows, inputs, footers.
    static let border = Color(red: 0x28 / 255, green: 0x28 / 255, blue: 0x28 / 255)
    /// `border-dashed`: dashed borders on drop zones.
    static let borderDashed = Color(red: 0x3E / 255, green: 0x3E / 255, blue: 0x3E / 255)
    /// `dialog-border`: the crop dialog's border.
    static let dialogBorder = Color(red: 0x30 / 255, green: 0x30 / 255, blue: 0x30 / 255)
    /// `text-dim`: chevrons, footnotes, breadcrumb eyebrows.
    static let textDim = Color(red: 0x77 / 255, green: 0x77 / 255, blue: 0x77 / 255)
    /// `text-hint`: hint lines under drop zones.
    static let textHint = Color(red: 0x88 / 255, green: 0x88 / 255, blue: 0x88 / 255)
    static let danger = Color(red: 0xF1 / 255, green: 0x5E / 255, blue: 0x6C / 255)
    /// iOS accent (#1E7DF0) — never Spotify green.
    static let accent = Color(red: 0x1E / 255, green: 0x7D / 255, blue: 0xF0 / 255)

    /// Type roles from `docs/design.md`'s "Type" table, iOS/mobile column.
    enum Font {
        static let pageTitle = SwiftUI.Font.system(size: 24, weight: .bold)
        /// "Metadata", "Tracks" section titles.
        static let sectionTitle = SwiftUI.Font.system(size: 18, weight: .bold)
        static let eyebrow = SwiftUI.Font.system(size: 11, weight: .bold)
        static let fieldLabel = SwiftUI.Font.system(size: 11, weight: .bold)
        /// Text typed into a field: 16 pt on mobile.
        static let input = SwiftUI.Font.system(size: 16, weight: .regular)
        /// General paragraph copy (onboarding, paywall, done, errors).
        static let body = SwiftUI.Font.system(size: 14, weight: .regular)
        static let rowTitle = SwiftUI.Font.system(size: 15, weight: .semibold)
        static let rowSubtitle = SwiftUI.Font.system(size: 14, weight: .regular)
        /// Header meta, right-aligned ("7 tracks", "Tap to edit").
        static let meta = SwiftUI.Font.system(size: 14, weight: .regular)
        static let dropZoneLine = SwiftUI.Font.system(size: 14, weight: .medium)
        static let dropZoneHint = SwiftUI.Font.system(size: 12, weight: .regular)
        static let badge = SwiftUI.Font.system(size: 10, weight: .semibold)
        static let primaryButton = SwiftUI.Font.system(size: 15, weight: .bold)
        /// Trailing row chevron (library rows, compact release-detail rows),
        /// drawn in `textDim` per `docs/design.md`.
        static let chevron = SwiftUI.Font.system(size: 13, weight: .semibold)
    }

    /// Corner radii from "Shape and spacing". Pill shapes (buttons, the
    /// segmented control, badges) use `Capsule()` directly rather than a
    /// radius constant.
    enum Radius {
        static let input: CGFloat = 6
        static let thumbnail: CGFloat = 6
        /// Drop zones and file rows.
        static let dropZone: CGFloat = 8
        static let fileRow: CGFloat = 8
        /// List containers (`cardContainer`).
        static let card: CGFloat = 12
        /// The editor's big cover.
        static let bigCover: CGFloat = 10
        /// The crop dialog.
        static let dialog: CGFloat = 9
    }

    /// Spacing constants from "Shape and spacing".
    enum Spacing {
        /// Forms: 20. `listPagePadding` covers the 16 pt list variant.
        static let pagePadding: CGFloat = 20
        static let listPagePadding: CGFloat = 16
        static let sectionGap: CGFloat = 32
        /// The mobile editor's slightly tighter section gap.
        static let editorSectionGap: CGFloat = 28
        /// Gap between a field's label and its input.
        static let labelGap: CGFloat = 8
        /// Gap between stacked fields within one section.
        static let fieldGap: CGFloat = 16
        /// Gap between rows in a list (e.g. album track rows).
        static let rowGap: CGFloat = 4
        static let inputPaddingH: CGFloat = 16
        static let inputPaddingV: CGFloat = 12
        static let primaryButtonH: CGFloat = 32
        static let primaryButtonV: CGFloat = 12
    }

    /// Opaque black tab and navigation bars, so a bright cover scrolling
    /// underneath never bleeds through the system blur.
    static func applyChrome() {
        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = .black
        tab.shadowColor = UIColor(white: 0.16, alpha: 1)
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab

        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = .black
        nav.shadowColor = .clear
        nav.titleTextAttributes = [.foregroundColor: UIColor.white]
        nav.largeTitleTextAttributes = [.foregroundColor: UIColor.white]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav
    }
}
