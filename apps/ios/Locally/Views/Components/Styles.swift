import SwiftUI

/// Centralised look for every screen, matching `docs/design.md`. Screens
/// should reach for these instead of ad-hoc `.background`/`.padding`
/// combinations, so a token change here updates the whole app.

// MARK: - Buttons

/// The main action (docs/design.md "Design rules (30 Oct 2026)", rule 3): Send to Spotify, Save changes,
/// Add a track, Done, Next. A solid `text` capsule with a black semibold label, at least 44 pt tall (48
/// full width), so it has a shape at rest on a phone. A press dims it to 85 %. Disabled: an `elevated`
/// capsule with a `text-dim` label. A `ProgressView` inside takes the label's colour. The cover's colours
/// never reach it: no tint, glow, shimmer or scale.
struct MainButtonStyle: ButtonStyle {
    var isFullWidth: Bool = true
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let label = isEnabled ? Color.black : Theme.textDim
        configuration.label
            .themeFont(.primaryButton, weight: .semibold)
            .foregroundStyle(label)
            .tint(label)
            .multilineTextAlignment(.center)
            .padding(.horizontal, Theme.Spacing.primaryButtonH)
            .padding(.vertical, Theme.Spacing.primaryButtonV)
            .frame(maxWidth: isFullWidth ? .infinity : nil)
            .frame(minHeight: isFullWidth ? Theme.Spacing.primaryButtonMinHeight : Theme.Spacing.minTarget)
            .background(isEnabled ? Theme.primaryText : Theme.elevated, in: Capsule())
            .contentShape(Capsule())
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}

/// An icon-only button (rule 3): the drawn glyph in `text` in a 44 pt target, with nothing behind it. A
/// press dims it to 70 %; disabled, 40 %. Give the button an accessibility label.
struct IconButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Theme.primaryText)
            .frame(minWidth: Theme.Spacing.minTarget, minHeight: Theme.Spacing.minTarget)
            .contentShape(Rectangle())
            .opacity(isEnabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
    }
}

/// One soft white diagonal band that sweeps left to right over 0.6 s each time `pressed` turns
/// on, and is off screen the rest of the time. Only its offset animates. Held at the middle
/// when `pinned`. No button uses it any more (rule 2); the collection page's sleeve still does until
/// #414 gives it a plain playing state.
struct CoverGlowShimmer: View {
    let pressed: Bool
    let pinned: Bool
    let enabled: Bool
    @State private var progress: CGFloat = 0

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let band = w * 0.4
            let p: CGFloat = pinned ? 0.5 : progress
            LinearGradient(colors: [.clear, .white.opacity(0.35), .clear], startPoint: .leading, endPoint: .trailing)
                .frame(width: band, height: h * 2.5)
                .rotationEffect(.degrees(20))
                .offset(x: -(band + h) + p * (w + band + 2 * h), y: -h * 0.75)
        }
        .opacity(enabled ? 1 : 0)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onChange(of: pressed) { _, isPressed in
            guard isPressed, enabled, !pinned else { return }
            var reset = Transaction()
            reset.disablesAnimations = true
            withTransaction(reset) { progress = 0 }
            withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.6)) { progress = 1 }
        }
    }
}

extension Theme {
    /// The cover glow button's two colours: the cover's palette, or accent and violet with no cover
    /// (the same mapping as the Sent card's glow).
    static func coverGlowColors(_ palette: AmbientPalette?) -> [Color] {
        guard let p = palette else { return [Theme.accent, Theme.Studio.violet] }
        return [ArtworkBackdrop.color(hex: p.primary), ArtworkBackdrop.color(hex: p.secondary)]
    }
}

