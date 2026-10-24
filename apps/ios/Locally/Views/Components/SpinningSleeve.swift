import SwiftUI

/// The side that fits `availableWidth` with the disc's peek, keeping the cover-to-disc ratio.
enum SpinningSleeveFit {
    static func fittedSide(_ side: CGFloat, availableWidth: CGFloat) -> CGFloat {
        guard availableWidth.isFinite, availableWidth > 0 else { return side }
        return min(side, availableWidth / (1 + Theme.Immersive.discToSleeveRatio * Theme.Immersive.discPeekRatio))
    }
}

/// A record sleeve with the vinyl peeking out to its right that is also the play control (#369, shared with the song
/// page, #365). A tap calls `onPress`, acknowledged by one soft sweep of light (a short brightening under Reduce
/// Motion) and a light tap, with no glyph on the cover. The disc turns only while `isPlaying`, and holds its angle on
/// pause (`RecordSpin`, as the record player does). It turns only while `WheelMotion.isAnimated`: the scene is active,
/// the screen is showing, the phone is not in Low Power Mode, the sleeve is in view and Reduce Motion is off.
/// An inert sleeve (nothing here to play) is dimmed to 0.45 and does nothing; in edit mode it is plain art.
struct SpinningSleeve<Art: View>: View {
    /// The sleeve's side; the default shrinks to fit a narrow row when `fitsWidth`.
    var side: CGFloat
    /// The cover that sits on the disc's label.
    var discCover: UIImage?
    var isPlaying: Bool
    var isInert = false
    var isEditing = false
    /// Whether the sleeve shrinks to a narrow row; the record player's small one stays fixed.
    var fitsWidth = true
    /// What VoiceOver says and what the control will do.
    var label: String
    var hint: String
    var onPress: () -> Void
    /// The cover art at the side it is drawn at.
    @ViewBuilder var art: (CGFloat) -> Art

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var accumulated = 0.0
    @State private var startedAt: Date?
    @State private var isScreenShowing = true
    @State private var isLowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled
    /// Counts accepted taps: the haptic's trigger.
    @State private var taps = 0
    @State private var isShimmering = false
    @State private var isBrightened = false
    /// Whether the sleeve is on screen; a scroll view keeps its rows alive, so `onDisappear` can't say (finding on #377).
    @State private var isInView = true
    /// The width the row offers; the default sleeve shrinks to fit a narrow list.
    @State private var availableWidth = CGFloat.infinity

    var body: some View {
        if fitsWidth {
            content(side: SpinningSleeveFit.fittedSide(side, availableWidth: availableWidth))
                // Report the offered width, not the child's, so a narrow row shrinks the sleeve.
                .frame(minWidth: 0, maxWidth: .infinity)
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { availableWidth = $0 }
        } else {
            content(side: side)
        }
    }

    @ViewBuilder
    private func content(side: CGFloat) -> some View {
        let spins = WheelMotion.spins(
            isPlaying: isPlaying,
            isAnimated: WheelMotion.isAnimated(scenePhase: scenePhase, isScreenShowing: isScreenShowing, isLowPowerMode: isLowPowerMode, isInView: isInView, reduceMotion: reduceMotion)
        )
        let disc = side * Theme.Immersive.discToSleeveRatio
        let peek = disc * Theme.Immersive.discPeekRatio
        ZStack(alignment: .leading) {
            TimelineView(.animation(minimumInterval: nil, paused: !spins)) { context in
                RecordDisc(cover: discCover, size: disc,
                           rotationDegrees: RecordSpin.angle(accumulated: accumulated, startedAt: startedAt, now: context.date))
            }
            .offset(x: side + peek - disc)
            .accessibilityHidden(true)
            sleeve(side: side)
        }
        .frame(width: side + peek, height: side, alignment: .leading)
        .opacity(isInert && !isEditing ? 0.45 : 1)
        .onGeometryChange(for: Bool.self) { proxy in
            let frame = proxy.frame(in: .global)
            return frame.maxY > 0 && frame.minY < UIScreen.main.bounds.height
        } action: { isInView = $0 }
        .onAppear {
            isScreenShowing = true
            if spins { startedAt = .now }
        }
        .onDisappear { isScreenShowing = false }
        .onChange(of: spins) { _, turning in
            if turning {
                startedAt = .now
            } else {
                accumulated = RecordSpin.angle(accumulated: accumulated, startedAt: startedAt, now: .now)
                startedAt = nil
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .NSProcessInfoPowerStateDidChange).receive(on: DispatchQueue.main)) { _ in
            isLowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled
        }
    }

    @ViewBuilder
    private func sleeve(side: CGFloat) -> some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Immersive.sleeveCornerRadius, style: .continuous)
        let cover = art(side)
            .overlay {
                if !isEditing && !isInert {
                    ZStack {
                        CoverGlowShimmer(pressed: isShimmering, pinned: false, enabled: !reduceMotion)
                            .opacity(0.6)
                        Color.white.opacity(isBrightened ? 0.16 : 0)
                    }
                    .clipShape(shape)
                    .allowsHitTesting(false)
                }
            }
            .shadow(color: .black.opacity(0.35), radius: 14, y: 8)
        if isEditing {
            cover
        } else {
            Button {
                guard !isInert else { return }
                taps += 1
                acknowledge()
                onPress()
            } label: { cover.accessibilityHidden(false) }
            .buttonStyle(.plain)
            .contentShape(shape)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
            .accessibilityHint(hint)
            .disabled(isInert)
            .accessibilityAddTraits(.isButton)
            .sensoryFeedback(.impact(weight: .light), trigger: taps)
        }
    }

    /// One sweep of light; under Reduce Motion a brief brightening instead.
    private func acknowledge() {
        if reduceMotion {
            withAnimation(.easeOut(duration: 0.12)) { isBrightened = true }
            Task {
                try? await Task.sleep(for: .milliseconds(160))
                withAnimation(.easeOut(duration: 0.4)) { isBrightened = false }
            }
        } else {
            isShimmering = true
            Task {
                try? await Task.sleep(for: .milliseconds(60))
                isShimmering = false
            }
        }
    }
}
