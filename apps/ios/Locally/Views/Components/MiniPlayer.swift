import SwiftUI

/// The mini player (#336): a faked-glass bar above the tab bar on every tab, shown only while a queue
/// exists. The cover, the title over the artist, play/pause and next (44 pt each), and a thin progress
/// line along its bottom edge. Tapping the bar (the cover and names) opens the queue's context: a release's page. At the
/// accessibility sizes the names take a row of their own above the buttons.
/// What the bar draws, read where the bar is built (the tab bar accessory is hosted by the system and
/// does not reliably re-run a view that reads the observable player itself).
@MainActor
struct MiniPlayerState: Equatable {
    /// The playing item's own release: the cover is looked up by it.
    var releaseID: UUID
    var title: String
    var artist: String
    var isPlaying: Bool
    var progress: Double

    init?(_ playback: PlaybackService?) {
        guard let playback, let release = playback.currentRelease, let track = playback.currentTrack else { return nil }
        releaseID = release.id
        title = track.title
        artist = release.artist
        isPlaying = playback.isPlaying
        progress = playback.progress
    }
}

struct MiniPlayerBar: View {
    let playback: PlaybackService
    let state: MiniPlayerState
    /// In iOS 26's tab bar accessory the system supplies the glass and the shape, so the bar draws none.
    var inAccessory = false

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var coverBase: CGFloat = 44
    private var coverSide: CGFloat { inAccessory ? min(coverBase, 38) : coverBase }
    /// The control glyphs scale with Dynamic Type up to a cap, and the 44 pt target grows with them (#414).
    @ScaledMetric(relativeTo: .body) private var scaledControlGlyph: CGFloat = 22
    private var controlGlyph: CGFloat { min(scaledControlGlyph, 35) }
    @State private var cover: UIImage?
    static let accessoryBacking = 0.7

    var body: some View {
        Group {
            let layout = dynamicTypeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4)) : AnyLayout(HStackLayout(spacing: 4))
            layout {
                Button { playback.openContext() } label: {
                    HStack(spacing: 12) {
                        coverView
                        VStack(alignment: .leading, spacing: 2) {
                            Text(state.title)
                                .themeFont(.rowTitle)
                                .foregroundStyle(Theme.primaryText)
                                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
                            Text(state.artist.isEmpty ? Copy.Detail.unknownArtist : state.artist)
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
                .accessibilityValue(Copy.Playback.miniPlayerValue(title: state.title, artist: state.artist))
                .accessibilityHint(Copy.Playback.openRelease)
                .accessibilityIdentifier("mini-player-open")

                HStack(spacing: 0) {
                    if dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 0) }
                    control(state.isPlaying ? .pause : .play, label: state.isPlaying ? Copy.Playback.pauseButton : Copy.Playback.playButton, id: "mini-player-toggle") {
                        playback.togglePlayPause()
                    }
                    control(.next, label: Copy.Playback.nextButton, id: "mini-player-next") { playback.next() }
                }
            }
            .padding(.leading, 10)
            .padding(.trailing, 4)
            .padding(.vertical, inAccessory ? 0 : 6)
            .modifier(BarChrome(enabled: !inAccessory, progress: state.progress))
            .background {
                // The system's accessory glass lets the page's text show through; this dark backing keeps
                // the title and artist readable over a row scrolling beneath.
                if inAccessory { Rectangle().fill(Color.black.opacity(Self.accessoryBacking)).padding(.horizontal, -40).padding(.vertical, -20).ignoresSafeArea() }
            }
            .accessibilityElement(children: .contain)
            .task(id: state.releaseID) { cover = playback.cover.flatMap(UIImage.init(data:)) }
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

    private func control(_ icon: LocallyIcon.Name, label: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            LocallyIcon(icon, size: controlGlyph, scaled: false)
                .foregroundStyle(Theme.primaryText)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityIdentifier(id)
    }
}

/// The faked glass, rim, shadow and progress line of the bar over iOS 17-25 (and iOS 26.0): an opaque
/// dark base under the faint white fill so the page behind never reads through (no live blur).
private struct BarChrome: ViewModifier {
    let enabled: Bool
    let progress: Double

