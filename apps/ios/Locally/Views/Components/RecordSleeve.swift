import SwiftUI
import UIKit

/// A fixed disc pose, so a mid-ceremony frame can be drawn deterministically (previews,
/// screenshots). `tuck` runs 0 (resting) to 1 (fully tucked, 42% of the disc width into the
/// sleeve); `rotationDegrees` is the disc's turn.
struct CeremonyPose: Equatable {
    var tuck: Double
    var rotationDegrees: Double

    static let halfTucked = CeremonyPose(tuck: 0.5, rotationDegrees: 120)
}

/// The cover as a printed sleeve with a vinyl disc peeking out to the right, ported from the
/// web's `RecordSleeve` and `.record-*` CSS. The whole sleeve is a button: it calls
/// `onAddCover` whether or not there is a cover yet. The disc is decoration only.
///
/// Every new `ceremony` value tucks the disc into the sleeve and brings it back out spinning
/// over `Theme.Immersive.ceremonyDuration`; it is driven by time alone, never by a save.
/// With Reduce Motion on, the ceremony does nothing and a new cover is a short opacity change.
struct RecordSleeve: View {
    let cover: UIImage?
    let onAddCover: () -> Void
    var ceremony: Int = 0
    /// When set, the disc is drawn static in this pose and the ceremony never runs.
    var pose: CeremonyPose?
    /// When set (Make a record, #205), the cover beat's frame is drawn as given: the cover at its
    /// offset and opacity with no transition of its own, the flash over the sleeve and the disc
    /// static at `discIn` (the iPhone beat keeps it at 0, peeking). The ceremony and the cover fade are off.
    var beat: ImportBeat.Frame?
    /// When set, the sleeve's side in points, in place of the size class's (the Sent card's 96).
    var size: CGFloat?
    /// Whether an empty sleeve says "Add cover art". Off on the release page in view mode, where
    /// the sleeve isn't a button and the words would promise a tap that does nothing.
    var showsAddCaption = true

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(cover: UIImage?, ceremony: Int = 0, pose: CeremonyPose? = nil, beat: ImportBeat.Frame? = nil, size: CGFloat? = nil, showsAddCaption: Bool = true, onAddCover: @escaping () -> Void) {
        self.cover = cover
        self.showsAddCaption = showsAddCaption
        self.ceremony = ceremony
        self.pose = pose
        self.beat = beat
        self.size = size
        self.onAddCover = onAddCover
    }

    private struct CeremonyValues {
        var tuck = 0.0
        var rotation = 0.0
    }

    private var sleeveSize: CGFloat {
        if let size { return size }
        return horizontalSizeClass == .compact ? Theme.Immersive.sleeveSizeCompact : Theme.Immersive.sleeveSizeRegular
    }

    var body: some View {
        let sleeve = sleeveSize
        let disc = sleeve * Theme.Immersive.discToSleeveRatio
        let peek = disc * Theme.Immersive.discPeekRatio
        ZStack(alignment: .leading) {
            animatedDisc(size: disc)
                .offset(x: sleeve + peek - disc - CGFloat(beat?.discIn ?? 0) * peek)
                .accessibilityHidden(true)
            sleeveButton(size: sleeve)
        }
        .frame(width: sleeve + peek, height: sleeve, alignment: .leading)
    }

    // MARK: Disc

    @ViewBuilder
    private func animatedDisc(size: CGFloat) -> some View {
        if let beat {
            RecordDisc(cover: cover, size: size, rotationDegrees: beat.discTurnDegrees)
        } else if let pose {
            RecordDisc(cover: cover, size: size, tuck: pose.tuck, rotationDegrees: pose.rotationDegrees)
        } else if reduceMotion {
            RecordDisc(cover: cover, size: size, tuck: 0, rotationDegrees: 0)
        } else {
            RecordDisc(cover: cover, size: size, tuck: 0, rotationDegrees: 0)
                .keyframeAnimator(initialValue: CeremonyValues(), trigger: ceremony) { _, values in
                    RecordDisc(cover: cover, size: size, tuck: values.tuck, rotationDegrees: values.rotation)
                } keyframes: { _ in
                    let total = Theme.Immersive.ceremonyDuration
                    KeyframeTrack(\.tuck) {
                        CubicKeyframe(1, duration: Theme.Immersive.ceremonyTuckDuration)
                        CubicKeyframe(0, duration: total - Theme.Immersive.ceremonyTuckDuration)
                    }
                    KeyframeTrack(\.rotation) {
                        LinearKeyframe(0, duration: Theme.Immersive.ceremonySpinDelay)
                        CubicKeyframe(Theme.Immersive.ceremonySpinDegrees, duration: total - Theme.Immersive.ceremonySpinDelay)
                    }
                }
        }
    }

    // MARK: Sleeve

