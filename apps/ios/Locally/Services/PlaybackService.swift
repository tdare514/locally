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

/// One queued track and the release it belongs to. A queue can mix releases (a collection, #339).
struct QueueItem: Hashable, Codable {
    let releaseId: UUID
    let trackId: UUID
}

/// Where a queue came from; tapping the mini player opens it.
struct QueueContext: Hashable, Codable {
    /// `mixed`: tracks from elsewhere joined (play next, add to queue); `id` is the release playing when it did.
    enum Kind: String, Codable { case release, collection, mixed }
    let kind: Kind
    let id: UUID

    static func release(_ id: UUID) -> QueueContext { QueueContext(kind: .release, id: id) }
}

/// What a play next / add to queue did, for the confirmation toast.
struct QueueAddOutcome: Equatable {
    /// Items that joined the queue.
    var added: Int
    /// Items left out because they cannot play on this phone (adopted, details-only).
    var leftOut: Int
    /// True when there was no queue and the items started playing.
    var started: Bool
}

@MainActor
@Observable
final class PlaybackService {
    struct Queue: Equatable {
        var items: [QueueItem]
        /// The item playing (or paused).
        var index: Int
        var context: QueueContext
    }

    private(set) var queue: Queue?
    /// The releases the queued items belong to, by id. Each item is resolved from its own release.
    private var releases: [UUID: Release] = [:]
    private(set) var isPlaying = false
    private(set) var elapsed: Double = 0
    private(set) var duration: Double?
    /// Tracks whose file was gone when their turn came; the rows show "File missing".
    private(set) var missingTrackIDs: Set<UUID> = []
    /// Tracks the engine could not decode (a corrupt file); apart from `missingTrackIDs`, which means "File missing".
    private(set) var failedTrackIDs: Set<UUID> = []
    /// Missing or corrupt: what the collection page calls "Couldn't play this track".
    var wontPlayTrackIDs: Set<UUID> { missingTrackIDs.union(failedTrackIDs) }
    func wontPlay(_ trackID: UUID) -> Bool { missingTrackIDs.contains(trackID) || failedTrackIDs.contains(trackID) }
    /// Set when the audio session could not start; shown briefly where the mini player would be.
    private(set) var startError: String?
    /// Counts every start error, so the root can announce each one once, even a repeat of the same text.
    private(set) var startErrorCount = 0
    /// Set by the mini player; the Library opens that release's page and clears it.
    var openReleaseRequest: UUID?
    /// With `openReleaseRequest`: the playing track, which the release page highlights (#362).
    var openReleaseTrackRequest: UUID?
    /// Set by the mini player while a collection plays; the Library opens that collection's page and clears it.
    var openCollectionRequest: UUID?

    /// Tapping the mini player opens where the queue came from.
    func openContext() {
        guard let context = queue?.context else { return }
        switch context.kind {
        case .release:
            openReleaseTrackRequest = currentItem.flatMap { $0.releaseId == context.id ? $0.trackId : nil }
            openReleaseRequest = context.id
        case .collection: openCollectionRequest = context.id
        case .mixed: openReleaseRequest = currentItem?.releaseId
        }
    }

