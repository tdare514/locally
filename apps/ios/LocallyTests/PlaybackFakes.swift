import Foundation
@testable import Locally

/// A player that holds each item until the test ends it, and records what it was asked.
@MainActor
final class FakePlaybackEngine: PlaybackEngine {
    var onProgress: ((Double, Double?) -> Void)?
    private(set) var played: [URL] = []
    private(set) var pauseCount = 0
    private(set) var resumeCount = 0
    private(set) var seeks: [Double] = []
    private var continuation: CheckedContinuation<PlaybackEnd, Never>?

    func play(url: URL) async -> PlaybackEnd {
        played.append(url)
        return await withCheckedContinuation { continuation = $0 }
    }
    func pause() { pauseCount += 1 }
    func resume() { resumeCount += 1 }
    func seek(to seconds: Double) { seeks.append(seconds) }
    func stop() { end(.stopped) }

    /// Ends the item now playing, as the player would.
    func end(_ end: PlaybackEnd) {
        let pending = continuation
        continuation = nil
        pending?.resume(returning: end)
    }
}

/// Records every open and close, so a test can see access is held per item and always released.
final class FakePlaybackAccess: PlaybackFileAccess, @unchecked Sendable {
    struct Unreachable: Error {}
    var missing: Set<UUID> = []
    var unreachable: Set<UUID> = []
    private(set) var opened: [UUID] = []
    private(set) var closed: [UUID] = []
    private(set) var isOpen: Set<UUID> = []
    /// Holds every open this long (not cancellable), as a slow security-scoped bookmark resolve would.
    var delayMilliseconds: Int?

    func withFile<T>(for track: Track, _ body: (URL?) async -> T) async throws -> T {
        if unreachable.contains(track.id) { throw Unreachable() }
        opened.append(track.id)
        isOpen.insert(track.id)
        defer {
            closed.append(track.id)
            isOpen.remove(track.id)
        }
        if let delayMilliseconds {
            await withCheckedContinuation { continuation in
                DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(delayMilliseconds)) { continuation.resume() }
            }
        }
        return await body(missing.contains(track.id) ? nil : URL(fileURLWithPath: "/fake/\(track.filePath)"))
    }
}

@MainActor
final class FakePlaybackSession: PlaybackSession {
    var onInterruption: ((InterruptionEvent) -> Void)?
    var onRouteChange: ((RouteChangeEvent) -> Void)?
    struct ActivationFailed: Error {}
    var failsActivation = false
    private(set) var activations = 0
    private(set) var deactivations = 0
    func activate() throws {
        if failsActivation { throw ActivationFailed() }
        activations += 1
    }
    func deactivate() { deactivations += 1 }
}

@MainActor
final class FakeNowPlaying: NowPlayingPublisher {
    private(set) var published: [NowPlayingInfo?] = []
    func publish(_ info: NowPlayingInfo?) { published.append(info) }
}

@MainActor
final class FakeRemoteCommands: RemoteCommandRegistrar {
    private(set) var handler: ((RemoteCommand) -> Void)?
    func register(_ handler: @escaping (RemoteCommand) -> Void) { self.handler = handler }
}

/// Records every counted play, in order.
@MainActor
final class FakePlayCounts: PlayCountStoring {
    private(set) var increments: [QueueItem] = []
    func increment(releaseId: UUID, trackId: UUID, at date: Date) { increments.append(QueueItem(releaseId: releaseId, trackId: trackId)) }
    func pending(maxEntries: Int, maxDayRows: Int) -> [SyncPlayCount] { [] }
    func markPushed(_ sent: [SyncPlayCount]) {}
    func clearPushedMarkers() {}
    func count(releaseId: UUID, trackId: UUID) -> Int { increments.filter { $0.releaseId == releaseId && $0.trackId == trackId }.count }
}