    private func sleeveButton(size: CGFloat) -> some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Immersive.sleeveCornerRadius, style: .continuous)
        let coverID = cover.map { ObjectIdentifier($0) }
        return Button(action: onAddCover) {
            ZStack {
                // The card is the empty sleeve only. Under a cover it showed as a rim while a new
                // cover scaled in from 0.96 (#158); with a cover, the wash shows at the edges instead.
                if cover == nil {
                    Theme.card.transition(.opacity)
                }
                if let cover {
                    Image(uiImage: cover)
                        .resizable()
                        .scaledToFill()
                        .frame(width: size, height: size)
                        .clipped()
                        .offset(x: CGFloat(beat?.coverOffsetX ?? 0))
                        .opacity(beat?.coverOpacity ?? 1)
                        .id(ObjectIdentifier(cover))
                        .transition(coverTransition)
                } else if showsAddCaption {
                    Text(Copy.Immersive.addCoverArt)
                        .font(Theme.Font.rowTitle)
                        .foregroundStyle(Theme.secondaryText)
                        .multilineTextAlignment(.center)
                        .padding(Theme.Immersive.sleeveCaptionPadding)
                        .transition(.opacity)
                }
                shape
                    .fill(LinearGradient(
                        stops: [
                            .init(color: .white.opacity(Theme.Immersive.sleeveSheenOpacity), location: 0),
                            .init(color: .clear, location: Theme.Immersive.sleeveSheenEnd),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ))
            }
            .frame(width: size, height: size)
            .clipShape(shape)
            .animation(beat == nil ? coverAnimation : nil, value: coverID)
        }
        .buttonStyle(.plain)
        .shadow(color: .black.opacity(Theme.Immersive.sleeveShadowFarOpacity),
                radius: Theme.Immersive.sleeveShadowFarRadius, y: Theme.Immersive.sleeveShadowFarY)
        .shadow(color: .black.opacity(Theme.Immersive.sleeveShadowNearOpacity),
                radius: Theme.Immersive.sleeveShadowNearRadius, y: Theme.Immersive.sleeveShadowNearY)
        .accessibilityLabel(cover == nil ? Copy.Immersive.addCoverArt : Copy.Immersive.changeCoverArt)
        .overlay { flash(shape: shape) }
    }

    /// The beat's warm-white flash: over the sleeve and clipped to its shape (the fill is the
    /// shape), with the faint spill as a shadow past the edge. Opacity only.
    @ViewBuilder
    private func flash(shape: RoundedRectangle) -> some View {
        if let beat, beat.flashOpacity > 0 {
            shape
                .fill(RadialGradient(
                    colors: [Theme.Import.flashCenter, Theme.Import.flashEdge],
                    center: .center,
                    startRadius: 0,
                    endRadius: sleeveSize * 0.7071
                ))
                .shadow(color: Theme.Import.flashEdge.opacity(Theme.Import.spillOpacity), radius: Theme.Import.spillRadius)
                .opacity(beat.flashOpacity)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    private var coverTransition: AnyTransition {
        if beat != nil { return .identity }
        return reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: Theme.Immersive.coverFadeScale))
    }

    private var coverAnimation: Animation {
        reduceMotion
            ? .easeInOut(duration: Theme.Immersive.reducedMotionFadeDuration)
            : .timingCurve(0.2, 0.8, 0.2, 1, duration: Theme.Immersive.coverFadeDuration)
    }
}

// MARK: - Disc

/// The vinyl: dark face with grooves, the cover on the centre label, and a fixed sheen.
/// With no cover the label is the accent house label. Also the invitation's bare disc.
struct RecordDisc: View {
    let cover: UIImage?
    let size: CGFloat
    var tuck: Double = 0
    var rotationDegrees: Double = 0

    var body: some View {
        let label = size * Theme.Immersive.labelToDiscRatio
        ZStack {
            ZStack {
                Circle().fill(Theme.Immersive.discColor)
                Grooves(innerRatio: Theme.Immersive.labelToDiscRatio / 2)
                Circle()
                    .strokeBorder(.black.opacity(Theme.Immersive.discRingOpacity), lineWidth: Theme.Immersive.discRingWidth)
                    .frame(width: size * Theme.Immersive.discRingRadiusRatio, height: size * Theme.Immersive.discRingRadiusRatio)
                Circle()
                    .strokeBorder(.white.opacity(Theme.Immersive.discEdgeOpacity), lineWidth: 1)
                labelView(diameter: label)
            }
            .rotationEffect(.degrees(rotationDegrees))
            sheen
        }
        .frame(width: size, height: size)
        .shadow(color: .black.opacity(Theme.Immersive.discShadowOpacity),
                radius: Theme.Immersive.discShadowRadius, y: Theme.Immersive.discShadowY)
        .offset(x: -CGFloat(tuck) * Theme.Immersive.ceremonyTuckFraction * size)
    }

    private func labelView(diameter: CGFloat) -> some View {
        ZStack {
            Circle().fill(Theme.accent)
            if let cover {
                Image(uiImage: cover)
                    .resizable()
                    .scaledToFill()
                    .frame(width: diameter, height: diameter)
                    .clipShape(Circle())
            }
            Circle()
                .fill(Theme.background)
                .frame(width: diameter * Theme.Immersive.spindleToLabelRatio,
                       height: diameter * Theme.Immersive.spindleToLabelRatio)
        }
        .frame(width: diameter, height: diameter)
        .overlay(
            Circle()
                .stroke(.black.opacity(Theme.Immersive.labelRingOpacity), lineWidth: Theme.Immersive.labelRingWidth)
                .padding(-Theme.Immersive.labelRingWidth / 2)
        )
    }

