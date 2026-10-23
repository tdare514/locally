import SwiftUI

/// The mini player (#336): a faked-glass bar above the tab bar on every tab, shown only while a queue
/// exists. The cover, the title over the artist, play/pause and next (44 pt each), and a thin progress
/// line along its bottom edge. Tapping the bar (the cover and names) opens the release's page. At the
/// accessibility sizes the names take a row of their own above the buttons.
struct MiniPlayerBar: View {
    let playback: PlaybackService

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var coverSide: CGFloat = 44
    @State private var cover: UIImage?

    private let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)

    var body: some View {
        if let release = playback.currentRelease, let track = playback.currentTrack {
            let layout = dynamicTypeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4)) : AnyLayout(HStackLayout(spacing: 4))
            layout {
                Button { playback.openReleaseRequest = release.id } label: {
                    HStack(spacing: 12) {
                        coverView
                        VStack(alignment: .leading, spacing: 2) {
                            Text(track.title)
                                .themeFont(.rowTitle)
                                .foregroundStyle(Theme.primaryText)
                                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
                            Text(release.artist.isEmpty ? Copy.Detail.unknownArtist : release.artist)
                                .themeFont(.rowSubtitle)
                                .foregroundStyle(Theme.secondaryText)
                                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Copy.Playback.miniPlayerLabel)
                .accessibilityValue(Copy.Playback.miniPlayerValue(title: track.title, artist: release.artist))
                .accessibilityHint(Copy.Playback.openRelease)
                .accessibilityIdentifier("mini-player-open")

                HStack(spacing: 0) {
                    if dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 0) }
                    control(playback.isPlaying ? "pause.fill" : "play.fill", label: playback.isPlaying ? Copy.Playback.pauseButton : Copy.Playback.playButton, id: "mini-player-toggle") {
                        playback.togglePlayPause()
                    }
                    control("forward.fill", label: Copy.Playback.nextButton, id: "mini-player-next") { playback.next() }
                }
            }
            .padding(.leading, 10)
            .padding(.trailing, 4)
            .padding(.vertical, 6)
            .background(
                // Faked glass: an opaque dark base under the faint white fill, so the page behind never
                // reads through the text (no live blur).
                shape.fill(Theme.card).overlay(shape.fill(Theme.Immersive.panelFill))
            )
            .overlay(alignment: .bottom) { progressLine }
            .clipShape(shape)
            .overlay(shape.stroke(Theme.Immersive.panelStroke, lineWidth: 1))
            .shadow(color: .black.opacity(0.45), radius: 14, y: 6)
            .accessibilityElement(children: .contain)
            .task(id: release.id) { cover = playback.cover.flatMap(UIImage.init(data:)) }
        }
    }

    @ViewBuilder private var coverView: some View {
        Group {
            if let cover {
                Image(uiImage: cover).resizable().scaledToFill()
            } else {
                NoCoverArt()
            }
        }
        .frame(width: coverSide, height: coverSide)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityHidden(true)
    }

    private func control(_ symbol: String, label: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Theme.primaryText)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityIdentifier(id)
    }

    /// 2 pt along the bottom edge; the bar's corner clips it.
    private var progressLine: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Rectangle().fill(.white.opacity(0.12))
                Rectangle().fill(Theme.accent).frame(width: geo.size.width * playback.progress)
            }
        }
        .frame(height: 2)
        .accessibilityHidden(true)
    }
}

/// Puts the mini player above the tab bar as a bottom inset, so the content's insets grow by its height.
/// Applied to each tab's root view: a tab's bottom safe area already sits above the tab bar.
struct MiniPlayerInset: ViewModifier {
    @Environment(\.playback) private var playback
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let showing = playback?.hasQueue ?? false
        content
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if let playback, showing {
                    MiniPlayerBar(playback: playback)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 8)
                        .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .bottom)))
                }
            }
            .animation(reduceMotion ? .easeOut(duration: 0.16) : .timingCurve(0.16, 1, 0.3, 1, duration: 0.24), value: showing)
    }
}

extension View {
    func miniPlayerInset() -> some View { modifier(MiniPlayerInset()) }
}