    @ObservationIgnored private let engine: PlaybackEngine
    @ObservationIgnored private let access: PlaybackFileAccess
    @ObservationIgnored private let session: PlaybackSession
    @ObservationIgnored private let nowPlaying: NowPlayingPublisher
    @ObservationIgnored private let remote: RemoteCommandRegistrar
    @ObservationIgnored private let coverData: (Release) -> Data?
    @ObservationIgnored private let playCounts: PlayCountStoring?
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var counter = PlayCounter()
    @ObservationIgnored private var runner: Task<Void, Never>?
    @ObservationIgnored private var cursor = 0
    @ObservationIgnored private var isSkipping = false
    @ObservationIgnored private var resumeAfterInterruption = false
    /// What the listener wants, apart from what the player is doing: set by a play and a resume, cleared by a
    /// pause, an interruption, headphones out and a stop. A file that finishes opening after a clear loads
    /// paused instead of starting audio.
    @ObservationIgnored private(set) var wantsToPlay = false
    /// True once the engine has been handed the current item.
    @ObservationIgnored private var itemLoaded = false
    /// Waits for `resume()` when an item finished opening while the listener didn't want audio.
    @ObservationIgnored private var intentWaiter: CheckedContinuation<Bool, Never>?
    @ObservationIgnored private var isSetUp = false
    /// Bumped whenever the item being opened is replaced (a skip, a stop, a new play), so a file-access
    /// callback that comes back late can tell it is no longer wanted and never starts audio.
    @ObservationIgnored private var runToken = 0
    /// The run token of the item whose audio has started; a tick from a cancelled run never counts.
    @ObservationIgnored private var countingToken: Int?
    @ObservationIgnored private var startErrorTask: Task<Void, Never>?

    init(
        engine: PlaybackEngine, access: PlaybackFileAccess, session: PlaybackSession,
        nowPlaying: NowPlayingPublisher, remote: RemoteCommandRegistrar, coverData: @escaping (Release) -> Data? = { _ in nil },
        playCounts: PlayCountStoring? = nil, now: @escaping () -> Date = Date.init
    ) {
        self.engine = engine
        self.access = access
        self.session = session
        self.nowPlaying = nowPlaying
        self.remote = remote
        self.coverData = coverData
        self.playCounts = playCounts
        self.now = now
    }

    // MARK: What the views read

    var hasQueue: Bool { queue != nil }
    var currentItem: QueueItem? {
        guard let queue, queue.items.indices.contains(queue.index) else { return nil }
        return queue.items[queue.index]
    }
    /// The playing item's own release and track, never "the queue's release".
    var currentTrack: Track? { currentItem.flatMap(track(for:)) }
    var currentRelease: Release? { currentItem.flatMap { releases[$0.releaseId] } }
    var cover: Data? { currentRelease.flatMap { coverData($0) } }

