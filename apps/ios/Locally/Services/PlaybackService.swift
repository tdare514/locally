import Foundation
import Observation

// Play a track inside Locally from the files already on the phone (#336, plan 324). One app-wide
// `PlaybackService` owns the queue and the state the rows and the mini player draw. Everything
// that touches the system (the audio session, the player, the lock screen, the Spotify folder's
// security scope) sits behind a small protocol below, so tests drive the service with fakes.

/// How one item ended.
enum PlaybackEnd: Equatable {
    case finished
    case failed
    /// `stop()` was called on the engine (a skip, a stop).
    case stopped
}

/// Plays one file at a time and reports back when it ends. Production: `AVQueuePlayerEngine`.
@MainActor
protocol PlaybackEngine: AnyObject {
    /// Called about twice a second while an item plays: elapsed and duration in seconds.
    var onProgress: ((Double, Double?) -> Void)? { get set }
    /// Starts `url` and returns when it finishes, fails, or `stop()` is called.
    func play(url: URL) async -> PlaybackEnd
    func pause()
    func resume()
    func seek(to seconds: Double)
    /// Ends the current item (its `play` returns `.stopped`).
    func stop()
}

/// Opens a track's file with the Spotify folder's access held while `body` runs, and closes the
/// access when `body` returns or throws. `body` gets nil when the file is gone.
protocol PlaybackFileAccess {
    func withFile<T>(for track: Track, _ body: (URL?) async -> T) async throws -> T
}

/// Production: the connected Spotify folder, through `SpotifyFolderAccess.withAccess`.
struct SpotifyPlaybackFileAccess: PlaybackFileAccess {
    let folder: SpotifyFolderAccess

    func withFile<T>(for track: Track, _ body: (URL?) async -> T) async throws -> T {
        try await folder.withAccess { (folderURL: URL) async -> T in
            let url = ReleaseCoordinator.resolvedFileURL(for: track, in: folderURL)
            // Never read outside the connected folder.
            let inside = ReleaseLayout().isInside(folder: folderURL, path: url.path)
            return await body(inside && FileManager.default.fileExists(atPath: url.path) ? url : nil)
        }
    }
}

enum InterruptionEvent: Equatable {
    case began
    case ended(shouldResume: Bool)
}

enum RouteChangeEvent: Equatable {
    /// The output went to the built-in speaker (headphones or a speaker unplugged).
    case builtInSpeaker
    case other
}

/// The audio session: `.playback`, activated on first play. Production: `SystemPlaybackSession`.
@MainActor
protocol PlaybackSession: AnyObject {
    var onInterruption: ((InterruptionEvent) -> Void)? { get set }
    var onRouteChange: ((RouteChangeEvent) -> Void)? { get set }
    func activate() throws
    func deactivate()
}

/// What the lock screen shows.
struct NowPlayingInfo: Equatable {
    var title: String
    var artist: String
    var album: String
    var artwork: Data?
    var duration: Double?
    var elapsed: Double
    var isPlaying: Bool
}

@MainActor
protocol NowPlayingPublisher: AnyObject {
    /// Nil clears the lock screen.
    func publish(_ info: NowPlayingInfo?)
}

/// The lock screen and Control Center commands.
enum RemoteCommand: Equatable {
    case play, pause, toggle, next, previous
    case seek(Double)
}

/// Registers the remote commands once; each one is handed to `handler`. Production: `SystemRemoteCommands`.
@MainActor
protocol RemoteCommandRegistrar: AnyObject {
    func register(_ handler: @escaping (RemoteCommand) -> Void)
}

@MainActor
@Observable
final class PlaybackService {
    /// The queued tracks in play order, with the release they came from.
    struct Queue: Equatable {
        var release: Release
        var tracks: [Track]
    }

    private(set) var queue: Queue?
    /// Index into `queue.tracks` of the item playing (or paused).
    private(set) var currentIndex = 0
    private(set) var isPlaying = false
    private(set) var elapsed: Double = 0
    private(set) var duration: Double?
    /// Tracks whose file was gone when their turn came; the rows show "File missing".
    private(set) var missingTrackIDs: Set<UUID> = []
    /// Set by the mini player; the Library opens that release's page and clears it.
    var openReleaseRequest: UUID?

