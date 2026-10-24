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
/// Two runs (a cancelled one and a new one) can be inside `withFile` at once, off the main actor, so
/// every piece of state sits behind one lock; the lock is never held across an `await`.
final class FakePlaybackAccess: PlaybackFileAccess, @unchecked Sendable {
    struct Unreachable: Error {}

    private struct State {
        var missing: Set<UUID> = []
        var unreachable: Set<UUID> = []
        var opened: [UUID] = []
        var closed: [UUID] = []
        var isOpen: Set<UUID> = []
        var delayMilliseconds: Int?
        var holdsOpens = false
        var held: [CheckedContinuation<Void, Never>] = []
    }

    private let lock = NSLock()
    private var state = State()

    private func locked<R>(_ body: (inout State) -> R) -> R {
        lock.lock()
        defer { lock.unlock() }
        return body(&state)
    }

    var missing: Set<UUID> {
        get { locked { $0.missing } }
        set { locked { $0.missing = newValue } }
    }
    var unreachable: Set<UUID> {
        get { locked { $0.unreachable } }
        set { locked { $0.unreachable = newValue } }
    }
    var opened: [UUID] { locked { $0.opened } }
    var closed: [UUID] { locked { $0.closed } }
    var isOpen: Set<UUID> { locked { $0.isOpen } }
    /// Holds every open this long (not cancellable), as a slow security-scoped bookmark resolve would.
    var delayMilliseconds: Int? {
        get { locked { $0.delayMilliseconds } }
        set { locked { $0.delayMilliseconds = newValue } }
    }
    /// While true, every open waits until the test calls `releaseHeldOpens()`: a gate the test opens itself.
    var holdsOpens: Bool {
        get { locked { $0.holdsOpens } }
        set { locked { $0.holdsOpens = newValue } }
    }

    /// Lets every held open go on, and stops holding new ones.
    func releaseHeldOpens() {
        let waiting: [CheckedContinuation<Void, Never>] = locked { state in
            state.holdsOpens = false
            let waiting = state.held
            state.held = []
            return waiting
        }
        waiting.forEach { $0.resume() }
    }

    /// How many opens are waiting at the gate.
    var heldCount: Int { locked { $0.held.count } }

    func withFile<T>(for track: Track, _ body: (URL?) async -> T) async throws -> T {
        if locked({ $0.unreachable.contains(track.id) }) { throw Unreachable() }
        locked {
            $0.opened.append(track.id)
            $0.isOpen.insert(track.id)
        }
        defer {
            locked {
                $0.closed.append(track.id)
                $0.isOpen.remove(track.id)
            }
        }
        if let delayMilliseconds = locked({ $0.delayMilliseconds }) {
            await withCheckedContinuation { continuation in
                DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(delayMilliseconds)) { continuation.resume() }
            }
        }
        if locked({ $0.holdsOpens }) {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                // The gate may have opened between the check and here.
                let open = locked { state -> Bool in
                    if state.holdsOpens { state.held.append(continuation); return false }
                    return true
                }
                if open { continuation.resume() }
            }
        }
        let isMissing = locked { $0.missing.contains(track.id) }
        return await body(isMissing ? nil : URL(fileURLWithPath: "/fake/\(track.filePath)"))
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
    func pending(liveReleases: Set<UUID>?, maxEntries: Int, maxDayRows: Int) -> [SyncPlayCount] { [] }
    func markPushed(_ sent: [SyncPlayCount]) {}
    func clearPushedMarkers() {}
    func count(releaseId: UUID, trackId: UUID) -> Int { increments.filter { $0.releaseId == releaseId && $0.trackId == trackId }.count }
}
