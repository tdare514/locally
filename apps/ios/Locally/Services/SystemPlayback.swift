import AVFoundation
import MediaPlayer

// The production pieces behind `PlaybackService`'s protocols (#336). None of this runs in the unit
// tests: the service is driven there with fakes. Everything is created lazily, so building the app
// container touches no audio hardware.

/// An `AVQueuePlayer` that holds the current item; `PlaybackService` hands it the next one when
/// this ends, so each file's security-scoped access spans exactly that item.
@MainActor
final class AVQueuePlayerEngine: PlaybackEngine {
    var onProgress: ((Double, Double?) -> Void)?

    private var player: AVQueuePlayer?
    private var timeObserver: Any?
    private var continuation: CheckedContinuation<PlaybackEnd, Never>?
    private var observers: [NSObjectProtocol] = []
    private var statusObservation: NSKeyValueObservation?
    /// Bumped by every play and every stop; a completion for an older number is ignored.
    private var generation = 0

    private func makePlayer() -> AVQueuePlayer {
        if let player { return player }
        let made = AVQueuePlayer()
        made.actionAtItemEnd = .pause
        timeObserver = made.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self, weak made] time in
            guard let self, let item = made?.currentItem else { return }
            let seconds = time.seconds
            let total = item.duration.seconds
            Task { @MainActor in
                self.onProgress?(seconds.isFinite ? seconds : 0, total.isFinite ? total : nil)
            }
        }
        player = made
        return made
    }

    func play(url: URL) async -> PlaybackEnd {
        let player = makePlayer()
        finish(.stopped)
        // Every completion below carries this play's number, so a late callback of an earlier item
        // (a skip came first) can never end this one.
        let mine = generation
        let item = AVPlayerItem(url: url)
        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.finish(.finished, generation: mine) }
            },
            center.addObserver(forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.finish(.failed, generation: mine) }
            },
        ]
        // Watched from before the item is inserted until this play ends: an item that can't be opened
        // (or fails later) reports through its status, not the end notifications.
        statusObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            guard item.status == .failed else { return }
            Task { @MainActor in self?.finish(.failed, generation: mine) }
        }
        return await withCheckedContinuation { continuation in
            self.continuation = continuation
            player.removeAllItems()
            player.insert(item, after: nil)
            player.play()
        }
    }

    func pause() { player?.pause() }
    func resume() { player?.play() }
    func seek(to seconds: Double) {
        player?.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }

    func stop() {
        player?.pause()
        player?.removeAllItems()
        finish(.stopped)
    }

    /// Ends the current play exactly once. With a `generation` it does nothing unless that play is still
    /// the current one; without one (a stop, or the next play) it ends whatever is playing.
    private func finish(_ end: PlaybackEnd, generation: Int? = nil) {
        if let generation, generation != self.generation { return }
        self.generation += 1
        observers.forEach(NotificationCenter.default.removeObserver)
        observers = []
        statusObservation?.invalidate()
        statusObservation = nil
        let pending = continuation
        continuation = nil
        pending?.resume(returning: end)
    }
}

/// `.playback`, activated on first play, with interruption and route-change events forwarded.
@MainActor
final class SystemPlaybackSession: PlaybackSession {
    var onInterruption: ((InterruptionEvent) -> Void)?
    var onRouteChange: ((RouteChangeEvent) -> Void)?
    private var observers: [NSObjectProtocol] = []

    func activate() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default)
        try session.setActive(true)
        guard observers.isEmpty else { return }
        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] note in
                let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init(rawValue:))
                let options = AVAudioSession.InterruptionOptions(rawValue: (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0)
                Task { @MainActor in
                    switch type {
                    case .began: self?.onInterruption?(.began)
                    case .ended: self?.onInterruption?(.ended(shouldResume: options.contains(.shouldResume)))
                    default: break
                    }
                }
            },
            center.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { [weak self] note in
                let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt).flatMap(AVAudioSession.RouteChangeReason.init(rawValue:))
                let onSpeaker = AVAudioSession.sharedInstance().currentRoute.outputs.contains { $0.portType == .builtInSpeaker }
                Task { @MainActor in
                    self?.onRouteChange?(reason == .oldDeviceUnavailable && onSpeaker ? .builtInSpeaker : .other)
                }
            },
        ]
    }

    func deactivate() {
        // Locally never tries to resume Spotify, so no `.notifyOthersOnDeactivation`.
        try? AVAudioSession.sharedInstance().setActive(false)
    }
}

@MainActor
final class SystemNowPlayingPublisher: NowPlayingPublisher {
    func publish(_ info: NowPlayingInfo?) {
        let center = MPNowPlayingInfoCenter.default()
        guard let info else {
            center.nowPlayingInfo = nil
            return
        }
        var dict: [String: Any] = [
            MPMediaItemPropertyTitle: info.title,
            MPMediaItemPropertyArtist: info.artist,
            MPMediaItemPropertyAlbumTitle: info.album,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: info.elapsed,
            MPNowPlayingInfoPropertyPlaybackRate: info.isPlaying ? 1.0 : 0.0,
        ]
        if let duration = info.duration { dict[MPMediaItemPropertyPlaybackDuration] = duration }
        if let data = info.artwork, let image = UIImage(data: data) {
            dict[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        }
        center.nowPlayingInfo = dict
    }
}

@MainActor
final class SystemRemoteCommands: RemoteCommandRegistrar {
    func register(_ handler: @escaping (RemoteCommand) -> Void) {
        let center = MPRemoteCommandCenter.shared()
        func bind(_ command: MPRemoteCommand, _ mapped: RemoteCommand) {
            command.isEnabled = true
            // The system calls these on its own queue: answer at once, then hop to the main actor.
            command.addTarget { _ in
                Task { @MainActor in handler(mapped) }
                return .success
            }
        }
        bind(center.playCommand, .play)
        bind(center.pauseCommand, .pause)
        bind(center.togglePlayPauseCommand, .toggle)
        bind(center.nextTrackCommand, .next)
        bind(center.previousTrackCommand, .previous)
        center.changePlaybackPositionCommand.isEnabled = true
        center.changePlaybackPositionCommand.addTarget { event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let position = event.positionTime
            Task { @MainActor in handler(.seek(position)) }
            return .success
        }
    }
}

extension PlaybackService {
    /// The app's player over the connected Spotify folder; the cover for the lock screen comes from `coverStore`.
    static func production(folder: SpotifyFolderAccess, coverStore: CoverStore, playCounts: PlayCountStoring? = nil) -> PlaybackService {
        PlaybackService(
            engine: AVQueuePlayerEngine(), access: SpotifyPlaybackFileAccess(folder: folder), session: SystemPlaybackSession(),
            nowPlaying: SystemNowPlayingPublisher(), remote: SystemRemoteCommands(), coverData: { coverStore.load($0.id) }, playCounts: playCounts
        )
    }
}

import SwiftUI

private struct PlaybackKey: EnvironmentKey {
    static let defaultValue: PlaybackService? = nil
}

extension EnvironmentValues {
    /// The app-wide player, injected beside `appContainer`.
    var playback: PlaybackService? {
        get { self[PlaybackKey.self] }
        set { self[PlaybackKey.self] = newValue }
    }
}