    /// Light catching the grooves; it stays put while the disc turns.
    private var sheen: some View {
        Circle()
            .fill(AngularGradient(
                stops: [
                    .init(color: .clear, location: 0),
                    .init(color: .clear, location: 0.08),
                    .init(color: .white.opacity(Theme.Immersive.sheenOpacityNear), location: 0.13),
                    .init(color: .clear, location: 0.20),
                    .init(color: .clear, location: 0.52),
                    .init(color: .white.opacity(Theme.Immersive.sheenOpacityFar), location: 0.62),
                    .init(color: .clear, location: 0.70),
                    .init(color: .clear, location: 1),
                ],
                center: .center,
                // SwiftUI starts at 3 o'clock, CSS at 12 o'clock.
                angle: .degrees(Theme.Immersive.sheenStartDegrees - 90)
            ))
            .mask {
                Circle().fill(.black)
                    .overlay(
                        GeometryReader { geo in
                            Circle()
                                .frame(width: geo.size.width * Theme.Immersive.sheenInnerRatio * 2,
                                       height: geo.size.height * Theme.Immersive.sheenInnerRatio * 2)
                                .position(x: geo.size.width / 2, y: geo.size.height / 2)
                                .blendMode(.destinationOut)
                        }
                    )
                    .compositingGroup()
            }
            .allowsHitTesting(false)
    }
}

/// `repeating-radial-gradient(... 1px line every 3px)`, drawn once as concentric hairlines.
private struct Grooves: View {
    /// Where the grooves start, as a share of the disc diameter (the label's radius).
    let innerRatio: CGFloat

    var body: some View {
        Canvas { context, size in
            let outer = min(size.width, size.height) / 2
            var radius = outer * innerRatio * 2
            while radius < outer {
                let rect = CGRect(x: size.width / 2 - radius, y: size.height / 2 - radius,
                                  width: radius * 2, height: radius * 2)
                context.stroke(Path(ellipseIn: rect),
                               with: .color(.white.opacity(Theme.Immersive.grooveOpacity)),
                               lineWidth: Theme.Immersive.grooveWidth)
                radius += Theme.Immersive.grooveSpacing
            }
        }
    }
}

#if DEBUG
/// A generated gradient cover, so previews and the gallery need no bundled photos.
enum SampleArtwork {
    static func cover(_ colors: [UIColor], size: CGFloat = 400) -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
        return renderer.image { ctx in
            let space = CGColorSpaceCreateDeviceRGB()
            let gradient = CGGradient(colorsSpace: space, colors: colors.map(\.cgColor) as CFArray, locations: nil)!
            ctx.cgContext.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: size, y: size), options: [])
            ctx.cgContext.setFillColor(UIColor.white.withAlphaComponent(0.85).cgColor)
            ctx.cgContext.fillEllipse(in: CGRect(x: size * 0.3, y: size * 0.3, width: size * 0.4, height: size * 0.4))
        }
    }

    static let sunset = cover([.systemPurple, .systemPink, .systemOrange])
    static let ocean = cover([.systemTeal, .systemBlue, .systemIndigo])
    /// Edge cases for the sleeve's rim: a near-white cover and a near-black one.
    static let bright = cover([
        UIColor(red: 1, green: 0.95, blue: 0.70, alpha: 1),
        UIColor(red: 1, green: 1, blue: 1, alpha: 1),
        UIColor(red: 1, green: 0.85, blue: 0.70, alpha: 1),
    ])
    static let dark = cover([
        UIColor(red: 0.05, green: 0.06, blue: 0.12, alpha: 1),
        UIColor(red: 0.09, green: 0.11, blue: 0.20, alpha: 1),
        UIColor(red: 0.02, green: 0.02, blue: 0.05, alpha: 1),
    ])
}

private struct CeremonyPreview: View {
    @State private var count = 0
    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            VStack(spacing: 40) {
                RecordSleeve(cover: SampleArtwork.sunset, ceremony: count, onAddCover: {})
                Button("Run ceremony") { count += 1 }
            }
        }
    }
}

#Preview("Filled") {
    ZStack {
        Theme.background.ignoresSafeArea()
        RecordSleeve(cover: SampleArtwork.sunset, onAddCover: {})
    }
}

#Preview("Empty") {
    ZStack {
        Theme.background.ignoresSafeArea()
        RecordSleeve(cover: nil, onAddCover: {})
    }
}

#Preview("Mid-ceremony") {
    ZStack {
        Theme.background.ignoresSafeArea()
        RecordSleeve(cover: SampleArtwork.sunset, pose: .halfTucked, onAddCover: {})
    }
}

#Preview("Ceremony button") {
    CeremonyPreview()
}
#endif
