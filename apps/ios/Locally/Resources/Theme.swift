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
    /// Text on an `accent` fill (the primary pill, selected toggles).
    static let onAccent = Color.black
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
    /// A record's label with no art (#296): black, with a 1 pt ring, never `accent`.
    static let noCoverLabel = Color(red: 0x05 / 255, green: 0x05 / 255, blue: 0x05 / 255)
    static let noCoverLabelRing = Color(red: 0x1E / 255, green: 0x1E / 255, blue: 0x1E / 255)
    static let danger = Color(red: 0xF1 / 255, green: 0x5E / 255, blue: 0x6C / 255)
    /// iOS accent (#1E7DF0) — never Spotify green.
    static let accent = Color(red: 0x1E / 255, green: 0x7D / 255, blue: 0xF0 / 255)

    /// Type roles from `docs/design.md`'s "Type" table, iOS/mobile column.
    enum Cover {
        /// The crop sheet's title at the default text size; it scales with title3.
        static let cropTitleSize: CGFloat = 19
        /// The crop canvas: its height when there's room, and the least it shrinks to.
        static let cropCanvasHeight: CGFloat = 280
        static let cropCanvasMinHeight: CGFloat = 160
    }

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
        /// The main button keeps this minimum at every text size (full width); taller labels grow the capsule instead.
        static let primaryButtonMinHeight: CGFloat = 48
        /// The smallest touch target (docs/design.md "Design rules (30 Oct 2026)", rule 11): a compact main button, an icon button, one switch option.
        static let minTarget: CGFloat = 44
    }

    /// The sticky footer's fade (docs/design.md "Sticky footer CTA (mobile)").
    enum Footer {
        /// How far the fade starts above the bar's top edge (docs/design.md "Sticky footer CTA (mobile)").
        static let fadeRise: CGFloat = 48
        /// The fade's opacity at the bar's top edge, whatever the bar's height, so text in the bar
        /// (a failed send's message) never sits over readable content (docs/design.md "Sticky footer CTA (mobile)").
        static let fadeTopOpacity: Double = 0.85
        /// The fade's opacity at the bottom edge (docs/design.md "Sticky footer CTA (mobile)").
        static let fadeOpacity: Double = 0.94
    }

    /// The library home's cover grid, press lift and "library sky".
    enum Library {
        /// Minimum tile width per `CoverSize` (small, medium, large). With
        /// `Spacing.listPagePadding` on a 390 or 402 pt phone these give 5, 3 and 2 columns.
        static let tileMinWidth: [CGFloat] = [60, 96, 150]
        /// Gap between tiles per `CoverSize`.
        static let tileGap: [CGFloat] = [8, 12, 16]
        static let tileCornerRadius: CGFloat = 8
        // The cover size slider (#360) and the Collections card.
        /// The slider's width with its two glyphs, the hit height, the thumb's size, the track's thickness and the snap duration.
        static let sizeSliderWidth: CGFloat = 128
        static let sizeSliderHeight: CGFloat = 44
        /// The slim slider (#411): the knob's size, the track's thickness, the knob's largest size and the detent dots' size and opacity.
        static let sizeSliderThumb: CGFloat = 20
        static let sizeSliderTrack: CGFloat = 4
        static let sizeSliderThumbMax: CGFloat = 28
        static let sizeSliderDetent: CGFloat = 6
        static let sizeSliderDetentOpacity: Double = 0.4
        /// The layout toggle's 44 pt buttons and how far the neutral thumb is inset from their top and bottom.
        static let toggleThumbInset: CGFloat = 3
        static let sizeSliderGlyph: CGFloat = 13
        static let sizeSliderSnapDuration: Double = 0.3
        /// The Collections card: its minimum height, sleeve side, how far each sleeve peeks out, the tilt and the corner radius.
        static let collectionsCardMinHeight: CGFloat = 80
        static let collectionsCardSleeve: CGFloat = 52
        /// How far the back sleeves sit to the right of the front one, per sleeve behind.
        static let collectionsCardSleeveStep: CGFloat = 4
        /// The card's cover-colour wash: opacity at the leading edge and the share of the width where it has faded out.
        static let collectionsCardWashOpacity: Double = 0.55
        static let collectionsCardWashEnd: CGFloat = 0.7
        /// The stacked sleeves' tilts (back two, in degrees), the vinyl's size against the sleeve and how far it peeks out.
        static let collectionsCardBackTilts: [Double] = [-7, 5]
        static let collectionsCardDiscRatio: CGFloat = 0.92
        static let collectionsCardDiscPeek: CGFloat = 24
        /// The pressed card: its scale, opacity and the duration of the change.
        static let collectionsCardPressScale: CGFloat = 0.98
        static let collectionsCardPressOpacity: Double = 0.85
        static let collectionsCardPressDuration: Double = 0.2
        static let collectionsCardRadius: CGFloat = 16
        /// The Singles / Albums header buttons: tap target, chevron size and the fold's duration.
        static let sectionHeaderMinHeight: CGFloat = 44
        static let sectionChevronSize: CGFloat = 12
        static let sectionFoldDuration: Double = 0.3
        static let listPanelCornerRadius: CGFloat = 16
        /// A pressed cover grows by this factor and gains a soft shadow.
        static let pressScale: CGFloat = 1.03
        static let pressShadowRadius: CGFloat = 10
        static let pressShadowOpacity: Double = 0.35
        static let pressShadowY: CGFloat = 4
        static let pressDuration: Double = 0.15
        /// Scroll distance after which a pressed release stops colouring the sky.
        static let pressedSkyReleaseDistance: CGFloat = 120
        static let thumbnailSize: CGFloat = 56
        /// The hairline between the Singles and Albums sections.
        static let sectionDivider = Color.white.opacity(0.07)
        /// The search box's minimum height; it grows with its scaled text.
        static let searchMinHeight: CGFloat = 40
        static let searchPaddingV: CGFloat = 8
        static let searchPaddingH: CGFloat = 14
        static let noMatchesTopPadding: CGFloat = 32
        /// Spacing between header controls and between a tile's cover and text.
        static let headerControlGap: CGFloat = 8
        static let tileTextGap: CGFloat = 8
        static let toggleIconSize: CGFloat = 15
        static let toggleButtonSize: CGFloat = 36
        /// Where the layout toggle and sort stop growing, so the three-way toggle fits a 320 pt screen.
        static let toggleIconMaxSize: CGFloat = 35
        static let toggleButtonMaxSize: CGFloat = 84
        /// The eyebrow keeps clear of the header's cloud: its 44 pt hit area plus a gap beside it,
        /// or the cloud's row above it when it doesn't fit beside.
        static let cloudClearance: CGFloat = 52
        static let cloudRowHeight: CGFloat = 44
        /// The empty state's Locally-to-Spotify diagram: the chevron between the tiles, and the Spotify tile's note.
        static let diagramChevronSize: CGFloat = 13
        static let diagramIconSize: CGFloat = 26
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
        /// Degrees each glow turns per screen scrolled (`.ambient-sky-1` 28, `.ambient-sky-2` -22).
        static let scrollTurnPrimary: Double = 28
        static let scrollTurnSecondary: Double = 22
        /// Fake glass (no blur over the backdrop): a faint white fill and a hairline stroke.
        static let panelFillOpacity: Double = 0.06
        static let panelStrokeOpacity: Double = 0.10
        /// How long "Saved to your library" stays in the save dock.
        static let savedToastSeconds: Double = 2.5
        static let dockStatusFade: Double = 0.2
        /// The view/edit mode cross-fade on the release page (opacity only).
        static let modeFade: Double = 0.25
        /// The review sheet's cover thumbnails and their corner radius.
        static let reviewThumbSize: CGFloat = 56
        static let reviewThumbRadius: CGFloat = 6
        /// Between rows of the review sheet and between a row's old and new value.
        static let reviewRowSpacing: CGFloat = 16
        static let reviewValueSpacing: CGFloat = 4
        static let dockBottomPadding: CGFloat = 12
        static let dockGap: CGFloat = 12
        /// Padding inside the hero row so the sleeve's shadow (radius 26, y 24) fades out unclipped.
        static let sleeveShadowRoomTop: CGFloat = 16
        static let sleeveShadowRoomBottom: CGFloat = 64
        /// Gap between the title/artist and the year/genre row (web `mt-1` + `gap-3`).
        static let fieldsMetaGap: CGFloat = 10
        /// Tap height of the playlist and delete rows, since list rows have no minimum here.
        static let panelActionMinHeight: CGFloat = 40
        static let panelRowInset: CGFloat = 12
        static let grooveWidth: CGFloat = 1
        static let grooveOpacity: Double = 0.04
        /// `.record-face` dark ring (`63.5% 64.5%` of the farthest-corner radius, 1.414 x the disc radius).
        static let discRingRadiusRatio: CGFloat = 0.898
        static let discRingWidth: CGFloat = 1.4
        static let discRingOpacity: Double = 0.35
        static let discEdgeOpacity: Double = 0.07
        /// The dock's opaque base, so the tracks panel never shows through behind its text while the keyboard lifts it.
        static let dockUnderlay = Color.black
        static var panelFill: Color { .white.opacity(panelFillOpacity) }
        static var panelStroke: Color { .white.opacity(panelStrokeOpacity) }
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
        /// `.record-sleeve::after`: a 135deg sheen fading out by 40%. The web's 1 px edge is
        /// left out on purpose: a hairline round the cover shows as a line against the wash (#158).
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
        /// Labelled fields: the label column, the gap between rows, and the always-visible underline.
        static let labeledFieldLabelWidth: CGFloat = 66
        static let labeledFieldRowGap: CGFloat = 12
        static let labeledFieldLabelGap: CGFloat = 12
        static let labeledFieldUnderlineRestOpacity: Double = 0.12
        /// The album notice: corner radius, padding, icon gap, and its entrance (fade and rise).
        static let albumNoticeRadius: CGFloat = 12
        static let albumNoticePadding: CGFloat = 12
        static let albumNoticeIconGap: CGFloat = 8
        static let albumNoticeRise: CGFloat = 6
        static let albumNoticeDuration: Double = 0.35
        /// `primaryText` at this opacity keeps the notice readable over a bright cover wash.
        static let albumNoticeTextOpacity: Double = 0.9
        /// A field row's leading inset, so a round first letter (G, S, C, O) that overshoots the
        /// text's left edge isn't clipped by the list cell. Kept to 1 pt so the text still lines up.
        static let inlineFieldOvershoot: CGFloat = 1
        /// The side margin of every section on the record screens (import and release page), set
        /// explicitly so the record's rows and the tracks panel line up at every screen width.
        static let listSideMargin: CGFloat = 16
        /// The record section's row side inset. On iOS 26 that section is full width (see
        /// `recordListSection()`) and its rows carry `listSideMargin`; earlier, the list's margin does.
        /// Built with an SDK before iOS 26 (Xcode 16, CI) there is no section margin to clear, so 0.
        static var recordRowSideInset: CGFloat {
            #if compiler(>=6.2)
            if #available(iOS 26, *) { return listSideMargin }
            #endif
            return 0
        }
        /// Empty-sleeve caption spacing.
        static let sleeveCaptionPadding: CGFloat = 16
        /// The cover sheet's recent covers: square thumbnails in a scrolling row.
        static let recentCoverSize: CGFloat = 68
        static let recentCoverGap: CGFloat = 12
        /// Height the sheet's drag indicator takes above the content.
        static let coverSheetGrabberRoom: CGFloat = 24

        // The Collections record player (#352), the house record easing `.timingCurve(0.16, 1, 0.3, 1)`.
        /// The wheel snapping to a row after a drag, and turning to a tapped row.
        static let wheelSnapDuration: Double = 0.45
        static let wheelTapDuration: Double = 0.55
        /// The hub record changing between Picture disc and Black vinyl, in place.
        static let hubStyleDuration: Double = 0.3
        /// The hub's radius (the dark platter rim included), and the rim's width.
        static let hubRadius: CGFloat = 154
        static let hubRimWidth: CGFloat = 8
        /// The dark scrim over the page's cover wash, so grey text stays at 4.5:1 on a pale cover.
        static let playerScrimOpacity: Double = 0.45
        /// The switch's dot fading in under the chosen word.
        static let wheelTagFadeDuration: Double = 0.2
        /// The platter's dark rim.
        static let platterColor = Color(red: 0x0A / 255, green: 0x0A / 255, blue: 0x0A / 255)
    }

    /// "Make a record" (#205): the cover beat and the invitation, ported from the `.imp-*` rules in
    /// `apps/web/src/app/globals.css`. The beat's clock is in `Views/Import/ImportBeat.swift`.
    enum Import {
        /// The slim switch: each option's minimum tap height, and (for the play disc, until #414) the black under a tint.
        static let kindSwitchMinTarget: CGFloat = 44
        /// A stacked switch is a rounded track, not a capsule, so its thumb stays inside; the thumb is
        /// concentric, inset from the track by this much.
        static let kindSwitchStackCorner: CGFloat = 22
        static let kindSwitchPadding: CGFloat = 3
        /// Send scrolls the record back to the sleeve over this long (docs/design.md "Make a record").
        static let sendScrollDuration: Double = 0.35
        /// Then waits this long for the scroll to settle; skipped with Reduce Motion.
        static let sendScrollSettle: Double = 0.45
        /// A failed send's message: at most this many lines, or `sendErrorLinesLarge` at the
        /// accessibility text sizes, so Send stays on screen (docs/design.md "Make a record").
        static let sendErrorLines = 5
        static let sendErrorLinesLarge = 3
        /// The soft dark halo behind that message: its inset and blur radius, and its opacity.
        static let sendErrorHaloInset: CGFloat = 8
        static let sendErrorHaloOpacity: Double = 0.9
        /// `.imp-flash`: the flash's centre and edge, and the faint spill past the sleeve
        /// (`box-shadow: 0 0 16px 2px rgb(255 248 238 / 0.4)`).
        static let flashCenter = Color(red: 255 / 255, green: 252 / 255, blue: 246 / 255)
        static let flashEdge = Color(red: 255 / 255, green: 248 / 255, blue: 238 / 255)
        static let spillRadius: CGFloat = 16
        static let spillOpacity: Double = 0.4
        /// `imp-slide`: the new cover starts this far to the right.
        static let slideDistance: Double = 48
        /// `imp-turn`: the disc turns this far into place.
        static let discTurnDegrees: Double = 240

        /// `.imp-wash-band`: accent at 9 % at 35 %, 38 % at 78 %, a 35 % white-tinted accent at
        /// 62 % at 92 %, clear at both ends.
        static let washEarly = Theme.accent.opacity(0.09)
        static let washEarlyAt = 0.35
        static let washMid = Theme.accent.opacity(0.38)
        static let washMidAt = 0.78
        /// `color-mix(in srgb, white 35%, accent)`.
        static let washGlint = Color(red: 0.35 + 0.65 * (0x1E / 255.0), green: 0.35 + 0.65 * (0x7D / 255.0), blue: 0.35 + 0.65 * (0xF0 / 255.0)).opacity(0.62)
        static let washGlintAt = 0.92
        static let washSkewDegrees: Double = 12
        /// The band is 120 % of the screen's width and sweeps from -100 % to -8 % of its own width.
        static let washWidthRatio: Double = 1.2
        static let washStartX: Double = -1
        static let washEndX: Double = -0.08
        static let washSweepDuration: Double = 0.7
        /// `imp-wash-fade` (linear): opacity 1 at 12 %, 0.85 at 55 %, 0 at 100 %.
        static let washPeakAt = 0.12
        static let washHoldAt = 0.55
        static let washHoldOpacity = 0.85

        /// `.imp-invite`: the bare disc, button and hint fade in and rise after the band.
        static let inviteDiscSize: CGFloat = 176
        /// #330: the bare disc's accent label; `.record-label-invite` radial sheen (white 28 % at 35 % 30 %) and a dark edge.
        static let inviteLabelSheen = 0.28
        static let inviteLabelEdge = 0.35
        static let inviteRise: CGFloat = 6
        static let inviteFadeDuration: Double = 0.48
        static let inviteFadeDelay: Double = 0.28
        static let reducedFadeDuration: Double = 0.16
        /// Extra time after the sweep and the fade before the band's clock is dropped.
        static let inviteSettleMargin: Double = 0.25
        static let inviteGap: CGFloat = 20
        static let inviteButtonGap: CGFloat = 8

        /// Floating glass (`GlowGlass`, `GlowRim`): its fill and corner highlight, and the rim.
        static let glowFillTop: Double = 0.14
        static let glowFillBottom: Double = 0.04
        static let glowFillBottomAt = 0.55
        static let glowCornerHighlight: Double = 0.18
        static let glowRim: Double = 0.12
        static let glowRimTop: Double = 0.32

        /// The cover's backdrop over the studio one: in once the wash starts, out when the cover goes.
        static let backdropFadeInDuration: Double = 0.5
        static let backdropFadeOutDuration: Double = 0.4

        /// The Sent card (docs/design.md "Make a record", Send). The dimmed page: black at this
        /// opacity, faded in over `sentDimDuration`.
        static let sentDimOpacity: Double = 0.45
        static let sentDimDuration: Double = 0.25
        /// The card: radius, padding and the gap to the screen's edges. Its height is capped at
        /// this share of the screen's so its content scrolls at large text.
        static let sentCardRadius: CGFloat = 28
        static let sentCardPadding: CGFloat = 24
        static let sentCardEdgeInset: CGFloat = 16
        static let sentCardMaxHeightRatio: CGFloat = 0.62
        static let sentContentGap: CGFloat = 12
        static let sentButtonGap: CGFloat = 8
        /// Icon to label gap in the Sent card's glow button, as in Send to Spotify.
        static let sentButtonIconGap: CGFloat = 8
        /// The entrance: up from this far below at this scale, on a spring.
        static let sentRise: CGFloat = 40
        static let sentRiseScale: CGFloat = 0.94
        static let sentSpringResponse: Double = 0.5
        static let sentSpringDamping: Double = 0.72
        /// The glow behind the card's top: blurred, from this scale, in over `sentGlowDuration`.
        static let sentGlowBlur: CGFloat = 40
        static let sentGlowStartScale: CGFloat = 0.6
        static let sentGlowDuration: Double = 0.7
        static let sentGlowWidthRatio: CGFloat = 0.8
        static let sentGlowHeight: CGFloat = 160
        /// The sealed record on the card's top edge: its sleeve, and the tilt it drops in at and settles to.
        static let sentRecordSize: CGFloat = 96
        static let sentRecordTiltStart: Double = -8
        static let sentRecordTiltEnd: Double = -3
        /// Close drops the card away over this long; with Reduce Motion the card (and glow) fade in and out over `sentReducedFadeDuration`.
        static let sentCloseDuration: Double = 0.2
        static let sentReducedFadeDuration: Double = 0.2
        /// VoiceOver focus moves to "Sent" this long after the card appears.
        static let sentFocusDelay: Double = 0.1
    }

    /// The "studio" backdrop behind Settings (#160): the accent blue and a cool violet, with a deep
    /// navy at the top. `ArtworkBackdrop` pulls each down by its luminance cap.
    enum Studio {
        static let blue = Color(red: 0.10, green: 0.42, blue: 0.90)
        static let violet = Color(red: 0.46, green: 0.30, blue: 0.92)
        static let deep = Color(red: 0.02, green: 0.04, blue: 0.11)
    }

    /// The Stats page (#204): the medal colours of ranks 1 to 3 (ported from the Mac's `.st-rank`,
    /// `.medal-name` and the fan's rims) and the sizes of its fan, rows and grid.
    enum Stats {
        static let gold = Color(red: 0xEC / 255, green: 0xCE / 255, blue: 0x78 / 255)
        static let silver = Color(red: 0xB9 / 255, green: 0xC3 / 255, blue: 0xD2 / 255)
        static let bronze = Color(red: 0xDC / 255, green: 0x9A / 255, blue: 0x5E / 255)
        /// Names in the list, grid and under the fan: a shade lighter than the bronze rank so they hold 4.5:1.
        static let bronzeName = Color(red: 0xE8 / 255, green: 0xA9 / 255, blue: 0x70 / 255)
        static let goldRim = Color(red: 0xDC / 255, green: 0xB8 / 255, blue: 0x60 / 255)
        static let silverRim = Color(red: 0xC5 / 255, green: 0xCA / 255, blue: 0xD3 / 255)
        static let bronzeRim = Color(red: 0xC9 / 255, green: 0x8A / 255, blue: 0x4E / 255)

        /// A grid cover's sleeve depth (#361): a 1 pt top-edge highlight, a soft drop shadow, and a disc peeking out of ranks 1 to 3.
        static let tileEdgeTop: Double = 0.28
        static let tileShadow: Double = 0.5
        static let tileShadowRadius: CGFloat = 8
        static let tileShadowY: CGFloat = 5
        static let tileDiscPeek: CGFloat = 0.08
        /// The glass rank chip's dark base, under the glass, so the number holds 4.5:1 on a pale cover.
        static let chipBase: Double = 0.72
        /// The word "plays" under a tile's name, softer than its number.
        static let playsWordOpacity: Double = 0.72

        static let gutter: CGFloat = 16
        static let rowCover: CGFloat = 44
        /// A Stats list row narrower than this stacks its plays under the name; narrower than `wideRow` it drops the last-played line (#361).
        static let narrowRow: CGFloat = 350
        static let wideRow: CGFloat = 430
        static let minTarget: CGFloat = 44
        static let tileMin: CGFloat = 72
        static let tileGap: CGFloat = 12
        static let tileRowGap: CGFloat = 18
        static let maxSleeve: CGFloat = 130
        static let sleeveWidthFraction: CGFloat = 0.34
        /// The shine's cycle, one sweep and the delay of gold, silver and bronze (the Mac's `fan-shine-sweep`).
        static let shineCycle: Double = 8
        static let shineSweep: Double = 1.7
        static let shineDelays: [Double] = [1.5, 1.8, 2.1]
        static let openingBeat: Double = 0.36
        static let liftDuration: Double = 0.35
        static let fanInDuration: Double = 0.4
        static let fanInStagger: Double = 0.052
        static let fanInBase: Double = 0.06
    }

    /// Cool tints for Settings' icon tiles and highlights, kept beside the accent blue.
    enum Tint {
        static let violet = Color(red: 0.62, green: 0.50, blue: 1.0)
        static let teal = Color(red: 0.30, green: 0.80, blue: 0.84)
        static let slate = Color(red: 0.62, green: 0.68, blue: 0.80)
        /// Text and glyphs on the faint accent fill of a pill.
        static let accentText = Color(red: 0.45, green: 0.70, blue: 1.0)
    }

    /// Type roles as Dynamic Type styles, for screens that must scale with the reader's text size
    /// (Settings, #160). `Font` above is fixed points.
    enum ScaledFont {
        static let largeTitle = SwiftUI.Font.system(.largeTitle, weight: .bold)
        /// The record's title field (#205): `Font.pageTitle` as a Dynamic Type style.
        static let pageTitle = SwiftUI.Font.system(.title2, weight: .bold)
        /// The Sent card's title (28 pt bold at the default size).
        static let sentTitle = SwiftUI.Font.system(.title, weight: .bold)
        static let sectionTitle = SwiftUI.Font.system(.subheadline, weight: .semibold)
        static let headline = SwiftUI.Font.system(.headline, weight: .semibold)
        static let subheadline = SwiftUI.Font.system(.subheadline)
        static let button = SwiftUI.Font.system(.subheadline, weight: .semibold)
        static let rowTitle = SwiftUI.Font.system(.body, weight: .regular)
        static let value = SwiftUI.Font.system(.body, weight: .regular)
        static let input = SwiftUI.Font.system(.body, weight: .regular)
        static let fieldTitle = SwiftUI.Font.system(.title3, weight: .semibold)
        static let caption = SwiftUI.Font.system(.footnote, weight: .regular)
        static let pill = SwiftUI.Font.system(.footnote, weight: .semibold)
        /// A track row (`TrackList`): the number and plays are subheadline with tabular digits, the title body semibold.
        static let trackNumber = SwiftUI.Font.system(.subheadline).monospacedDigit()
        static let trackTitle = SwiftUI.Font.system(.body, weight: .semibold)
    }

    /// A track row, after the Mac's `TrackList` (`.track-row`, `.track-affordance`).
    enum Track {
        static let minHeight: CGFloat = 48
        static let numberWidth: CGFloat = 24
        /// The tap area of the number when it is a disc menu (#222).
        static let discMenuHitSize: CGFloat = 44
        static let spacing: CGFloat = 12
        static let numberOpacity: Double = 0.6
        /// The replace button's circling arrows, and its tap area.
        static let replaceOpacity: Double = 0.6
        static let replaceHitSize: CGFloat = 44
        /// The track length at the trailing edge.
        static let lengthOpacity: Double = 0.6
        static let gripOpacity: Double = 0.35
        /// The hairline between rows (`.track-list > .track-row` border).
        static let separatorOpacity: Double = 0.07
        static var separatorTint: Color { .white.opacity(separatorOpacity) }
        /// The wash behind the track a release was opened from (#362): the accent at this opacity.
        static let highlightCornerRadius: CGFloat = 12
        /// The wash's gradient, leading to trailing, in the cover's brightest glow colour; the rim; the outer glow.
        static let highlightLeading: Double = 0.30
        static let highlightTrailing: Double = 0.06
        static let highlightRimTop: Double = 0.30
        static let highlightRim: Double = 0.16
        static let highlightGlow: Double = 0.35
        static let highlightGlowRadius: CGFloat = 12
        /// Palette colours are dark, so the tint is lifted to at least this brightness.
        static let highlightMinBrightness: Double = 0.85
        /// The needle cue at the wash's leading edge: size, how far down the wash it starts, and its starting y scale.
        static let cueWidth: CGFloat = 3
        static let cueHeight: CGFloat = 22
        static let cueTopInset: CGFloat = 8
        static let cueFromScale: CGFloat = 0.2
        /// Seconds: the wait for the push to settle, the fade in, the hold, the fade out.
        static let highlightDelay: Double = 0.35
        static let highlightFadeIn: Double = 0.3
        static let highlightHold: Double = 1.2
        static let highlightFadeOut: Double = 1.2
    }

    /// Opaque black tab and navigation bars, so a bright cover scrolling
    /// underneath never bleeds through the system blur. Settings (#160) opts out: it has no
    /// navigation bar and clears its own tab bar's background (`toolbarBackground`), so the studio
    /// backdrop runs under the bar with no black block or line. The other tabs keep these bars.
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
        // Locally's drawn chevron in place of the system one (#258), the Mac back button's glyph.
        // Apple's button, the edge swipe and the edit-mode Cancel (#220) stay.
        if let chevron = UIImage(named: "Icon/ChevronRight")?
            .withRenderingMode(.alwaysTemplate)
            .withHorizontallyFlippedOrientation() {
            nav.setBackIndicatorImage(chevron, transitionMaskImage: chevron)
        }
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav
    }
}