    @ObservationIgnored private let engine: PlaybackEngine
    @ObservationIgnored private let access: PlaybackFileAccess
    @ObservationIgnored private let session: PlaybackSession
    @ObservationIgnored private let nowPlaying: NowPlayingPublisher
    @ObservationIgnored private let remote: RemoteCommandRegistrar
    @ObservationIgnored private let coverData: (Release) -> Data?
    @ObservationIgnored private var runner: Task<Void, Never>?
    @ObservationIgnored private var cursor = 0
    @ObservationIgnored private var isSkipping = false
    @ObservationIgnored private var resumeAfterInterruption = false
    @ObservationIgnored private var isSetUp = false

    init(
        engine: PlaybackEngine, access: PlaybackFileAccess, session: PlaybackSession,
        nowPlaying: NowPlayingPublisher, remote: RemoteCommandRegistrar, coverData: @escaping (Release) -> Data? = { _ in nil }
    ) {
        self.engine = engine
        self.access = access
        self.session = session
        self.nowPlaying = nowPlaying
        self.remote = remote
        self.coverData = coverData
    }

    // MARK: What the views read

    var hasQueue: Bool { queue != nil }
    var currentTrack: Track? {
        guard let queue, queue.tracks.indices.contains(currentIndex) else { return nil }
        return queue.tracks[currentIndex]
    }
    var currentRelease: Release? { queue?.release }
    var cover: Data? { queue.flatMap { coverData($0.release) } }
    /// 0...1 along the mini player's bottom edge.
    var progress: Double {
        guard let duration, duration > 0 else { return 0 }
        return min(max(elapsed / duration, 0), 1)
    }

    /// Only a release whose files are on this phone plays: not an adopted (details-only) one.
    static func canPlay(_ release: Release) -> Bool {
        !release.isAdopted && !release.tracks.isEmpty
    }

    /// Disc, then track, as the release page lists them.
    static func playOrder(_ release: Release) -> [Track] {
        release.tracks.sorted {
            ($0.discNumber ?? 0, $0.trackNumber) < ($1.discNumber ?? 0, $1.trackNumber)
        }
    }

    /// What tapping a row's number does, or nil when the row has no play button.
    func playAction(release: Release, trackID: UUID) -> (() -> Void)? {
        guard Self.canPlay(release), release.tracks.contains(where: { $0.id == trackID }) else { return nil }
        return { [weak self] in self?.tapRow(release: release, trackID: trackID) }
    }

    func isCurrent(_ trackID: UUID, in release: Release) -> Bool {
        queue?.release.id == release.id && currentTrack?.id == trackID
    }

    /// A row's number: pause the playing track, resume the paused one, else start from this row.
    func tapRow(release: Release, trackID: UUID) {
        if isCurrent(trackID, in: release) {
            isPlaying ? pause() : resume()
        } else {
            play(release: release, startingAt: trackID)
        }
    }

    // MARK: Commands

    /// Queues the track and the rest of the release, and plays from the track.
    func play(release: Release, startingAt trackID: UUID) {
        guard Self.canPlay(release) else { return }
        let ordered = Self.playOrder(release)
        guard let start = ordered.firstIndex(where: { $0.id == trackID }) else { return }
        endRun()
        missingTrackIDs.remove(trackID)
        do {
            try session.activate()
        } catch {
            return
        }
        setUpOnce()
        queue = Queue(release: release, tracks: Array(ordered[start...]))
        cursor = 0
        isSkipping = false
        runner = Task { [weak self] in await self?.run() }
    }

    func pause() {
        guard hasQueue, isPlaying else { return }
        engine.pause()
        isPlaying = false
        publish()
    }

    func resume() {
        guard hasQueue, !isPlaying else { return }
        engine.resume()
        isPlaying = true
        publish()
    }

    func togglePlayPause() { isPlaying ? pause() : resume() }

    func next() {
        guard let queue else { return }
        if currentIndex + 1 < queue.tracks.count {
            skip(to: currentIndex + 1)
        } else {
            stop()
        }
    }

