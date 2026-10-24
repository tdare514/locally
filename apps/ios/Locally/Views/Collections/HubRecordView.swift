import SwiftUI

/// The wheel's hub (#352): the playing record on the left edge, inside a dark platter rim. A picture disc by default
/// (the current track's cover edge to edge with faint grooves and a small centre hole); Black vinyl shows a black
/// record with the cover as its centre label. With nothing playing it is a bare black record, still.
///
/// It turns at 33 1/3 rpm only while `isSpinning`, and stays at its angle when paused: the angle is accumulated across
/// pauses. Switching Picture disc / Black vinyl cross-fades two layers that are always there, so nothing remounts and
/// the turn never restarts. Only a transform (the turn) and opacity change.
struct HubRecordView: View {
    @Environment(\.appContainer) private var container
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The release of the track in the player; nil when nothing plays.
    let releaseID: UUID?
    let style: SpinningRecord
    let isSpinning: Bool

    @State private var cover: UIImage?
    @State private var accumulated = 0.0
    @State private var startedAt: Date?

    private var radius: CGFloat { Theme.Immersive.hubRadius }

    var body: some View {
        ZStack {
            // The platter's rim stays still; only the record turns.
            Circle().fill(Theme.Immersive.platterColor)
            Circle().strokeBorder(Color.white.opacity(0.10), lineWidth: 1)
            TimelineView(.animation(minimumInterval: nil, paused: !isSpinning)) { context in
                RecordFace(cover: cover, style: style, animatesStyle: !reduceMotion)
                    .rotationEffect(.degrees(RecordSpin.angle(accumulated: accumulated, startedAt: startedAt, now: context.date)))
            }
            .padding(Theme.Immersive.hubRimWidth)
        }
        .frame(width: radius * 2, height: radius * 2)
        .accessibilityHidden(true)
        .task(id: releaseID) {
            guard let releaseID, let store = container?.coverStore else {
                cover = nil
                return
            }
            cover = await Task.detached(priority: .utility) { store.load(releaseID).flatMap { UIImage(data: $0) } }.value
        }
        .onAppear { if isSpinning { startedAt = .now } }
        .onChange(of: isSpinning) { _, spinning in
            if spinning {
                startedAt = .now
            } else {
                accumulated = RecordSpin.angle(accumulated: accumulated, startedAt: startedAt, now: .now)
                startedAt = nil
            }
        }
    }
}

/// The record itself, drawn from its cover and style only, so it is not redrawn while it turns.
private struct RecordFace: View {
    let cover: UIImage?
    let style: SpinningRecord
    let animatesStyle: Bool

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            ZStack {
                Circle().fill(Theme.Immersive.discColor)
                // Picture disc: the cover edge to edge.
                if let cover {
                    Image(uiImage: cover).resizable().scaledToFill()
                        .frame(width: side, height: side).clipShape(Circle())
                        .opacity(style == .picture ? 1 : 0)
                }
                Grooves()
                    .opacity(style == .picture ? 0.5 : 1)
                // Black vinyl: the cover as the centre label.
                if let cover {
                    Image(uiImage: cover).resizable().scaledToFill()
                        .frame(width: side * 0.36, height: side * 0.36).clipShape(Circle())
                        .opacity(style == .vinyl ? 1 : 0)
                }
                // The centre hole, and a ring a little out from it.
                Circle().fill(Color.black).frame(width: 16, height: 16)
                    .overlay(Circle().strokeBorder(Color.white.opacity(0.25), lineWidth: 1))
            }
            .frame(width: side, height: side)
            .animation(animatesStyle ? .easeInOut(duration: Theme.Immersive.hubStyleDuration) : nil, value: style)
        }
    }
}

/// Faint concentric grooves.
private struct Grooves: View {
    var body: some View {
        Canvas { context, size in
            let centre = CGPoint(x: size.width / 2, y: size.height / 2)
            let outer = min(size.width, size.height) / 2
            var radius = outer - 4
            while radius > 10 {
                let ring = Path(ellipseIn: CGRect(x: centre.x - radius, y: centre.y - radius, width: radius * 2, height: radius * 2))
                context.stroke(ring, with: .color(.white.opacity(Theme.Immersive.grooveOpacity * 1.5)), lineWidth: Theme.Immersive.grooveWidth)
                radius -= 3
            }
        }
    }
}
