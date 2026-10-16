import SwiftUI

/// The cover beat's state for the Import tab (#205), owned by `ImportView` and shared by the
/// single and the album record so switching kind never replays or loses it. It holds the
/// `ImportBeat` reducer's state and the start time, and answers which `Frame` the sleeve draws at
/// a given moment: nil with no cover (the sleeve shows "Add cover art" and the peeking disc), live
/// frames while the beat plays, `.rest` once it has ended. It dispatches `.end` after the beat's
/// length and applies the cover's colours to the backdrop at `washAt`; a new cover cancels both.
@Observable @MainActor
final class ImportBeatDriver {
    /// Where Send has the disc: peeking (`idle`), sliding into the sleeve, in it, or easing back
    /// out after a failed send. The sleeve stays in beat mode throughout.
    enum SendPhase: Equatable {
        case idle
        case sealing(since: Date)
        case sealed
        case unsealing(since: Date)
    }

    private(set) var state = ImportBeat.State.initial
    private(set) var startedAt: Date?
    private(set) var sendPhase = SendPhase.idle
    /// The cover whose colours the backdrop shows: the new cover once `washAt` has passed, so a
    /// replaced cover keeps its old colours until then. Nil when there is no cover.
    private(set) var washedCover: Data?

    @ObservationIgnored private var cover: Data?
    @ObservationIgnored private var endTask: Task<Void, Never>?
    @ObservationIgnored private var washTask: Task<Void, Never>?
    @ObservationIgnored private var sendTask: Task<Void, Never>?

    init() {}

    var isPlaying: Bool { ImportBeat.isPlaying(state) }

    /// The sleeve's frame is moving: the beat is playing, or the disc is sealing or unsealing.
    var isAnimating: Bool {
        switch sendPhase {
        case .sealing, .unsealing: true
        case .idle, .sealed: isPlaying
        }
    }

    // MARK: Events

    /// The user chose or cleared a cover (Files, Photos, a recent cover, Remove cover). Only
    /// this dispatches `.cover`; a kind switch copies the cover without calling it.
    func coverChanged(_ data: Data?, reduced: Bool) {
        cancelTasks()
        guard let data else {
            reset()
            return
        }
        state = ImportBeat.reduce(state, .cover)
        startedAt = Date()
        cancelSend()
        cover = data
        let wash = ImportBeat.washAt(reduced: reduced)
        if wash <= 0 {
            washedCover = data
        } else {
            washTask = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(wash))
                guard !Task.isCancelled else { return }
                self?.washedCover = data
            }
        }
        let end = ImportBeat.endAt(reduced: reduced)
        endTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(end))
            guard !Task.isCancelled, let self else { return }
            state = ImportBeat.reduce(state, .end)
        }
    }

    /// A tap or typing mid-beat: jump to the end, the colours at once.
    func skip() {
        guard isPlaying else { return }
        cancelTasks()
        state = ImportBeat.reduce(state, .skip)
        washedCover = cover
    }

    /// No cover any more (removed, or the record was saved and the page went back to the invitation).
    func reset() {
        cancelTasks()
        state = ImportBeat.reduce(state, .reset)
        startedAt = nil
        cancelSend()
        cover = nil
        washedCover = nil
    }

    // MARK: Send

    /// Send tapped: a running beat jumps to its end, then the disc slides all the way into the
    /// sleeve (at once with Reduce Motion).
    func sealForSend(reduced: Bool) {
        skip()
        sendTask?.cancel()
        guard !reduced else {
            sendPhase = .sealed
            return
        }
        sendPhase = .sealing(since: Date())
        sendTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(ImportBeat.sendSealDuration))
            guard !Task.isCancelled, let self else { return }
            sendPhase = .sealed
        }
    }

    /// The time left until the seal ends (zero once sealed, and with Reduce Motion).
    func sealRemaining(reduced: Bool) -> Duration {
        guard !reduced, case .sealing(let since) = sendPhase else { return .zero }
        let left = ImportBeat.sendSealDuration - Date().timeIntervalSince(since) * 1000
        return .milliseconds(max(0, left))
    }

    /// The send failed: the disc eases back out, then the sleeve is back at rest (at once with Reduce Motion).
    func sendFailed(reduced: Bool) {
        sendTask?.cancel()
        guard !reduced else {
            sendPhase = .idle
            return
        }
        sendPhase = .unsealing(since: Date())
        sendTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(ImportBeat.sendUnsealDuration))
            guard !Task.isCancelled, let self else { return }
            sendPhase = .idle
        }
    }

    // MARK: Frame

    /// What the sleeve draws at `date`, or nil for the plain sleeve. Send's seal and unseal show
    /// with or without a cover.
    func frame(at date: Date, reduced: Bool) -> ImportBeat.Frame? {
        switch sendPhase {
        case .sealing(let since):
            return ImportBeat.sendSealFrame(at: date.timeIntervalSince(since) * 1000, reduced: reduced)
        case .sealed:
            return ImportBeat.sendSealFrame(at: ImportBeat.sendSealDuration, reduced: reduced)
        case .unsealing(let since):
            return ImportBeat.sendUnsealFrame(at: date.timeIntervalSince(since) * 1000, reduced: reduced)
        case .idle:
            break
        }
        guard state.hasCover else { return nil }
        guard isPlaying, let startedAt else { return .rest }
        return ImportBeat.frame(at: date.timeIntervalSince(startedAt) * 1000, reduced: reduced)
    }

    private func cancelSend() {
        sendTask?.cancel()
        sendTask = nil
        sendPhase = .idle
    }

    private func cancelTasks() {
        endTask?.cancel()
        washTask?.cancel()
        endTask = nil
        washTask = nil
    }

    #if DEBUG
    /// The gallery: a record whose beat is over, with the backdrop already in the cover's colours.
    func showAtRest(cover data: Data) {
        cancelTasks()
        state = ImportBeat.State(hasCover: true, run: 1, ended: true, skipped: false, replay: false)
        cover = data
        washedCover = data
    }
    #endif
}