    /// Within the first 3 seconds it goes to the previous track, after that it restarts this one.
    func previous() {
        guard hasQueue else { return }
        if elapsed > 3 || currentIndex == 0 {
            seek(to: 0)
        } else {
            skip(to: currentIndex - 1)
        }
    }

    func seek(to seconds: Double) {
        guard hasQueue else { return }
        let target = max(0, duration.map { min(seconds, $0) } ?? seconds)
        engine.seek(to: target)
        elapsed = target
        publish()
    }

    /// Ends playback and drops the queue; the mini player goes away.
    func stop() {
        endRun()
        queue = nil
        currentIndex = 0
        cursor = 0
        isPlaying = false
        elapsed = 0
        duration = nil
        resumeAfterInterruption = false
        nowPlaying.publish(nil)
        session.deactivate()
    }

    func handle(_ command: RemoteCommand) {
        switch command {
        case .play: resume()
        case .pause: pause()
        case .toggle: togglePlayPause()
        case .next: next()
        case .previous: previous()
        case .seek(let seconds): seek(to: seconds)
        }
    }

    // MARK: System events

    /// A call or another app took the audio. Resumes after it ends only when the system says to.
    func handle(_ event: InterruptionEvent) {
        switch event {
        case .began:
            resumeAfterInterruption = isPlaying
            if isPlaying {
                engine.pause()
                isPlaying = false
                publish()
            }
        case .ended(let shouldResume):
            let wasPlaying = resumeAfterInterruption
            resumeAfterInterruption = false
            if shouldResume, wasPlaying { resume() }
        }
    }

    /// Headphones out: pause, and stay paused.
    func handle(_ event: RouteChangeEvent) {
        guard event == .builtInSpeaker else { return }
        resumeAfterInterruption = false
        pause()
    }

    // MARK: Running the queue

    private func setUpOnce() {
        guard !isSetUp else { return }
        isSetUp = true
        session.onInterruption = { [weak self] in self?.handle($0) }
        session.onRouteChange = { [weak self] in self?.handle($0) }
        engine.onProgress = { [weak self] elapsed, duration in
            guard let self else { return }
            self.elapsed = elapsed
            if let duration, duration > 0 { self.duration = duration }
        }
        remote.register { [weak self] in self?.handle($0) }
    }

    private func skip(to index: Int) {
        cursor = index
        isSkipping = true
        elapsed = 0
        engine.stop()
    }

    /// Cancels the run and ends the item in the engine, which closes its folder access.
    private func endRun() {
        runner?.cancel()
        runner = nil
        isSkipping = false
        engine.stop()
    }

    private func run() async {
        while !Task.isCancelled, let queue, queue.tracks.indices.contains(cursor) {
            let index = cursor
            cursor = index + 1
            currentIndex = index
            let track = queue.tracks[index]
            elapsed = 0
            duration = track.durationSec
            isSkipping = false
            let end = await playItem(track)
            if Task.isCancelled { return }
            if end == .stopped, !isSkipping { break }
        }
        if !Task.isCancelled { stop() }
    }

    /// One item with its folder access held for as long as it plays; always closed on the way out.
    private func playItem(_ track: Track) async -> PlaybackEnd {
        do {
            let end = try await access.withFile(for: track) { [self] url -> PlaybackEnd in
                guard let url else {
                    missingTrackIDs.insert(track.id)
                    return .failed
                }
                missingTrackIDs.remove(track.id)
                isPlaying = true
                publish()
                return await engine.play(url: url)
            }
            return end
        } catch {
            // The folder is not reachable (lost bookmark): the item can't play, move on.
            missingTrackIDs.insert(track.id)
            return .failed
        }
    }

    private func publish() {
        guard let queue, let track = currentTrack else { return }
        nowPlaying.publish(NowPlayingInfo(
            title: track.title, artist: queue.release.artist, album: queue.release.title,
            artwork: coverData(queue.release), duration: duration ?? track.durationSec, elapsed: elapsed, isPlaying: isPlaying
        ))
    }
}
