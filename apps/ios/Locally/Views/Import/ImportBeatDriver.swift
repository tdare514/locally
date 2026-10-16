import SwiftUI

/// The cover beat's state for the Import tab (#205), owned by `ImportView` and shared by the
/// single and the album record so switching kind never replays or loses it. It holds the
/// `ImportBeat` reducer's state and the start time, and answers which `Frame` the sleeve draws at
/// a given moment: nil with no cover (the sleeve shows "Add cover art" and the peeking disc), live
/// frames while the beat plays, `.rest` once it has ended. It dispatches `.end` after the beat's
/// length and applies the cover's colours to the backdrop at `washAt`; a new cover cancels both.
@Observable @MainActor
final class ImportBeatDriver {
    /// Whether the sleeve has left beat mode for Send, so the ceremony plays as on the release page.
    enum SendPhase: Equatable {
        case idle
        case left
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

    init() {}

    var isPlaying: Bool { ImportBeat.isPlaying(state) }

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
        sendPhase = .idle
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
        sendPhase = .idle
        cover = nil
        washedCover = nil
    }

    // MARK: Send

    /// Send tapped: the disc already sits in the release page's pose, so a running beat jumps to
    /// its end and the sleeve leaves beat mode at once.
    func leaveBeatForSend() {
        skip()
        if state.hasCover { sendPhase = .left }
    }

    /// The send failed: the sleeve goes back to beat mode (the disc rests at 0 degrees).
    func sendFailed() {
        sendPhase = .idle
    }

    // MARK: Frame

    /// What the sleeve draws at `date`, or nil for the plain sleeve.
    func frame(at date: Date, reduced: Bool) -> ImportBeat.Frame? {
        guard state.hasCover else { return nil }
        if sendPhase == .left { return nil }
        guard isPlaying, let startedAt else { return .rest }
        return ImportBeat.frame(at: date.timeIntervalSince(startedAt) * 1000, reduced: reduced)
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