    private let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)

    func body(content: Content) -> some View {
        if enabled {
            content
                .background(shape.fill(Theme.card).overlay(shape.fill(Theme.Immersive.panelFill)))
                .overlay(alignment: .bottom) { line }
                .clipShape(shape)
                .overlay(shape.stroke(Theme.Immersive.panelStroke, lineWidth: 1))
                .shadow(color: .black.opacity(0.45), radius: 14, y: 6)
        } else {
            content.overlay(alignment: .bottom) { line.padding(.horizontal, 20).padding(.bottom, 3) }
        }
    }

    /// 2 pt along the bottom edge; the bar's corner clips it.
    private var line: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Rectangle().fill(.white.opacity(0.12))
                Rectangle().fill(Theme.accent).frame(width: geo.size.width * progress)
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
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    /// Always the same view structure: only what the inset holds changes, so showing the bar or an error
    /// never replaces the tab under it (which would reset its navigation and any draft).
    func body(content: Content) -> some View {
        let showing = playback?.hasQueue ?? false
        // The accessory is a fixed-height capsule, so the accessibility sizes use the inset bar, which grows.
        let inAccessory = MiniPlayerPlacement.usesTabAccessory && !dynamicTypeSize.isAccessibilitySize
        return inset(content, showing: showing, inAccessory: inAccessory)
    }

    private func inset(_ content: Content, showing: Bool, inAccessory: Bool) -> some View {
        content
            // The queue toast (#364) sits on the content, so it floats above the bar this inset holds.
            .queueToastHost()
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if let playback, let message = playback.startError {
                    MiniPlayerNotice(message: message)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 8)
                        .transition(.opacity)
                } else if let playback, showing, !inAccessory, let state = MiniPlayerState(playback) {
                    MiniPlayerBar(playback: playback, state: state)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 8)
                        .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .bottom)))
                }
            }
            .animation(reduceMotion ? .easeOut(duration: 0.16) : .timingCurve(0.16, 1, 0.3, 1, duration: 0.24), value: showing)
            .animation(.easeOut(duration: 0.16), value: playback?.startError)
    }
}

/// The one line shown where the mini player would be when playback could not start; it clears itself.
struct MiniPlayerNotice: View {
    let message: String
    private let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)

    var body: some View {
        Text(message)
            .themeFont(.rowSubtitle)
            .foregroundStyle(Theme.primaryText)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(shape.fill(Theme.card).overlay(shape.fill(Theme.Immersive.panelFill)))
            .overlay(shape.stroke(Theme.Immersive.panelStroke, lineWidth: 1))
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("mini-player-error")
    }
}

extension View {
    func miniPlayerInset() -> some View { modifier(MiniPlayerInset()) }
}

enum MiniPlayerPlacement {
    /// iOS 26.1 and later hold the bar in the tab bar's own accessory slot (as Apple Music does).
    /// `tabViewBottomAccessory(isEnabled:)` is in the iOS 26 SDK only (Xcode 26); CI builds with Xcode 16.
    static var usesTabAccessory: Bool {
        #if compiler(>=6.2)
        if #available(iOS 26.1, *) { return true }
        #endif
        return false
    }
}

/// On the `TabView`: the bar in the system's bottom accessory, where the system supports it and the
/// text is not at an accessibility size. Elsewhere each tab's `miniPlayerInset()` places it.
struct MiniPlayerAccessory: ViewModifier {
    let playback: PlaybackService?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @ViewBuilder
    func body(content: Content) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.1, *) {
            let state = MiniPlayerState(playback)
            content.tabViewBottomAccessory(isEnabled: state != nil && !dynamicTypeSize.isAccessibilitySize) {
                if let playback, let state { MiniPlayerBar(playback: playback, state: state, inAccessory: true) }
            }
        } else {
            content
        }
        #else
        content
        #endif
    }
}

extension View {
    func miniPlayerAccessory(_ playback: PlaybackService?) -> some View { modifier(MiniPlayerAccessory(playback: playback)) }
}