/// Glass for things that float (the tray, toasts, cards): the phone-tray glass's body, a top-to-bottom fill and a corner highlight.
/// Never behind something you press (rule 5).
struct GlowGlass: View {
    var body: some View {
        ZStack {
            LinearGradient(
                stops: [
                    .init(color: .white.opacity(Theme.Import.glowFillTop), location: 0),
                    .init(color: .white.opacity(Theme.Import.glowFillBottom), location: Theme.Import.glowFillBottomAt),
                    .init(color: .white.opacity(Theme.Import.glowFillBottom), location: 1),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            GeometryReader { geo in
                RadialGradient(
                    colors: [.white.opacity(Theme.Import.glowCornerHighlight), .clear],
                    center: UnitPoint(x: 0.15, y: -0.15),
                    startRadius: 0,
                    endRadius: geo.size.width * 0.6
                )
                .scaleEffect(x: 1, y: 0.58, anchor: UnitPoint(x: 0.15, y: -0.15))
            }
        }
    }
}

/// A 1 pt rim at 12 % white, brighter (32 %) along the top edge. `round` draws it on a circle.
struct GlowRim: View {
    var round = false
    /// A bounded continuous corner instead of a capsule, for multi-line content.
    var corner: CGFloat?

    private var gradient: LinearGradient {
        LinearGradient(
            stops: [
                .init(color: .white.opacity(Theme.Import.glowRimTop), location: 0),
                .init(color: .white.opacity(Theme.Import.glowRim), location: 0.4),
                .init(color: .white.opacity(Theme.Import.glowRim), location: 1),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    var body: some View {
        Group {
            if round {
                Circle().strokeBorder(gradient, lineWidth: 1)
            } else if let corner {
                RoundedRectangle(cornerRadius: corner, style: .continuous).strokeBorder(gradient, lineWidth: 1)
            } else {
                Capsule().strokeBorder(gradient, lineWidth: 1)
            }
        }
        .allowsHitTesting(false)
    }
}

/// "Cancel" / "Delete": no background, just coloured text that lightens to
/// white on press, with a 44 pt tall hit area. `color` defaults to `text-muted`; pass `Theme.danger` for
/// a destructive text button (e.g. release detail's "Delete").
struct TextButtonStyle: ButtonStyle {
    var color: Color = Theme.secondaryText
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .themeFont(.body, weight: .semibold)
            .foregroundStyle(configuration.isPressed ? Theme.primaryText : color)
            .frame(minHeight: Theme.Spacing.minTarget)
            .contentShape(Rectangle())
            .opacity(isEnabled ? 1 : 0.5)
    }
}

// MARK: - Fields

/// `elevated` background, radius 8, a 1 pt `border` always, plus a 2 pt
/// `accent` ring layered on top when focused (the border colour itself never
/// changes). Apply to a `TextField`/`SecureField` directly.
private struct FieldStyleModifier: ViewModifier {
    @FocusState private var isFocused: Bool

    func body(content: Content) -> some View {
        content
            .focused($isFocused)
            .themeFont(.input)
            .foregroundStyle(Theme.primaryText)
            .padding(.horizontal, Theme.Spacing.inputPaddingH)
            .frame(minHeight: 48)
            .background(Theme.elevated)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.input))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.input)
                    .stroke(Theme.border, lineWidth: 1)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.input)
                    .stroke(Theme.accent, lineWidth: 2)
                    .opacity(isFocused ? 1 : 0)
            )
    }
}

extension View {
    /// A text input styled per `docs/design.md`'s "Text field" component.
    func fieldStyle() -> some View {
        modifier(FieldStyleModifier())
    }

