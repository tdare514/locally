import SwiftUI

#if DEBUG
/// #364: the queue toast over the release page with the mini player, for `-componentGallery queue-toast-*`.
/// The player runs on fakes, so no audio session or file is touched.
struct TrackActionsGallery: View {
    static let names = [
        "queue-toast-next", "queue-toast-added", "queue-toast-left-out", "queue-toast-ax3", "queue-toast-long-ax5", "queue-toast-left-out-ax5",
        // #364 part B: the long-press menu's places. A UI test long-presses a row; the player runs on fakes so Play next shows its toast.
        "track-menu-release", "track-menu-release-ax3", "track-menu-library", "track-menu-stats",
        // An album long enough that its last song starts off screen: Edit on it scrolls to its edit field.
        "track-menu-edit-scroll", "track-menu-edit-scroll-ax3",
    ]

    enum Scene { case toast, releasePage, longAlbum, library, stats }

    /// Fourteen songs, so the last starts off screen at any size.
    static let longAlbum: Release = {
        let id = UUID(uuidString: "00000000-0000-0000-0000-000000009000")!
        let tracks = (1...14).map { n in
            Track(id: UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", 9000 + n))!, title: "Song \(n)", trackNumber: n,
                  filePath: "long-\(n).mp3", originalName: "long-\(n).mp3", durationSec: 200)
        }
        return Release(id: id, kind: .album, title: "Long Player", artist: "Mira Valdane", genre: "Indie pop", coverPath: "/cover/long.png", folderPath: "/lib/long", tracks: tracks)
    }()

    enum Kind { case next, added, leftOut }
    var kind: Kind
    var large = false
    var ax5 = false
    var longTitle = false
    var scene = Scene.toast

    init(name: String) {
        switch name {
        case "track-menu-release", "track-menu-release-ax3": scene = .releasePage
        case "track-menu-edit-scroll", "track-menu-edit-scroll-ax3": scene = .longAlbum
        case "track-menu-library": scene = .library
        case "track-menu-stats": scene = .stats
        default: break
        }
        if scene == .library { UserDefaults.standard.set(LibraryLayout.covers.rawValue, forKey: LibraryViewPrefs.layoutKey) }
        switch name {
        case "queue-toast-added": kind = .added
        case "queue-toast-left-out": kind = .leftOut
        default: kind = .next
        }
        large = name == "queue-toast-ax3" || name == "track-menu-release-ax3" || name == "track-menu-edit-scroll-ax3"
        ax5 = name.hasSuffix("-ax5")
        longTitle = name == "queue-toast-long-ax5"
        if longTitle { kind = .added }
        if name == "queue-toast-left-out-ax5" { kind = .leftOut }
    }

    @State private var container = IconsGallery.container(releases: StatsGallery.releases + [TrackActionsGallery.longAlbum])
    @State private var toast = QueueToastCenter()
    @State private var playback = PlaybackService(
        engine: ToastGalleryEngine(), access: ToastGalleryAccess(), session: ToastGallerySession(),
        nowPlaying: ToastGalleryNowPlaying(), remote: ToastGalleryRemote(), coverData: { FileCoverStore().load($0.id) }
    )

    private var playing: Release {
        var release = StatsGallery.releases[0]
        release.year = "2025"
        return release
    }
    private var other: Release { StatsGallery.releases[1] }

    var body: some View {
        IconsGallery.environment(
            TabView {
                switch scene {
                case .toast, .releasePage, .longAlbum:
                    ReleaseGalleryStack(release: scene == .longAlbum ? Self.longAlbum : playing)
                        .miniPlayerInset()
                        .tabItem { Label(Copy.Library.title, image: "Icon/Library") }
                    Color.clear
                        .tabItem { Label(Copy.Stats.tabLabel, image: "Icon/Stats") }
                case .library:
                    IconsLibrary(openTray: false)
                        .miniPlayerInset()
                        .tabItem { Label(Copy.Library.title, image: "Icon/Library") }
                case .stats:
                    StatsGallery.statsView(.week)
                        .miniPlayerInset()
                        .tabItem { Label(Copy.Stats.tabLabel, image: "Icon/Stats") }
                }
            }
            .miniPlayerAccessory(playback)
            .environment(\.playback, playback)
            .environment(\.queueToast, toast)
            .frame(width: ax5 ? 320 : nil),
            container
        )
        .dynamicTypeSize(ax5 ? .accessibility5 : large ? .accessibility3 : .large)
        .task {
            toast.autoHides = false
            playback.play(release: playing, startingAt: playing.tracks[1].id)
            try? await Task.sleep(for: .milliseconds(500))
            guard scene == .toast else { return }
            let cover = FileCoverStore().load(other.id)
            switch kind {
            case .added where longTitle:
                toast.show(QueueToastMessage(title: Copy.TrackActions.addedToQueue, detail: "Everything Is Recorded (Live at the Old Fire Station, Extended Remastered Edition)", cover: cover))
            case .next, .added:
                let actions = TrackActions(target: .track(releaseId: other.id, trackId: other.tracks[0].id), release: other)
                if let message = actions.queue(playback, next: kind == .next, cover: cover) { toast.show(message) }
            case .leftOut:
                toast.show(QueueToastMessage.make(QueueAddOutcome(added: 0, leftOut: 3, started: false), next: false, subject: Copy.TrackActions.songCount(3), cover: cover)!)
            }
        }
    }
}

/// A release page in a path-driven stack with the Library's song routes (#365), so the title tap, Song info, Edit and the
/// Album row work in the gallery as in the app.
private struct ReleaseGalleryStack: View {
    let release: Release
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            ReleaseDetailView(release: release)
                .navigationDestination(for: ReleaseTrackRoute.self) { ReleaseDetailView(release: $0.release, highlightTrackID: $0.trackId) }
                .navigationDestination(for: ReleaseEditRoute.self) {
                    ReleaseDetailView(release: $0.release, startsEditing: true, scrollsToTrackID: $0.trackId)
                }
                .navigationDestination(for: SongRoute.self) { route in
                    SongPageDestination(route: route) { path.append($0) }
                }
        }
        .environment(\.openSong, { path.append($0) })
    }
}

@MainActor private final class ToastGalleryEngine: PlaybackEngine {
    var onProgress: ((Double, Double?) -> Void)?
    private var continuation: CheckedContinuation<PlaybackEnd, Never>?
    func play(url: URL) async -> PlaybackEnd {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            onProgress?(70, 200)
        }
    }
    func pause() {}
    func resume() {}
    func seek(to seconds: Double) {}
    func stop() {
        continuation?.resume(returning: .stopped)
        continuation = nil
    }
}

private struct ToastGalleryAccess: PlaybackFileAccess {
    func withFile<T>(for track: Track, _ body: (URL?) async -> T) async throws -> T {
        await body(URL(fileURLWithPath: "/tmp/gallery.mp3"))
    }
}

@MainActor private final class ToastGallerySession: PlaybackSession {
    var onInterruption: ((InterruptionEvent) -> Void)?
    var onRouteChange: ((RouteChangeEvent) -> Void)?
    func activate() throws {}
    func deactivate() {}
}

@MainActor private final class ToastGalleryNowPlaying: NowPlayingPublisher {
    func publish(_ info: NowPlayingInfo?) {}
}

@MainActor private final class ToastGalleryRemote: RemoteCommandRegistrar {
    func register(_ handler: @escaping (RemoteCommand) -> Void) {}
}
#endif
