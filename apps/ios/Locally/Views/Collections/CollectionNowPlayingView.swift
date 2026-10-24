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
    /// The playing cover's colour, for the play disc and the progress line (the accent when there is none).
    var tint: Color = Theme.accent
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
                .progressViewStyle(TintedProgressStyle(tint: tint))
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
                .buttonStyle(PlayerGlassStyle(size: 44))
            Button(playback?.isPlaying == true ? Copy.Collections.pause : Copy.Collections.play, systemImage: playback?.isPlaying == true ? "pause.fill" : "play.fill") {
                playback?.togglePlayPause()
            }
            .buttonStyle(PlayerDiscStyle(size: 52, tint: tint))
            Button(Copy.Collections.nextTrack, systemImage: "forward.end.fill") { playback?.next() }
                .buttonStyle(PlayerGlassStyle(size: 44))
        }
        .labelStyle(.iconOnly)
        .disabled(!hasTrack)
        .frame(maxWidth: .infinity)
    }
}

/// Previous / next: a glass circle with the round rim and a white glyph, at least `size` across.
private struct PlayerGlassStyle: ButtonStyle {
    let size: CGFloat
    @Environment(\.isEnabled) private var isEnabled
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: size * 0.36, weight: .bold))
            .foregroundStyle(Color.white)
            .frame(width: size * min(scale, 1.6), height: size * min(scale, 1.6))
            .background { GlowGlass().clipShape(Circle()) }
            .overlay { GlowRim(round: true) }
            .contentShape(Circle())
            .opacity(isEnabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
    }
}

/// Play / pause: the Glow switch's tinted thumb as a disc (dark base, the cover's colour, white rim, tinted shadow)
/// with a specular highlight at the top left.
private struct PlayerDiscStyle: ButtonStyle {
    let size: CGFloat
    let tint: Color
    @Environment(\.isEnabled) private var isEnabled
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: size * 0.36, weight: .bold))
            .foregroundStyle(Color.white)
            .frame(width: size * min(scale, 1.6), height: size * min(scale, 1.6))
            .background { disc }
            .contentShape(Circle())
            .opacity(isEnabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
    }

    private var disc: some View {
        // A dark base under the tint keeps the white glyph at 4.5:1 or better on a bright colour.
        Circle()
            .fill(Color.black.opacity(Theme.Import.kindThumbBase))
            .overlay(Circle().fill(tint.opacity(0.55)))
            .overlay {
                Circle().fill(RadialGradient(
                    colors: [.white.opacity(0.35), .clear], center: UnitPoint(x: 0.28, y: 0.2), startRadius: 0, endRadius: size * 0.55
                ))
            }
            .overlay(Circle().strokeBorder(Color.white.opacity(0.35), lineWidth: 1))
            .shadow(color: tint.opacity(0.5), radius: 8)
    }
}

/// The progress line: a dim hairline for the track and the cover's colour, with a faint glow, for the played part. It
/// keeps ProgressView's spoken value.
private struct TintedProgressStyle: ProgressViewStyle {
    let tint: Color

    func makeBody(configuration: Configuration) -> some View {
        let fraction = min(max(configuration.fractionCompleted ?? 0, 0), 1)
        Capsule()
            .fill(Color.white.opacity(0.18))
            .frame(height: 2)
            .overlay(alignment: .leading) {
                GeometryReader { geo in
                    Capsule()
                        .fill(tint)
                        .overlay(Capsule().fill(Color.white.opacity(0.3)))
                        .frame(width: geo.size.width * fraction)
                        .shadow(color: tint.opacity(0.6), radius: 4)
                }
            }
            .frame(height: 12)
    }
}
