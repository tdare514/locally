import Foundation
import Testing
@testable import Locally

/// `ImportBeatDriver` (#205): the shared beat's state around `ImportBeat`'s reducer.
@MainActor
struct ImportBeatDriverTests {
    private let cover = Data([1, 2, 3])
    private let other = Data([4, 5, 6])

    @Test func noCoverGivesNoFrame() {
        let driver = ImportBeatDriver()
        #expect(driver.frame(at: Date(), reduced: false) == nil)
        #expect(!driver.isPlaying)
    }

    @Test func aCoverStartsTheBeatAndAReplacementPlaysItAgain() {
        let driver = ImportBeatDriver()
        driver.coverChanged(cover, reduced: false)
        #expect(driver.isPlaying)
        #expect(driver.state.run == 1)
        #expect(!driver.state.replay)
        #expect(driver.frame(at: Date(), reduced: false) != .rest)

        driver.coverChanged(other, reduced: false)
        #expect(driver.state.run == 2)
        #expect(driver.state.replay)
        #expect(driver.isPlaying)
        // The replaced cover's colours wait for the wash.
        #expect(driver.washedCover == nil)
    }

    @Test func skipLandsAtRestWithTheColoursApplied() {
        let driver = ImportBeatDriver()
        driver.coverChanged(cover, reduced: false)
        driver.skip()
        #expect(!driver.isPlaying)
        #expect(driver.state.skipped)
        #expect(driver.frame(at: Date(), reduced: false) == .rest)
        #expect(driver.washedCover == cover)
    }

    @Test func removingTheCoverResets() {
        let driver = ImportBeatDriver()
        driver.coverChanged(cover, reduced: false)
        driver.skip()
        driver.coverChanged(nil, reduced: false)
        #expect(driver.frame(at: Date(), reduced: false) == nil)
        #expect(driver.washedCover == nil)
        #expect(!driver.state.hasCover)
    }

    @Test func theBeatEndsByItselfAndReducedMotionAppliesTheColoursAtOnce() async throws {
        let driver = ImportBeatDriver()
        driver.coverChanged(cover, reduced: true)
        #expect(driver.washedCover == cover)
        try await Task.sleep(for: .milliseconds(400))
        #expect(!driver.isPlaying)
        #expect(!driver.state.skipped)
        #expect(driver.frame(at: Date(), reduced: true) == .rest)
    }

    @Test func aNewCoverCancelsThePendingEnd() async throws {
        let driver = ImportBeatDriver()
        driver.coverChanged(cover, reduced: true)
        try await Task.sleep(for: .milliseconds(100))
        driver.coverChanged(other, reduced: true)
        try await Task.sleep(for: .milliseconds(100))
        // 200 ms in, but only 100 ms since the second cover: the first end must not have fired.
        #expect(driver.isPlaying)
    }

    @Test func sealForSendSealsThenSettlesAsSealed() async throws {
        let driver = ImportBeatDriver()
        driver.coverChanged(cover, reduced: false)
        driver.sealForSend(reduced: false)
        // A running beat jumps to its end first.
        #expect(!driver.isPlaying)
        #expect(driver.state.skipped)
        guard case .sealing = driver.sendPhase else {
            Issue.record("expected .sealing, got \(driver.sendPhase)")
            return
        }
        #expect(driver.isAnimating)
        #expect(driver.sealRemaining(reduced: false) > .zero)
        #expect(driver.frame(at: Date(), reduced: false)?.discIn ?? 1 < 0.5)

        try await Task.sleep(for: .milliseconds(1100))
        #expect(driver.sendPhase == .sealed)
        #expect(!driver.isAnimating)
        #expect(driver.sealRemaining(reduced: false) == .zero)
        #expect(driver.frame(at: Date(), reduced: false)?.discIn == 1)
    }

    @Test func sealForSendWithReduceMotionIsSealedAtOnce() {
        let driver = ImportBeatDriver()
        driver.coverChanged(cover, reduced: true)
        driver.sealForSend(reduced: true)
        #expect(driver.sendPhase == .sealed)
        #expect(!driver.isAnimating)
        #expect(driver.sealRemaining(reduced: true) == .zero)
        #expect(driver.frame(at: Date(), reduced: true)?.discIn == 1)
    }

    @Test func sendFailedUnsealsThenGoesIdle() async throws {
        let driver = ImportBeatDriver()
        driver.coverChanged(cover, reduced: false)
        driver.sealForSend(reduced: true)
        driver.sendFailed(reduced: false)
        guard case .unsealing = driver.sendPhase else {
            Issue.record("expected .unsealing, got \(driver.sendPhase)")
            return
        }
        #expect(driver.isAnimating)
        #expect(driver.frame(at: Date(), reduced: false)?.discIn ?? 0 > 0.5)

        try await Task.sleep(for: .milliseconds(750))
        #expect(driver.sendPhase == .idle)
        #expect(!driver.isAnimating)
        #expect(driver.frame(at: Date(), reduced: false) == .rest)
    }

    @Test func sendFailedWithReduceMotionIsIdleAtOnce() {
        let driver = ImportBeatDriver()
        driver.coverChanged(cover, reduced: true)
        driver.sealForSend(reduced: true)
        driver.sendFailed(reduced: true)
        #expect(driver.sendPhase == .idle)
        #expect(driver.frame(at: Date(), reduced: true) == .rest)
    }

    @Test func resetAndANewCoverEndTheSend() {
        let driver = ImportBeatDriver()
        driver.coverChanged(cover, reduced: true)
        driver.sealForSend(reduced: true)
        driver.coverChanged(other, reduced: true)
        #expect(driver.sendPhase == .idle)
        driver.sealForSend(reduced: true)
        driver.reset()
        #expect(driver.sendPhase == .idle)
        #expect(driver.frame(at: Date(), reduced: true) == nil)
    }
}
