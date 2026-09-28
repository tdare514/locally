import Foundation

/// Runs `tick` immediately, then again every `interval` while the app is in
/// the foreground, per `spec/sync.md` ("on foreground, on a timer while the
/// app is open"). Owned by `SyncEngine` (`startAutoReconcile`/
/// `stopAutoReconcile`) rather than by a view, so the loop's lifetime isn't
/// tied to a particular view being on screen.
@MainActor
final class ReconcileScheduler {
    private let interval: Duration
    private let sleep: @Sendable (Duration) async throws -> Void
    private let tick: @MainActor () async -> Void

    private var loopTask: Task<Void, Never>?

    init(
        interval: Duration,
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        tick: @escaping @MainActor () async -> Void
    ) {
        self.interval = interval
        self.sleep = sleep
        self.tick = tick
    }

    var isRunning: Bool { loopTask != nil }

    /// Cancels any loop already running, then starts a fresh one: tick
    /// immediately, sleep, tick again, and so on until cancelled or `sleep`
    /// throws (e.g. `Task.sleep` cancellation).
    func start() {
        loopTask?.cancel()
        loopTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                await self.tick()
                guard !Task.isCancelled else { break }
                do {
                    try await self.sleep(self.interval)
                } catch {
                    break
                }
            }
        }
    }

    func stop() {
        loopTask?.cancel()
        loopTask = nil
    }
}
