import SwiftUI

/// Under the wheel (#352): what the player has, from the player's own state. The eyebrow ("Late drives · track 3 of
/// 27"), the title and artist, a progress line, and previous / play-pause / next centred. While the wheel's front is
/// not the playing collection, "Back to {name}" turns the wheel back. With nothing playing it says so and the controls
/// are disabled. It scales fully with the text size and wraps at the accessibility sizes.
struct CollectionNowPlayingView: View {
    let playback: PlaybackService?
    /// The name of what the queue came from (a collection, else the release), for the eyebrow.
    let sourceName: String?
    /// The playing collection's name when the wheel's front is another one; nil when they are the same or nothing plays.
    let backTo: String?
    var onBack: () -> Void

    private var hasTrack: Bool { playback?.currentTrack != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let playback, let track = playback.currentTrack, let queue = playback.queue {
                Text(Copy.Collections.nowPlayingEyebrow(collection: sourceName ?? playback.currentRelease?.title ?? "", track: queue.index + 1, of: queue.items.count))
                    .themeFont(.meta)
                    .foregroundStyle(Theme.secondaryText)
                VStack(alignment: .leading, spacing: 2) {
                    Text(track.title)
                        .themeFont(.pageTitle)
                        .foregroundStyle(Theme.primaryText)
                    Text(playback.currentRelease?.artist ?? "")
                        .themeFont(.body)
                        .foregroundStyle(Theme.secondaryText)
                }
            } else {
                Text(Copy.Collections.nothingPlaying)
                    .themeFont(.pageTitle)
                    .foregroundStyle(Theme.secondaryText)
            }
            ProgressView(value: playback?.progress ?? 0)
                .progressViewStyle(.linear)
                .tint(Theme.primaryText)
                .accessibilityLabel(Copy.Collections.progressLabel)
            controls
            if let backTo {
                Button(action: onBack) {
                    Text(Copy.Collections.backTo(backTo))
                        .themeFont(.body)
                        .foregroundStyle(Theme.primaryText)
                        .underline()
                        .multilineTextAlignment(.leading)
                        .frame(minHeight: 44, alignment: .leading)
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var controls: some View {
        HStack(spacing: 24) {
            Button(Copy.Collections.previousTrack, systemImage: "backward.end.fill") { playback?.previous() }
                .buttonStyle(PlayerCircleStyle(size: 44))
            Button(playback?.isPlaying == true ? Copy.Collections.pause : Copy.Collections.play, systemImage: playback?.isPlaying == true ? "pause.fill" : "play.fill") {
                playback?.togglePlayPause()
            }
            .buttonStyle(PlayerCircleStyle(size: 52))
            Button(Copy.Collections.nextTrack, systemImage: "forward.end.fill") { playback?.next() }
                .buttonStyle(PlayerCircleStyle(size: 44))
        }
        .labelStyle(.iconOnly)
        .disabled(!hasTrack)
        .frame(maxWidth: .infinity)
    }
}

/// A round control: a faint fill and edge, at least `size` across (44 pt for the small ones, 52 for the main one).
private struct PlayerCircleStyle: ButtonStyle {
    let size: CGFloat
    @Environment(\.isEnabled) private var isEnabled
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: size * 0.36, weight: .bold))
            .foregroundStyle(Theme.primaryText)
            .frame(width: size * min(scale, 1.6), height: size * min(scale, 1.6))
            .background(Circle().fill(Theme.Immersive.panelFill))
            .overlay(Circle().strokeBorder(Color.white.opacity(0.22), lineWidth: 1))
            .contentShape(Circle())
            .opacity(isEnabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
    }
}
