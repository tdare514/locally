import SwiftUI

/// Centralised look for every screen, matching `docs/design.md`. Screens
/// should reach for these instead of ad-hoc `.background`/`.padding`
/// combinations, so a token change here updates the whole app.

// MARK: - Buttons

/// "Import to Spotify" / "Send to Spotify": an `accent` pill with black bold
/// text, full width and 48 tall on mobile (per "Shape and spacing"), or a
/// small non-full-width pill (the crop sheet's "Done"). Press feedback:
/// scale to 0.95. Disabled: 50% opacity.
struct PrimaryPillButtonStyle: ButtonStyle {
    var isFullWidth: Bool = true
    @Environment(\.isEnabled) private var isEnabled
    /// The pill's height at the default text size; it grows with Dynamic Type so the label wraps inside it.
    @ScaledMetric(relativeTo: .body) private var fullMinHeight: CGFloat = 48
    @ScaledMetric(relativeTo: .body) private var compactMinHeight: CGFloat = 36
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .themeFont(.primaryButton)
            .foregroundStyle(Color.black)
            .multilineTextAlignment(.center)
            .padding(.horizontal, isFullWidth ? 0 : Theme.Spacing.primaryButtonH)
            .padding(.vertical, dynamicTypeSize.isAccessibilitySize ? Theme.Spacing.primaryButtonV : 0)
            .frame(maxWidth: isFullWidth ? .infinity : nil)
            .frame(minHeight: isFullWidth ? fullMinHeight : compactMinHeight)
            .background(Theme.accent)
            .clipShape(Capsule())
            .opacity(isEnabled ? 1 : 0.5)
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
    }
}

/// The Mac's `.btn-save.btn-glow` (#159, #205): a clear faked-glass capsule (gradients only, no
/// Material, no blur) with a white label. While pressed, three soft clouds of fluorescent blue
/// light fade in over 0.3 s, clipped by the capsule, and drift slowly back and forth while lit.
/// Reduce Motion: the same opacity fade, no drift and no press scale. `pinnedLit` is for the
/// component gallery: lit, with the drift held at its midpoint.
struct GlowPillButtonStyle: ButtonStyle {
    var pinnedLit: Bool = false
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .body) private var minHeight: CGFloat = Theme.Import.glowMinHeight

    func makeBody(configuration: Configuration) -> some View {
        let lit = pinnedLit || configuration.isPressed
        configuration.label
            .themeFont(.primaryButton)
            .foregroundStyle(Color.white)
            .multilineTextAlignment(.center)
            .padding(.horizontal, Theme.Spacing.primaryButtonH)
            .padding(.vertical, Theme.Spacing.primaryButtonV)
            .frame(minHeight: minHeight)
            .background {
                ZStack {
                    GlowGlass()
                    GlowClouds(lit: lit, drifts: !reduceMotion && !pinnedLit, pinned: pinnedLit || reduceMotion)
                    GlowLabelPool(lit: lit)
                }
                .clipShape(Capsule())
            }
            .overlay { GlowRim() }
            .opacity(isEnabled ? 1 : 0.5)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.95 : 1)
    }
}

/// The cover glow button (docs/design.md "Cover glow button"): Send to Spotify and Save changes.
/// The Glow pill's glass and rim with a white label, two soft clouds of the cover's colours
/// rising from the lower edge and a halo of the first colour under it. Pressed: the clouds
/// brighten, one shimmer sweeps across, scale 0.97. Reduce Motion: the brighten only. Disabled:
/// glass and rim, a half-opacity label. `pinnedPressed` is for the component gallery.
struct CoverGlowButtonStyle: ButtonStyle {
    let colors: [Color]
    var isFullWidth: Bool = true
    var pinnedPressed: Bool = false
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var fullMinHeight: CGFloat = 52
    @ScaledMetric(relativeTo: .body) private var compactMinHeight: CGFloat = 40

    private var ease: Animation { .timingCurve(0.16, 1, 0.3, 1, duration: 0.45) }

    func makeBody(configuration: Configuration) -> some View {
        let pressed = pinnedPressed || configuration.isPressed
        let first = colors.first ?? Theme.accent
        let second = colors.count > 1 ? colors[1] : first
        configuration.label
            .themeFont(.primaryButton)
            .foregroundStyle(Color.white)
            .multilineTextAlignment(.center)
            .opacity(isEnabled ? 1 : 0.5)
            .padding(.horizontal, Theme.Spacing.primaryButtonH)
            .padding(.vertical, Theme.Spacing.primaryButtonV)
            .frame(maxWidth: isFullWidth ? .infinity : nil, minHeight: isFullWidth ? fullMinHeight : compactMinHeight)
            .background {
                ZStack {
                    if isEnabled {
                        // The halo's shape: glass alone is too clear to cast a shadow.
                        Capsule()
                            .fill(first.opacity(0.2))
                            .shadow(color: first.opacity(0.45), radius: 14, y: 4)
                    }
                    ZStack {
                        // A dark base under the glass, so the list scrolling beneath the footer
                        // never shows through the button.
                        Theme.background.opacity(Theme.Import.coverGlowBaseOpacity)
                        GlowGlass()
                        if isEnabled {
                            CoverGlowClouds(first: first, second: second, bright: pressed, restOpacity: dynamicTypeSize.isAccessibilitySize ? Theme.Import.coverGlowRestAccessibility : Theme.Import.coverGlowRest)
                            CoverGlowShimmer(pressed: pressed, pinned: pinnedPressed, enabled: !reduceMotion)
                            GlowLabelPool(lit: true)
                        }
                    }
                    .clipShape(Capsule())
                }
                .animation(ease, value: pressed)
            }
            .overlay { GlowRim() }
            .scaleEffect(pressed && !reduceMotion ? 0.97 : 1)
            .animation(ease, value: pressed)
    }
}