    /// A drop-zone surface, as the cover picker and audio chooser draw
    /// themselves: `card` fill with a 1 pt dashed `border-dashed`, radius 8.
    func dropZone() -> some View {
        background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.dropZone))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.dropZone)
                    .strokeBorder(Theme.borderDashed, style: StrokeStyle(lineWidth: 1, dash: [6, 4]))
            )
    }

    /// The section-eyebrow text style (e.g. "Local library"): 13 pt semibold
    /// in sentence case, no tracking, `accent` colour (#418, rule 11).
    func eyebrow() -> some View {
        themeFont(.eyebrow)
            .foregroundStyle(Theme.accent)
    }

    /// A page's eyebrow ("Local library"): the `eyebrow()` text on the
    /// Mac's backing, a capsule in the page `bg` colour (10 pt across, 2 pt down), so `accent` text
    /// keeps 5.25:1 (#1E7DF0 on #000000) over a moving backdrop or a pale cover's wash instead of the
    /// 2.3 to 2.8:1 it measured bare (#418, rule 11). The leading -10 pt lines the text up with the
    /// title under it, as the Mac's `-ml-2.5` does.
    func pageEyebrow() -> some View {
        eyebrow()
            .eyebrowBacking()
    }

    /// The page-eyebrow capsule on its own, for an eyebrow line that holds more than one run of text.
    func eyebrowBacking() -> some View {
        padding(.horizontal, Theme.Spacing.eyebrowBackingX)
            .padding(.vertical, Theme.Spacing.eyebrowBackingY)
            .background(Capsule().fill(Theme.background))
            .padding(.leading, -Theme.Spacing.eyebrowBackingX)
    }

    /// The field-label text style (e.g. "Title"): 13 pt semibold in sentence
    /// case, no tracking, muted colour (#418, rule 11).
    func fieldLabelStyle() -> some View {
        themeFont(.fieldLabel)
            .foregroundStyle(Theme.secondaryText)
    }

    /// A list-container surface: `card` fill, radius 12, 1 pt `border` —
    /// used for the library list and other grouped-row containers.
    func cardContainer() -> some View {
        background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card)
                    .stroke(Theme.border, lineWidth: 1)
            )
    }
}

// MARK: - Sticky footer

/// Pins a full-width primary action to the bottom of the screen with no border and no blur: a
/// `background` gradient (clear to 94 %) that starts `Theme.Footer.fadeRise` above the bar and runs
/// down behind the home indicator, so the page fades out under the button. Uses `.safeAreaInset`
/// so the content behind it scrolls underneath rather than being covered. Used by the library
/// ("Add a song") and the import screens ("Send to Spotify"). With `isPresented` false nothing is
/// drawn and the inset has no height.
private struct StickyFooter<Footer: View>: ViewModifier {
    let isPresented: Bool
    @ViewBuilder let footer: () -> Footer

