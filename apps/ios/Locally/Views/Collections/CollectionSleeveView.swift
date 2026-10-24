import SwiftUI

/// The collection's cover as a record sleeve with the vinyl peeking out to its right (#369), like the release page's.
/// Outside edit mode the sleeve is the play control: a tap starts, pauses or resumes the collection, acknowledged by
/// one soft sweep of light (a short brightening under Reduce Motion) and a light tap, with no glyph on the cover.
/// The disc turns only while this collection plays, and holds its angle on pause (`RecordSpin`, as the record player does).
struct CollectionSleeveView: View {
    let model: CollectionsModel
    let collection: MusicCollection
    var isEditing = false

    @Environment(\.playback) private var playback
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var firstImage: UIImage?
    @State private var accumulated = 0.0
    @State private var startedAt: Date?
    @State private var isScreenShowing = true
    @State private var isLowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled
    /// Counts accepted taps: the haptic's trigger.
    @State private var taps = 0
    @State private var isShimmering = false
    @State private var isBrightened = false

    private var side: CGFloat { Theme.Immersive.sleeveSizeCompact }

    var body: some View {
        let control = CollectionPlayControl(model: model, id: collection.id, playback: playback)
        let action = control.sleeveAction(isEditing: isEditing)
        let canPlay = !control.playQueue.isEmpty
        let spins = WheelMotion.spins(
            isPlaying: control.isPlayingNow,
            isAnimated: WheelMotion.isAnimated(scenePhase: scenePhase, isScreenShowing: isScreenShowing, isLowPowerMode: isLowPowerMode, isInView: true, reduceMotion: reduceMotion)
        )
        let disc = side * Theme.Immersive.discToSleeveRatio
        let peek = disc * Theme.Immersive.discPeekRatio
        ZStack(alignment: .leading) {
            TimelineView(.animation(minimumInterval: nil, paused: !spins)) { context in
                RecordDisc(cover: firstImage, size: disc,
                           rotationDegrees: RecordSpin.angle(accumulated: accumulated, startedAt: startedAt, now: context.date))
            }
            .offset(x: side + peek - disc)
            .accessibilityHidden(true)
            sleeve(control: control, action: action, canPlay: canPlay)
        }
        .frame(width: side + peek, height: side, alignment: .leading)
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
    private func sleeve(control: CollectionPlayControl, action: CollectionSleeveAction, canPlay: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Immersive.sleeveCornerRadius, style: .continuous)
        let art = CollectionCoverView(releaseIDs: model.coverReleaseIDs(of: collection), side: side,
                                      cornerRadius: Theme.Immersive.sleeveCornerRadius) { firstImage = $0 }
            .overlay {
                if !isEditing {
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
            art
        } else {
            Button {
                guard action != .inert else { return }
                taps += 1
                acknowledge()
                control.togglePlay()
            } label: { art.accessibilityHidden(false) }
            .buttonStyle(.plain)
            .contentShape(shape)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(action.label(name: collection.name, canPlay: canPlay))
            .accessibilityHint(action == .inert ? "" : Copy.Collections.playCollectionHint)
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