/// Two soft blurred ellipses rising from the capsule's lower edge, lit at rest and brighter pressed.
private struct CoverGlowClouds: View {
    let first: Color
    let second: Color
    let bright: Bool
    let restOpacity: Double

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            ZStack {
                Ellipse().fill(first)
                    .frame(width: w * 0.62, height: h * 1.3)
                    .position(x: w * 0.3, y: h * 1.0)
                Ellipse().fill(second)
                    .frame(width: w * 0.62, height: h * 1.3)
                    .position(x: w * 0.7, y: h * 1.0)
            }
            .blur(radius: 16)
            .opacity(bright ? Theme.Import.coverGlowPressed : restOpacity)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// One soft white diagonal band that sweeps left to right over 0.6 s each time `pressed` turns
/// on, and is off screen the rest of the time. Only its offset animates. Held at the middle
/// when `pinned`.
private struct CoverGlowShimmer: View {
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

/// The pill at rest: the phone-tray glass's body, a top-to-bottom fill and a corner highlight.
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
            } else {
                Capsule().strokeBorder(gradient, lineWidth: 1)
            }
        }
        .allowsHitTesting(false)
    }
}

/// A round 44 pt button in the Glow pill's glass and rim (the Stats stepper's chevrons). Half opacity disabled.
struct GlowCircleButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Color.white)
            .frame(width: Theme.Import.kindSwitchMinTarget, height: Theme.Import.kindSwitchMinTarget)
            .background { GlowGlass().clipShape(Circle()) }
            .overlay { GlowRim(round: true) }
            .contentShape(Circle())
            .opacity(isEnabled ? 1 : 0.5)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.95 : 1)
    }
}

/// A soft dark pool between the light and the label, only while lit, so the white label keeps
/// its contrast over the bright clouds wherever they drift. A feathered ellipse, no edge.
struct GlowLabelPool: View {
    let lit: Bool