    func body(content: Content) -> some View {
        content.safeAreaInset(edge: .bottom, spacing: 0) {
            if isPresented {
                VStack(spacing: 0) { footer() }
                    .padding(.horizontal, Theme.Spacing.pagePadding)
                    .padding(.top, 12)
                    .padding(.bottom, 16)
                    .background(alignment: .top) {
                        // In points, not fractions of the bar: clear to `fadeTopOpacity` over the
                        // rise, then on to `fadeOpacity` behind the bar however tall it grows.
                        VStack(spacing: 0) {
                            LinearGradient(
                                colors: [Theme.background.opacity(0), Theme.background.opacity(Theme.Footer.fadeTopOpacity)],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                            .frame(height: Theme.Footer.fadeRise)
                            LinearGradient(
                                colors: [Theme.background.opacity(Theme.Footer.fadeTopOpacity), Theme.background.opacity(Theme.Footer.fadeOpacity)],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        }
                        .padding(.top, -Theme.Footer.fadeRise)
                        .ignoresSafeArea(.container, edges: .bottom)
                        .allowsHitTesting(false)
                    }
            }
        }
    }
}

extension View {
    /// Wraps this view (typically a `ScrollView` or `List`) with a sticky
    /// bottom bar holding `footer`'s content — see `StickyFooter`.
    /// `isPresented` false draws nothing and takes no height.
    func stickyFooter<Footer: View>(isPresented: Bool = true, @ViewBuilder footer: @escaping () -> Footer) -> some View {
        modifier(StickyFooter(isPresented: isPresented, footer: footer))
    }
}

// MARK: - File row

/// One track/audio file row, used by the album builder and the release
/// detail's Tracks section: a `card` with a 1 pt `border`, radius 8, min
/// height 64, a 36 pt `elevated` tile holding an accent `music.note` icon,
/// a title (editable or plain text) and the "Audio file" caption.
/// A quiet "Disc N" heading above the first track row of a disc, shown only when a release has
/// more than one disc. Sentence case and muted, to sit in the same blended panel as the rows.
struct DiscHeading: View {
    let number: Int

    var body: some View {
        Text(Copy.Import.disc(number))
            .themeFont(.meta)
            .foregroundStyle(Theme.secondaryText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
            // It sits in the same `ForEach` as the track rows, so without these a swipe on it would
            // delete, and a lift would move, the track it heads.
            .deleteDisabled(true)
            .moveDisabled(true)
    }
}

// MARK: - Track list silhouette

/// A faint placeholder shown before any tracks exist, so the Tracks section
/// doesn't collapse to a single line of text: `rows` empty track-row-shaped
/// blocks (same size and radius, `card` at 50% opacity, no outline, no
/// text or icon) with a centred blurb explaining what will appear there.
/// Used by the album builder (3 rows) and, while no file is chosen, the
/// single-track flow (1 row) — see `docs/design.md`'s Tracks section notes.
///
/// Spacing between placeholder cards is `2 * rowGap` so the empty state
/// matches the gap between live track rows in a plain list (each row's top
/// and bottom `rowGap` insets sit back to back).
struct TrackListSilhouette: View {
    var rows: Int = 3

    var body: some View {
        ZStack {
            VStack(spacing: Theme.Spacing.rowGap * 2) {
                ForEach(0..<rows, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: Theme.Radius.fileRow)
                        .fill(Theme.card.opacity(0.5))
                        .frame(minHeight: 64)
                }
            }

            VStack(spacing: 4) {
                Text(Copy.Import.noTracksYet)
                Text(Copy.Import.noTracksHint)
            }
            .themeFont(.body)
            .foregroundStyle(Theme.secondaryText)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 24)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(Copy.Import.noTracksYet). \(Copy.Import.noTracksHint)")
        .accessibilityIdentifier("track-list-silhouette")
    }
}

// MARK: - Kind badge

/// Single / Album badge: an `elevated` pill in the badge text style (sentence case).
struct KindBadge: View {
    let text: String

    var body: some View {
        Text(text)
            .themeFont(.badge)
            .foregroundStyle(Theme.secondaryText)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Theme.elevated)
            .clipShape(Capsule())
    }
}

extension View {
    /// The record's section (sleeve and fields), full width on iOS 26. A list cell clips what it
    /// holds, so with the usual 16 pt margin the sleeve's shadow was cut off in a hard vertical
    /// line 16 pt in from the screen edge; now the cut is at the edge itself. Its rows add
    /// `Theme.Immersive.recordRowSideInset`, so nothing moves.
    @ViewBuilder func recordListSection() -> some View {
        // `listSectionMargins` is in the iOS 26 SDK only (Xcode 26, Swift 6.2); CI builds with Xcode 16.
        #if compiler(>=6.2)
        if #available(iOS 26, *) {
            listSectionMargins(.horizontal, 0)
        } else {
            self
        }
        #else
        self
        #endif
    }

    /// A panel section beside the record, at `Theme.Immersive.listSideMargin` on every width.
    @ViewBuilder func panelListSection() -> some View {
        // `listSectionMargins` is in the iOS 26 SDK only (Xcode 26, Swift 6.2); CI builds with Xcode 16.
        #if compiler(>=6.2)
        if #available(iOS 26, *) {
            listSectionMargins(.horizontal, Theme.Immersive.listSideMargin)
        } else {
            self
        }
        #else
        self
        #endif
    }
}

/// An empty last row for a section of clear rows. An inset-grouped list rounds the corners of a
/// section's last cell and clips what that cell holds, which cut the bottom-left off the first
/// letter of the last field (the G of "Genre"). This zero-height row takes the rounding instead.
struct ClearSectionEnd: View {
    var body: some View {
        Color.clear
            .frame(height: 0)
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets())
            .accessibilityHidden(true)
    }
}
