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
    /// The playing cover's colour, for the progress line (the accent when there is none).
    var tint: Color = Theme.accent
    var onBack: () -> Void

    /// The drawn glyphs scale with Dynamic Type up to a cap, like the library toggle icons (#414).
    @ScaledMetric(relativeTo: .body) private var scaledSideGlyph: CGFloat = 24
    @ScaledMetric(relativeTo: .body) private var scaledMainGlyph: CGFloat = 30
    private var sideGlyph: CGFloat { min(scaledSideGlyph, 35) }
    private var mainGlyph: CGFloat { min(scaledMainGlyph, 44) }

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

    /// Plain drawn glyphs in `Theme.primaryText` with nothing behind them (#414): 24 pt previous / next and a 30 pt
    /// play / pause, in 44 pt targets (the main one 52). The frames are minimums, so they grow with the glyph at the
    /// large text sizes.
    private var controls: some View {
        let playing = playback?.isPlaying == true
        return HStack(spacing: 24) {
            transport(.previous, size: sideGlyph, side: 44, label: Copy.Collections.previousTrack) { playback?.previous() }
            transport(playing ? .pause : .play, size: mainGlyph, side: 52, label: playing ? Copy.Collections.pause : Copy.Collections.play) {
                playback?.togglePlayPause()
            }
            transport(.next, size: sideGlyph, side: 44, label: Copy.Collections.nextTrack) { playback?.next() }
        }
        .disabled(!hasTrack)
        .opacity(hasTrack ? 1 : 0.4)
        .frame(maxWidth: .infinity)
    }

    private func transport(_ icon: LocallyIcon.Name, size: CGFloat, side: CGFloat, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            LocallyIcon(icon, size: size, scaled: false)
                .foregroundStyle(Theme.primaryText)
                .frame(minWidth: side, minHeight: side)
                .contentShape(Rectangle())
        }
        .buttonStyle(GlyphPressStyle())
        .accessibilityLabel(label)
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

/// A press that only dims the glyph: nothing is drawn behind a play control (#414).
private struct GlyphPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.55 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
