import SwiftUI

/// The app's dark palette, defined once so every screen matches: near-black
/// background, slightly-lighter panels, white/secondary text, and the
/// orange accent (deliberately not Spotify's green — see App Store brand
/// rules in `docs/ios-plan.md`). Tokens mirror `docs/design.md`, the shared
/// design language distilled from the web app (the reference implementation);
/// every screen should read these rather than hard-coding a color, font, radius
/// or spacing value.
enum Theme {
    static let background = Color(red: 0x12 / 255, green: 0x12 / 255, blue: 0x12 / 255)
    static let panel = Color(red: 0x18 / 255, green: 0x18 / 255, blue: 0x18 / 255)
    static let elevated = Color(red: 0x28 / 255, green: 0x28 / 255, blue: 0x28 / 255)
    static let elevatedHover = Color(red: 0x3A / 255, green: 0x3A / 255, blue: 0x3A / 255)
    static let primaryText = Color.white
    static let secondaryText = Color(red: 0xB3 / 255, green: 0xB3 / 255, blue: 0xB3 / 255)
    static let border = Color(red: 0x2A / 255, green: 0x2A / 255, blue: 0x2A / 255)
    static let danger = Color(red: 0xF1 / 255, green: 0x5E / 255, blue: 0x6C / 255)
    static let accent = Color(red: 1.0, green: 0x7A / 255, blue: 0.0)

    /// Type roles from `docs/design.md`'s "Type" table. Sizes are points, matching
    /// the doc's iOS column.
    enum Font {
        static let pageTitle = SwiftUI.Font.system(size: 24, weight: .bold)
        static let eyebrow = SwiftUI.Font.system(size: 12, weight: .semibold)
        static let fieldLabel = SwiftUI.Font.system(size: 14, weight: .medium)
        static let body = SwiftUI.Font.system(size: 14, weight: .regular)
        static let rowTitle = SwiftUI.Font.system(size: 14, weight: .medium)
        static let rowSubtitle = SwiftUI.Font.system(size: 12, weight: .regular)
        static let badge = SwiftUI.Font.system(size: 10, weight: .semibold)
        static let primaryButton = SwiftUI.Font.system(size: 14, weight: .bold)
    }

    /// Corner radii from "Shape and spacing". Pill shapes (buttons, the segmented
    /// control, badges) use `Capsule()` directly rather than a radius constant.
    enum Radius {
        static let input: CGFloat = 6
        static let thumbnail: CGFloat = 6
        static let card: CGFloat = 6
        /// Drop zones and the cover placeholder.
        static let panel: CGFloat = 8
    }

    /// Spacing constants from "Shape and spacing".
    enum Spacing {
        static let pagePadding: CGFloat = 24
        static let sectionGap: CGFloat = 24
        /// Gap between a field's label and its input.
        static let labelGap: CGFloat = 6
        /// Gap between rows in a list (e.g. album track rows).
        static let rowGap: CGFloat = 4
        static let inputPaddingH: CGFloat = 12
        static let inputPaddingV: CGFloat = 8
        static let primaryButtonH: CGFloat = 24
        static let primaryButtonV: CGFloat = 10
    }
}
