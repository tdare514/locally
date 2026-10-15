import SwiftUI

/// "Make a record" before any track is added (#205), on the studio backdrop: an accent band
/// sweeps across the screen once, then a bare disc, the Add a track button and its hint fade in
/// and rise a little. It plays each time it appears. With Reduce Motion there is no band and the
/// content fades in over 0.16 s. It scrolls when large text makes it taller than the screen, and
/// is centred when it fits.
struct ImportInvitation: View {
    let onAddTrack: () -> Void
    /// The component gallery holds the button lit.
    var pinnedLit: Bool = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false
    @State private var sweepStart: Date?
    /// The sweep and the fade are over: the band's clock is gone until the next appear.
    @State private var settled = false
    @State private var settleTask: Task<Void, Never>?

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                content
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: geo.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
            .overlay { band.ignoresSafeArea() }
        }
        .onAppear(perform: play)
        .onDisappear { settleTask?.cancel() }
    }

    private var content: some View {
        VStack(spacing: Theme.Import.inviteGap) {
            RecordDisc(cover: nil, size: Theme.Import.inviteDiscSize)
                .accessibilityHidden(true)
            VStack(spacing: Theme.Import.inviteButtonGap) {
                Button(action: onAddTrack) {
                    Text(Copy.Import.addTrack)
                }
                .buttonStyle(GlowPillButtonStyle(pinnedLit: pinnedLit))
                Text(Copy.Import.addTrackHint)
                    .font(Theme.ScaledFont.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(Theme.Spacing.pagePadding)
        .opacity(shown ? 1 : 0)
        .offset(y: shown || reduceMotion ? 0 : Theme.Import.inviteRise)
    }

    @ViewBuilder
    private var band: some View {
        if !reduceMotion, !settled, let sweepStart {
            TimelineView(.animation(minimumInterval: nil, paused: false)) { timeline in
                let t = timeline.date.timeIntervalSince(sweepStart) / Theme.Import.washSweepDuration
                if t < 1 {
                    WashBand(progress: max(0, t))
                }
            }
            .clipped()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    /// Resets, then fades the content in after the band (or at once with Reduce Motion).
    private func play() {
        shown = false
        sweepStart = nil
        settled = false
        settleTask?.cancel()
        DispatchQueue.main.async {
            if reduceMotion {
                withAnimation(.linear(duration: Theme.Import.reducedFadeDuration)) { shown = true }
            } else {
                sweepStart = Date()
                let done = max(Theme.Import.washSweepDuration, Theme.Import.inviteFadeDelay + Theme.Import.inviteFadeDuration)
                    + Theme.Import.inviteSettleMargin
                settleTask = Task { @MainActor in
                    try? await Task.sleep(for: .seconds(done))
                    if !Task.isCancelled { settled = true }
                }
                withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: Theme.Import.inviteFadeDuration)
                    .delay(Theme.Import.inviteFadeDelay)) { shown = true }
            }
        }
    }
}

/// The accent band at one point (0 to 1) of its 0.7 s sweep: translate on `timingCurve(0.16, 1,
/// 0.3, 1)`, opacity linear 0, 1 at 12 %, 0.85 at 55 %, 0.
struct WashBand: View {
    var progress: Double

    private static let sweepCurve = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.16, y: 1), endControlPoint: UnitPoint(x: 0.3, y: 1))

    static func opacity(at p: Double) -> Double {
        let peak = Theme.Import.washPeakAt, hold = Theme.Import.washHoldAt
        if p <= 0 { return 0 }
        if p < peak { return p / peak }
        if p < hold { return 1 - (1 - Theme.Import.washHoldOpacity) * (p - peak) / (hold - peak) }
        if p < 1 { return Theme.Import.washHoldOpacity * (1 - (p - hold) / (1 - hold)) }
        return 0
    }

    static func offsetFraction(at p: Double) -> Double {
        let eased = sweepCurve.value(at: min(max(p, 0), 1))
        return Theme.Import.washStartX + (Theme.Import.washEndX - Theme.Import.washStartX) * eased
    }

    var body: some View {
        GeometryReader { geo in
            let bandWidth = geo.size.width * Theme.Import.washWidthRatio
            let skew = CGFloat(tan(-Theme.Import.washSkewDegrees * .pi / 180))
            LinearGradient(
                stops: [
                    .init(color: .clear, location: 0),
                    .init(color: Theme.Import.washEarly, location: Theme.Import.washEarlyAt),
                    .init(color: Theme.Import.washMid, location: Theme.Import.washMidAt),
                    .init(color: Theme.Import.washGlint, location: Theme.Import.washGlintAt),
                    .init(color: .clear, location: 1),
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
            .frame(width: bandWidth, height: geo.size.height)
            // Skew about the band's centre, as CSS does, then slide.
            .transformEffect(CGAffineTransform(a: 1, b: 0, c: skew, d: 1, tx: -skew * geo.size.height / 2, ty: 0))
            .offset(x: bandWidth * Self.offsetFraction(at: progress))
            .opacity(Self.opacity(at: progress))
        }
    }
}

#if DEBUG
#Preview("Invitation") {
    ZStack {
        StudioBackdrop()
        ImportInvitation(onAddTrack: {})
    }
    .preferredColorScheme(.dark)
}
#endif