extension Theme {
    /// The Stats period pop-up (#367).
    enum StatsPopup {
        static let rowHeight: CGFloat = 52
        static let width: CGFloat = 264
        /// A dark base under the cover's colour keeps the white label at 4.5:1 on a bright cover.
        static let base = Color(red: 0.06, green: 0.06, blue: 0.10)
        static let baseOpacity = 0.9
        static let washOpacity = 0.28
        static let selectedWash = 0.55
        static let glow = 0.5
        /// The house easing, ~0.35 s.
        static let ease = Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.35)
    }
}

extension Theme {
    /// The queue toast (#364): a glass capsule tinted by the cover, floating above the mini player.
    enum QueueToast {
        static let thumbSide: CGFloat = 32
        static let minHeight: CGFloat = 44
        static let displaySeconds: Double = 2.5
        /// VoiceOver users get longer to hear and act on it.
        static let voiceOverSeconds: Double = 6
        static let duration: Double = 0.45
        static let rise: CGFloat = 18
        /// Dark base under the tint: text stays above 4.5:1 whatever the cover.
        static let baseOpacity: Double = 0.7
        static let tintOpacity: Double = 0.34
        static let shadowOpacity: Double = 0.35
    }
}

extension Theme {
    /// The song page (#365).
    enum SongPage {
        static let sleeveHero: CGFloat = 200
        static let sleeveMini: CGFloat = 52
        static let barHeight: CGFloat = 8
        static let pageGutter: CGFloat = 16
        /// The details panel: opaque near-black, so nothing of the wash shows through the rows.
        static let panelFill = Color(red: 0.03, green: 0.03, blue: 0.04)
        static let panelCornerRadius: CGFloat = 28
        static let panelHighlightOpacity: Double = 0.10
        static let grabberWidth: CGFloat = 36
        static let grabberHeight: CGFloat = 5
        static let grabberOpacity: Double = 0.18
        static let hairlineOpacity: Double = 0.08
        /// An action: the glyph and label at rest, the glow behind the glyph while pressed.
        static let actionGlyphSize: CGFloat = 24
        static let actionGlyphOpacity: Double = 0.92
        static let actionLabelOpacity: Double = 0.72
        static let actionMinWidth: CGFloat = 64
        static let actionMinHeight: CGFloat = 56
        /// Targets stay at 44 pt at the accessibility sizes.
        static let actionMinHeightLarge: CGFloat = 44
        static let actionGlowOpacity: Double = 0.45
        static let actionGlowRadius: CGFloat = 18
        static let ease = Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.35)
    }

    /// #366: the collection builder's sizes.
    enum Builder {
        static let sleeve: CGFloat = 176
        static let sleeveAccessibility: CGFloat = 220
        static let shelfCover: CGFloat = 132
        /// At accessibility text sizes.
        static let shelfCoverLarge: CGFloat = 112
        static let shelfRadius: CGFloat = 12
        static let songCover: CGFloat = 52
        static let songRadius: CGFloat = 8
        static let songMinHeight: CGFloat = 60
        static let crateCover: CGFloat = 52
        static let crateOverlap: CGFloat = 18
        static let crateShown = 5
        static let shelfDot: CGFloat = 28
        static let songDot: CGFloat = 30
        /// The minimum target (the close X, clear search, Done).
        static let control: CGFloat = 44
        static let searchMinHeight: CGFloat = 48
        static let mosaicSide: CGFloat = 400
        /// The house easing, for the pick toggle and press feedback only.
        static let ease = Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.35)
    }
}