    private func track(for item: QueueItem) -> Track? {
        releases[item.releaseId]?.tracks.first { $0.id == item.trackId }
    }
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
        currentItem == QueueItem(releaseId: release.id, trackId: trackID)
    }

    /// A row's number: pause the playing track, resume the paused one, else start from this row.
    func tapRow(release: Release, trackID: UUID) {
        if isCurrent(trackID, in: release) {
            togglePlayPause()
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
        play(
            items: ordered[start...].map { QueueItem(releaseId: release.id, trackId: $0.id) },
            releases: [release], context: .release(release.id)
        )
    }

    /// Plays `items` in order from the first one, or from `startingAt`, a position in `items` (it follows its item
    /// through the filter below; an item that is left out starts the next playable one). `releases` holds every
    /// release the items name; an item whose release is missing, adopted or lacks the track is left out.
    func play(items: [QueueItem], releases newReleases: [Release], context: QueueContext, startingAt index: Int = 0) {
        let byID = Dictionary(newReleases.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let playableOffsets = items.indices.filter { offset in
            let item = items[offset]
            guard let release = byID[item.releaseId], Self.canPlay(release) else { return false }
            return release.tracks.contains { $0.id == item.trackId }
        }
        let playable = playableOffsets.map { items[$0] }
        let start = playableOffsets.firstIndex { $0 >= index } ?? 0
        guard playable.indices.contains(start) else { return }
        let first = playable[start]
        endRun()
        missingTrackIDs.remove(first.trackId)
        failedTrackIDs.remove(first.trackId)
        do {
            try session.activate()
        } catch {
            // Nothing from before stays on screen: the old queue goes, and a short line says why.
            stop()
            showStartError()
            return
        }
        startError = nil
        wantsToPlay = true
        setUpOnce()
        releases = byID
        counter.reset()
        queue = Queue(items: playable, index: start, context: context)
        cursor = start
        isSkipping = false
        runner = Task { [weak self] in await self?.run() }
    }

    // MARK: Play next and add to queue (#364)

    /// Inserts the playable `items`, in order, right after the playing item. The playing item is not touched.
    @discardableResult
    func playNext(_ items: [QueueItem], releases newReleases: [Release]) -> QueueAddOutcome {
        enqueue(items, releases: newReleases, atEnd: false)
    }

    /// Appends the playable `items` to the queue.
    @discardableResult
    func addToQueue(_ items: [QueueItem], releases newReleases: [Release]) -> QueueAddOutcome {
        enqueue(items, releases: newReleases, atEnd: true)
    }

    private func enqueue(_ items: [QueueItem], releases newReleases: [Release], atEnd: Bool) -> QueueAddOutcome {
        let byID = Dictionary(newReleases.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let playable = items.filter { item in
            guard let release = byID[item.releaseId], Self.canPlay(release) else { return false }
            return release.tracks.contains { $0.id == item.trackId }
        }
        let leftOut = items.count - playable.count
        guard let first = playable.first else { return QueueAddOutcome(added: 0, leftOut: leftOut, started: false) }
        guard let queue, queue.items.indices.contains(queue.index) else {
            let oneRelease = playable.allSatisfy { $0.releaseId == first.releaseId }
            let context = oneRelease ? QueueContext.release(first.releaseId) : QueueContext(kind: .mixed, id: first.releaseId)
            play(items: playable, releases: newReleases, context: context)
            return QueueAddOutcome(added: self.queue == nil ? 0 : playable.count, leftOut: leftOut, started: self.queue != nil)
        }
        for item in playable { releases[item.releaseId] = byID[item.releaseId] }
        // While a skip is under way the target at `cursor` is the item about to play; `queue.index` is still the old one.
        let current = isSkipping && queue.items.indices.contains(cursor) ? cursor : queue.index
        let at = atEnd ? queue.items.count : current + 1
        self.queue?.items.insert(contentsOf: playable, at: at)
        let stays = queue.context.kind == .release && playable.allSatisfy { $0.releaseId == queue.context.id }
        if !stays, let now = self.queue?.items[current].releaseId {
            self.queue?.context = QueueContext(kind: .mixed, id: now)
        }
        return QueueAddOutcome(added: playable.count, leftOut: leftOut, started: false)
    }

    func pause() {
        guard hasQueue else { return }
        wantsToPlay = false
        // An explicit pause also cancels any "resume when the interruption ends".
        resumeAfterInterruption = false
        guard isPlaying else { return }
        engine.pause()
        isPlaying = false
        publish()
    }

    func resume() {
        guard hasQueue else { return }
        wantsToPlay = true
        if let waiter = intentWaiter {
            // The item finished opening while paused: let it start now.
            intentWaiter = nil
            waiter.resume(returning: true)
            return
        }
        // Still opening (the open will see the intent), or already playing.
        guard itemLoaded, !isPlaying else { return }
        engine.resume()
        isPlaying = true
        publish()
    }

    func togglePlayPause() { wantsToPlay ? pause() : resume() }

    func next() {
        guard let queue else { return }
        if queue.index + 1 < queue.items.count {
            skip(to: queue.index + 1)
        } else {
            stop()
        }
    }

    /// Within the first 3 seconds it goes to the previous track, after that it restarts this one.
    func previous() {
        guard hasQueue else { return }
        if elapsed > 3 || (queue?.index ?? 0) == 0 {
            seek(to: 0)
        } else {
            skip(to: (queue?.index ?? 1) - 1)
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
        releases = [:]
        counter.reset()
        cursor = 0
        isPlaying = false
        wantsToPlay = false
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
            resumeAfterInterruption = wantsToPlay
            wantsToPlay = false
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
            self.countSample()
        }
        remote.register { [weak self] in self?.handle($0) }
    }

    private func showStartError() {
        startError = Copy.Playback.couldntStart
        startErrorCount += 1
        startErrorTask?.cancel()
        startErrorTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(4))
            if !Task.isCancelled { self?.startError = nil }
        }
    }

    func dismissStartError() {
        startErrorTask?.cancel()
        startError = nil
    }

    /// Ends the wait for a resume, telling the waiting item not to start.
    private func cancelIntentWait() {
        itemLoaded = false
        let waiter = intentWaiter
        intentWaiter = nil
        waiter?.resume(returning: false)
    }

    private func skip(to index: Int) {
        runToken += 1
        cancelIntentWait()
        cursor = index
        isSkipping = true
        elapsed = 0
        engine.stop()
    }

    /// Cancels the run and ends the item in the engine, which closes its folder access.
    private func endRun() {
        runToken += 1
        cancelIntentWait()
        runner?.cancel()
        runner = nil
        isSkipping = false
        engine.stop()
    }

    private func run() async {
        while !Task.isCancelled, let queue, queue.items.indices.contains(cursor) {
            let index = cursor
            cursor = index + 1
            self.queue?.index = index
            guard let track = track(for: queue.items[index]) else { continue }
            elapsed = 0
            duration = track.durationSec
            counter.reset()
            isSkipping = false
            itemLoaded = false
            let end = await playItem(track, token: runToken)
            if Task.isCancelled { return }
            if end == .stopped, !isSkipping { break }
        }
        if !Task.isCancelled { stop() }
    }

    /// One item with its folder access held for as long as it plays; always closed on the way out.
    private func playItem(_ track: Track, token: Int) async -> PlaybackEnd {
        do {
            let end = try await access.withFile(for: track) { [self] url -> PlaybackEnd in
                // A stop, skip or new play while the file was being opened: do nothing, the caller moves on.
                guard !Task.isCancelled, token == runToken else { return .stopped }
                guard let url else {
                    missingTrackIDs.insert(track.id)
                    return .failed
                }
                missingTrackIDs.remove(track.id)
                failedTrackIDs.remove(track.id)
                // Wait in a loop: every wake-up rechecks the intent, the run and cancellation, so a
                // `resume()` followed at once by a `pause()` (or headphones out) never reaches the engine.
                var announcedPaused = false
                while true {
                    guard !Task.isCancelled, token == runToken else { return .stopped }
                    if wantsToPlay { break }
                    if !announcedPaused {
                        // Paused (or interrupted, or headphones out) while the file was opening: the item
                        // waits here, paused at 0 with its access held, until a resume.
                        announcedPaused = true
                        isPlaying = false
                        publish()
                    }
                    let go: Bool = await withCheckedContinuation { intentWaiter = $0 }
                    if !go { return .stopped }
                }
                // Counting starts when the audio does: after any wait for a resume.
                countingToken = token
                isPlaying = true
                itemLoaded = true
                publish()
                let end = await engine.play(url: url)
                if end == .failed, !Task.isCancelled, token == runToken { failedTrackIDs.insert(track.id) }
                return end
            }
            return end
        } catch {
            // The folder is not reachable (lost bookmark): the item can't play, move on.
            guard !Task.isCancelled, token == runToken else { return .stopped }
            missingTrackIDs.insert(track.id)
            return .failed
        }
    }

    /// Feeds the counting rule; a play that counts is added for that item's own release and track.
    private func countSample() {
        guard let playCounts, let item = currentItem, countingToken == runToken else { return }
        // Nothing counts while the player is meant to be paused, whatever a late tick says.
        let playing = isPlaying && wantsToPlay
        let sample = PlaySample(at: now().timeIntervalSince1970, playing: playing, positionSec: elapsed, durationSec: duration ?? 0)
        if counter.push(sample), playing {
            playCounts.increment(releaseId: item.releaseId, trackId: item.trackId, at: now())
        }
    }

    private func publish() {
        guard let release = currentRelease, let track = currentTrack else { return }
        nowPlaying.publish(NowPlayingInfo(
            title: track.title, artist: release.artist, album: release.title,
            artwork: coverData(release), duration: duration ?? track.durationSec, elapsed: elapsed, isPlaying: isPlaying
        ))
    }
}
