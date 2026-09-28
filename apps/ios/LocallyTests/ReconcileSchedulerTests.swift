import Foundation
import Testing
@testable import Locally

@MainActor
struct ReconcileSchedulerTests {
    @Test func startTicksImmediatelyThenAgainAfterEachSleep() async throws {
        let sleepGate = SleepGate()
        let tickCount = TickCount()

        let scheduler = ReconcileScheduler(
            interval: .seconds(30),
            sleep: { _ in await sleepGate.wait() },
            tick: { await tickCount.increment() }
        )

        scheduler.start()
        await sleepGate.waitUntilEntered()
        #expect(await tickCount.value == 1, "ticks immediately, before any sleep")

        await sleepGate.resumeAndWaitUntilEnteredAgain()
        #expect(await tickCount.value == 2, "ticks again once the sleep resumes")

        scheduler.stop()
        await sleepGate.resume()
        // Give the (now-cancelled) loop a beat to prove it does NOT tick again.
        try await Task.sleep(for: .milliseconds(50))
        #expect(await tickCount.value == 2, "stop() ends the loop with no further ticks")
    }

    @Test func stopEndsAnInFlightLoopEvenMidSleep() async throws {
        let sleepGate = SleepGate()
        let tickCount = TickCount()

        let scheduler = ReconcileScheduler(
            interval: .seconds(30),
            sleep: { _ in await sleepGate.wait() },
            tick: { await tickCount.increment() }
        )

        #expect(scheduler.isRunning == false)
        scheduler.start()
        #expect(scheduler.isRunning == true)
        await sleepGate.waitUntilEntered()

        scheduler.stop()
        #expect(scheduler.isRunning == false)
        await sleepGate.resume()
        try await Task.sleep(for: .milliseconds(50))

        #expect(await tickCount.value == 1)
    }
}

private actor TickCount {
    private(set) var value = 0
    func increment() { value += 1 }
}

/// A repeatable version of the gate pattern used in `SyncEngineTests`: each
/// `wait()` call blocks until `resume()` (or `resumeAndWaitUntilEnteredAgain()`)
/// is called, and `waitUntilEntered()` lets a test know a `wait()` call is
/// currently suspended.
private actor SleepGate {
    private var entered = false
    private var enteredContinuation: CheckedContinuation<Void, Never>?
    private var resumeContinuation: CheckedContinuation<Void, Never>?

    func wait() async {
        entered = true
        enteredContinuation?.resume()
        enteredContinuation = nil
        await withCheckedContinuation { continuation in
            resumeContinuation = continuation
        }
    }

    func waitUntilEntered() async {
        if entered { return }
        await withCheckedContinuation { continuation in
            enteredContinuation = continuation
        }
    }

    func resume() {
        entered = false
        resumeContinuation?.resume()
        resumeContinuation = nil
    }

    /// Resumes the current `wait()` and then waits for the loop to call
    /// `wait()` again (i.e. for the next tick to happen and the loop to
    /// sleep once more).
    func resumeAndWaitUntilEnteredAgain() async {
        resume()
        await waitUntilEntered()
    }
}
