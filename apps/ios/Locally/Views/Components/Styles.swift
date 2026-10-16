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

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.Font.primaryButton)
            .foregroundStyle(Color.black)
            .padding(.horizontal, isFullWidth ? 0 : Theme.Spacing.primaryButtonH)
            .frame(maxWidth: isFullWidth ? .infinity : nil)
            .frame(height: isFullWidth ? 48 : 36)
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
    @ScaledMetric(relativeTo: .body) private var fontSize: CGFloat = 15
    @ScaledMetric(relativeTo: .body) private var minHeight: CGFloat = Theme.Import.glowMinHeight

    func makeBody(configuration: Configuration) -> some View {
        let lit = pinnedLit || configuration.isPressed
        configuration.label
            .font(.system(size: fontSize, weight: .bold))
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

/// The pill at rest: the phone-tray glass's body, a top-to-bottom fill and a corner highlight.
private struct GlowGlass: View {
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

/// A 1 pt rim at 12 % white, brighter (32 %) along the top edge.
private struct GlowRim: View {
    var body: some View {
        Capsule()
            .strokeBorder(
                LinearGradient(
                    stops: [
                        .init(color: .white.opacity(Theme.Import.glowRimTop), location: 0),
                        .init(color: .white.opacity(Theme.Import.glowRim), location: 0.4),
                        .init(color: .white.opacity(Theme.Import.glowRim), location: 1),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                ),
                lineWidth: 1
            )
            .allowsHitTesting(false)
    }
}

/// A soft dark pool between the light and the label, only while lit, so the white label keeps
/// its contrast over the bright clouds wherever they drift. A feathered ellipse, no edge.
private struct GlowLabelPool: View {
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
            .font(Theme.Font.body.weight(.medium))
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
            .font(Theme.Font.body.weight(.semibold))
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
            .font(Theme.Font.input)
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
        font(Theme.Font.eyebrow)
            .tracking(11 * 0.18)
            .textCase(.uppercase)
            .foregroundStyle(Theme.accent)
    }

    /// The field-label text style (e.g. "TITLE"): 11 pt bold uppercase, wide
    /// tracking, muted colour.
    func fieldLabelStyle() -> some View {
        font(Theme.Font.fieldLabel)
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
            .font(Theme.Font.meta)
            .foregroundStyle(Theme.secondaryText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
            // It sits in the same `ForEach` as the track rows, so without these a swipe on it would
            // delete, and a lift would move, the track it heads.
            .deleteDisabled(true)
            .moveDisabled(true)
    }
}

struct FileRow: View {
    let index: Int
    let title: String
    var isEditable: Bool = false
    /// A denser variant (52 pt min height, 30 pt tile) used by the release
    /// detail's compact Tracks section; the default 64 pt / 36 pt sizing is
    /// unchanged for the album builder.
    var isCompact: Bool = false
    /// The compact row's trailing chevron; off where a tap does nothing (the import single).
    var showsChevron: Bool = true
    var onTitleChange: (String) -> Void = { _ in }

    var body: some View {
        HStack(spacing: 12) {
            Text("\(index)")
                .font(Theme.Font.rowSubtitle)
                .foregroundStyle(Theme.textDim)
                .frame(width: 16, alignment: .trailing)

            ZStack {
                RoundedRectangle(cornerRadius: Theme.Radius.thumbnail)
                    .fill(Theme.elevated)
                Image(systemName: "music.note")
                    .foregroundStyle(Theme.accent)
            }
            .frame(width: isCompact ? 30 : 36, height: isCompact ? 30 : 36)

            VStack(alignment: .leading, spacing: 2) {
                if isEditable {
                    TextField(
                        Copy.Import.track,
                        text: Binding(get: { title }, set: onTitleChange)
                    )
                    .font(Theme.Font.rowTitle)
                    .foregroundStyle(Theme.primaryText)
                } else {
                    Text(title)
                        .font(Theme.Font.rowTitle)
                        .foregroundStyle(Theme.primaryText)
                        .lineLimit(1)
                }
                Text(Copy.Import.audioFile)
                    .font(Theme.Font.rowSubtitle)
                    .foregroundStyle(Theme.secondaryText)
            }

            Spacer(minLength: 0)

            // Compact release-detail rows carry the trailing chevron from
            // `docs/design.md`'s Mobile Editor Tracks section.
            if isCompact && showsChevron {
                Image(systemName: "chevron.right")
                    .font(Theme.Font.chevron)
                    .foregroundStyle(Theme.textDim)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 12)
        .frame(minHeight: isCompact ? 52 : 64)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.fileRow))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.fileRow)
                .stroke(Theme.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("file-row-\(index)")
    }
}

// MARK: - Track list silhouette

/// A faint placeholder shown before any tracks exist, so the Tracks section
/// doesn't collapse to a single line of text: `rows` empty `FileRow`-shaped
/// blocks (same size and radius, `card` at 50% opacity, a `border` stroke, no
/// text or icon) with a centred blurb explaining what will appear there.
/// Used by the album builder (3 rows) and, while no file is chosen, the
/// single-track flow (1 row) — see `docs/design.md`'s Tracks section notes.
///
/// Spacing between placeholder cards is `2 * rowGap` so the empty state
/// matches the gap between live `FileRow`s in a plain list (each row's top
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
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.Radius.fileRow)
                                .stroke(Theme.border, lineWidth: 1)
                        )
                }
            }

            VStack(spacing: 4) {
                Text(Copy.Import.noTracksYet)
                Text(Copy.Import.noTracksHint)
            }
            .font(Theme.Font.body)
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
            .font(Theme.Font.badge)
            .tracking(1.0)
            .textCase(.uppercase)
            .foregroundStyle(Theme.secondaryText)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Theme.elevated)
            .clipShape(Capsule())
    }
}