    var body: some View {
        GeometryReader { geo in
            RadialGradient(
                stops: [
                    .init(color: .black.opacity(Theme.Import.glowPoolOpacity), location: 0),
                    .init(color: .black.opacity(Theme.Import.glowPoolOpacity), location: Theme.Import.glowPoolCoreAt),
                    .init(color: .black.opacity(Theme.Import.glowPoolOpacity * 0.45), location: Theme.Import.glowPoolMidAt),
                    .init(color: .black.opacity(0), location: 1),
                ],
                center: .center,
                startRadius: 0,
                endRadius: geo.size.width * Theme.Import.glowPoolRadius
            )
            // Taller than the pill before the squash, so the gradient's rectangle never shows.
            .frame(width: geo.size.width * 2, height: geo.size.height * 2 / Theme.Import.glowPoolSquash)
            .scaleEffect(x: 1, y: Theme.Import.glowPoolSquash, anchor: .center)
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .opacity(lit ? 1 : 0)
        .animation(.easeOut(duration: Theme.Import.glowFadeDuration), value: lit)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The light: three feathered clouds over a thin wash on a layer far larger than the pill (its
/// middle shows), faded with `lit` and drifting (translate and scale, back and forth) only while lit.
private struct GlowClouds: View {
    let lit: Bool
    /// The drift runs; false holds it still.
    let drifts: Bool
    /// Held at the drift's midpoint (the gallery, and Reduce Motion).
    let pinned: Bool

    var body: some View {
        GeometryReader { geo in
            let layer = CGSize(width: geo.size.width * (1 + 2 * Theme.Import.glowInsetX),
                               height: geo.size.height * (1 + 2 * Theme.Import.glowInsetY))
            TimelineView(.animation(minimumInterval: nil, paused: !(lit && drifts))) { timeline in
                let eased = pinned ? 0.5 : Self.drift(at: timeline.date.timeIntervalSinceReferenceDate)
                cloudLayer(layer)
                    .scaleEffect(1 + Theme.Import.glowDriftScale * eased)
                    .offset(x: layer.width * Theme.Import.glowDriftX * (2 * eased - 1),
                            y: layer.height * Theme.Import.glowDriftY * (2 * eased - 1))
                    .frame(width: layer.width, height: layer.height)
                    .position(x: geo.size.width / 2, y: geo.size.height / 2)
            }
        }
        .opacity(lit ? 1 : 0)
        .animation(.easeOut(duration: Theme.Import.glowFadeDuration), value: lit)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// 0 to 1 and back every 2 x `glowDriftDuration`, ease-in-out (`animation: ... alternate`).
    private static func drift(at seconds: TimeInterval) -> Double {
        let cycle = Theme.Import.glowDriftDuration * 2
        var u = seconds.truncatingRemainder(dividingBy: cycle) / Theme.Import.glowDriftDuration
        if u > 1 { u = 2 - u }
        return UnitCurve.easeInOut.value(at: u)
    }

    private func cloudLayer(_ size: CGSize) -> some View {
        ZStack {
            Theme.Import.glowWash
            cloud(Theme.Import.glowAzure, alphas: (0.95, 0.62, 0.24), stops: (0.28, 0.62),
                  radii: (0.40, 0.70), at: (0.36, 0.56), in: size)
            cloud(Theme.Import.glowIce, alphas: (0.9, 0.55, 0.2), stops: (0.30, 0.64),
                  radii: (0.34, 0.62), at: (0.58, 0.36), in: size)
            cloud(Theme.Import.glowCobalt, alphas: (0.92, 0.58, 0.2), stops: (0.30, 0.64),
                  radii: (0.38, 0.68), at: (0.70, 0.64), in: size)
        }
        .frame(width: size.width, height: size.height)
    }

    /// `radial-gradient(rx ry at cx cy, c a0 0%, c a1 s0, c a2 s1, transparent 100%)`: a circle
    /// of radius rx squashed to an ellipse, so it stays a gradient and needs no mask.
    private func cloud(_ c: (r: Double, g: Double, b: Double), alphas: (Double, Double, Double),
                       stops: (Double, Double), radii: (Double, Double), at centre: (Double, Double),
                       in size: CGSize) -> some View {
        let color = { (a: Double) in Color(red: c.r / 255, green: c.g / 255, blue: c.b / 255).opacity(a) }
        let rx = size.width * radii.0
        let ry = size.height * radii.1
        return Rectangle()
            .fill(RadialGradient(
                stops: [
                    .init(color: color(alphas.0), location: 0),
                    .init(color: color(alphas.1), location: stops.0),
                    .init(color: color(alphas.2), location: stops.1),
                    .init(color: color(0), location: 1),
                ],
                center: .center,
                startRadius: 0,
                endRadius: rx
            ))
            .frame(width: rx * 2, height: rx * 2)
            .scaleEffect(x: 1, y: ry / rx)
            .position(x: size.width * centre.0, y: size.height * centre.1)
    }
}

/// "Settings" / "Show in Finder"-style secondary actions: an `elevated`
/// pill with a `text` (or `danger`, for destructive actions) label.
struct SecondaryPillButtonStyle: ButtonStyle {
    var isDestructive: Bool = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .themeFont(.body, weight: .medium)
            .foregroundStyle(isDestructive ? Theme.danger : Theme.primaryText)
            .padding(.horizontal, Theme.Spacing.primaryButtonH)
            .padding(.vertical, Theme.Spacing.primaryButtonV)
            .background(Theme.elevated)
            .clipShape(Capsule())
            .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.5)
    }
}

/// "Cancel" / "Delete": no background, just coloured text that lightens to
/// white on press. `color` defaults to `text-muted`; pass `Theme.danger` for
/// a destructive text button (e.g. release detail's "Delete").
struct TextButtonStyle: ButtonStyle {
    var color: Color = Theme.secondaryText
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .themeFont(.body, weight: .semibold)
            .foregroundStyle(configuration.isPressed ? Theme.primaryText : color)
            .opacity(isEnabled ? 1 : 0.5)
    }
}

// MARK: - Fields

/// `elevated` background, radius 6, a 1 pt `border` always, plus a 2 pt
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

    /// The section-eyebrow text style (e.g. "YOUR COLLECTION"): 11 pt bold
    /// uppercase, wide tracking, `accent` colour.
    func eyebrow() -> some View {
        themeFont(.eyebrow)
            .tracking(11 * 0.18)
            .textCase(.uppercase)
            .foregroundStyle(Theme.accent)
    }

    /// The field-label text style (e.g. "TITLE"): 11 pt bold uppercase, wide
    /// tracking, muted colour.
    func fieldLabelStyle() -> some View {
        themeFont(.fieldLabel)
            .tracking(11 * 0.14)
            .textCase(.uppercase)
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

/// SINGLE / ALBUM badge: an `elevated` pill in the badge text style.
struct KindBadge: View {
    let text: String

    var body: some View {
        Text(text)
            .themeFont(.badge)
            .tracking(1.0)
            .textCase(.uppercase)
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