extension Theme {
    /// #399: the play History screen, the owner's variant B (the day strip and the crate).
    enum History {
        static let gutter: CGFloat = 16
        static let minTarget: CGFloat = 44
        /// A frame narrower than this (or any accessibility text size) moves the time above the title.
        static let narrowWidth: CGFloat = 350
        /// The least of a disc that shows past a sleeve, as a fraction of the full peek (a 30 s skip).
        static let minPeek: CGFloat = 0.1
        static let sleeveRadiusSmall: CGFloat = 6
        static let sleeveRadiusLarge: CGFloat = 8
        static let sleeveShadowOpacity: Double = 0.45
        static let sleeveEdgeOpacity: Double = 0.22

        static let stripDays = 14
        /// The offline and busy notice's near-black backing; white text on it is above 4.5:1 over the brightest wash.
        static let noticeBackingOpacity: Double = 0.65
        static let stripColumn: CGFloat = 44
        static let stripDiscWidth: CGFloat = 30
        static let stripDiscHeight: CGFloat = 4
        static let stripDiscGap: CGFloat = 1.5
        static let stripMaxDiscs = 12
        static let stripGlowRadius: CGFloat = 14
        static let crateGap: CGFloat = 14
        static let crateStagger: CGFloat = 30
        static let crateSleeveMax: CGFloat = 200
        static let crateSleeveMaxSingle: CGFloat = 190
        static let crateRowGap: CGFloat = 22

        /// The loading shimmer's sleeve shapes.
        static let skeletonCells = 4
        static let skeletonFillOpacity: Double = 0.07
        static let skeletonSweepSeconds: Double = 1.6
    }
}
