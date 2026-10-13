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

    /// The "immersive" release look (#112 on the web): the record sleeve, the
    /// artwork backdrop and the inline field. Each value cites the
    /// `apps/web/src/app/globals.css` rule or `lib/artwork-palette.ts` constant
    /// it was ported from.
    enum Immersive {
        /// `CoverPicker` sleeve: 248 from `sm`, 200 below.
        static let sleeveSizeRegular: CGFloat = 248
        static let sleeveSizeCompact: CGFloat = 200
        static let sleeveCornerRadius: CGFloat = 4
        /// `RecordSleeve.tsx`: disc 184 on a 200 sleeve, 228 on 248 (both 0.92).
        static let discToSleeveRatio: CGFloat = 0.92
        /// `pr-[92px]` on a 184 disc: half the disc shows past the sleeve.
        static let discPeekRatio: CGFloat = 0.5
        /// `.record-label { inset: 32% }`: label diameter is the remaining 36%.
        static let labelToDiscRatio: CGFloat = 0.36
        /// `.record-label::after { inset: 46% }`: spindle hole is 8% of the label.
        static let spindleToLabelRatio: CGFloat = 0.08
        static let labelRingWidth: CGFloat = 3
        static let labelRingOpacity: Double = 0.5
        /// `.record-sheen` mask `transparent 0 34%`.
        static let sheenInnerRatio: CGFloat = 0.34
        /// `.record-sheen` conic gradient `from 20deg` (CSS starts at 12 o'clock).
        static let sheenStartDegrees: Double = 20
        static let sheenOpacityNear: Double = 0.1
        static let sheenOpacityFar: Double = 0.07
        /// `.record-face` repeating groove: a 1 px line every 3 px.
        static let grooveSpacing: CGFloat = 3
        static let grooveWidth: CGFloat = 1
        static let grooveOpacity: Double = 0.04
        /// `.record-face` dark ring (`63.5% 64.5%` of the farthest-corner radius, 1.414 x the disc radius).
        static let discRingRadiusRatio: CGFloat = 0.898
        static let discRingWidth: CGFloat = 1.4
        static let discRingOpacity: Double = 0.35
        static let discEdgeOpacity: Double = 0.07
        static let discColor = Color(red: 0x11 / 255, green: 0x11 / 255, blue: 0x11 / 255)
        /// `.record-face` shadow `0 24px 48px -18px`, approximated (SwiftUI has no spread).
        static let discShadowOpacity: Double = 0.6
        static let discShadowRadius: CGFloat = 20
        static let discShadowY: CGFloat = 18
        /// `.record-sleeve` shadows `0 32px 64px -24px` and `0 10px 20px -10px`, approximated.
        static let sleeveShadowFarOpacity: Double = 0.7
        static let sleeveShadowFarRadius: CGFloat = 26
        static let sleeveShadowFarY: CGFloat = 24
        static let sleeveShadowNearOpacity: Double = 0.45
        static let sleeveShadowNearRadius: CGFloat = 8
        static let sleeveShadowNearY: CGFloat = 6
        /// `.record-sleeve::after`: a 1 px edge and a 135deg sheen fading out by 40%.
        static let sleeveEdgeOpacity: Double = 0.1
        static let sleeveSheenOpacity: Double = 0.08
        static let sleeveSheenEnd: CGFloat = 0.4

        /// `@keyframes record-press`: 1300 ms total; the disc is 42% of its width into
        /// the sleeve at the 25% keyframe, then eases back out.
        static let ceremonyDuration: Double = 1.3
        static let ceremonyTuckDuration: Double = 0.325
        static let ceremonyTuckFraction: CGFloat = 0.42
        /// `.record-spin` starts 280 ms in and runs to the end of the ceremony. The web
        /// turns 540 deg and snaps back; two full turns (720) end on the same pose.
        static let ceremonySpinDelay: Double = 0.28
        static let ceremonySpinDegrees: Double = 720
        /// `.cover-in`: 520 ms fade from opacity 0 and scale 0.96.
        static let coverFadeDuration: Double = 0.52
        static let coverFadeScale: CGFloat = 0.96
        /// Reduced motion swaps the cover with a plain, short opacity change.
        static let reducedMotionFadeDuration: Double = 0.2

        /// `.ambient-backdrop` colour transition: 900 ms.
        static let backdropCrossFade: Double = 0.9
        /// `.ambient-backdrop` radial gradients: radii as a share of width and height, centres likewise.
        static let backdropPrimaryRadius = CGSize(width: 1.10, height: 0.80)
        static let backdropPrimaryCenter = CGPoint(x: 0.08, y: 0)
        static let backdropSecondaryRadius = CGSize(width: 0.70, height: 0.60)
        static let backdropSecondaryCenter = CGPoint(x: 0.96, y: 0.06)
        /// The gradients reach transparent at 72% / 70% of their radius.
        static let backdropPrimaryFade: CGFloat = 0.72
        static let backdropSecondaryFade: CGFloat = 0.70
        /// The deep colour runs down to the page black at 92% of the height.
        static let backdropDeepEnd: CGFloat = 0.92
        /// `ambient-breathe-1` / `-2` (alternate): one-way period in seconds, rotation in degrees, scale.
        static let driftPeriodPrimary: Double = 40
        static let driftPeriodSecondary: Double = 52
        static let driftRotationPrimary: (from: Double, to: Double) = (-3, 4)
        static let driftScalePrimary: (from: Double, to: Double) = (1, 1.06)
        static let driftRotationSecondary: (from: Double, to: Double) = (3, -4)
        static let driftScaleSecondary: (from: Double, to: Double) = (1.04, 0.98)
        /// `lib/artwork-palette.ts` WCAG relative-luminance caps (white text stays readable).
        static let luminanceCapPrimary: Double = 0.12
        static let luminanceCapSecondary: Double = 0.08
        static let luminanceCapDeep: Double = 0.035

        /// Underline under a focused inline field: one device pixel.
        static let inlineFieldUnderlineOpacity: Double = 0.6
        static let inlineFieldUnderlineGap: CGFloat = 4
        static let inlineFieldFocusFade: Double = 0.15
        /// Empty-sleeve caption spacing.
        static let sleeveCaptionPadding: CGFloat = 16
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
