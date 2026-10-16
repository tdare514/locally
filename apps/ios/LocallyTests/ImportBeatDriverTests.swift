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

    @Test func sendLeavesBeatModeAtOnce() {
        let driver = ImportBeatDriver()
        driver.coverChanged(cover, reduced: false)
        driver.skip()
        driver.leaveBeatForSend()
        #expect(driver.sendPhase == .left)
        #expect(driver.frame(at: Date(), reduced: false) == nil)

        driver.sendFailed()
        #expect(driver.frame(at: Date(), reduced: false) == .rest)
    }

    @Test func sendWithReduceMotionLeavesBeatModeAtOnce() {
        let driver = ImportBeatDriver()
        driver.coverChanged(cover, reduced: true)
        driver.leaveBeatForSend()
        #expect(driver.sendPhase == .left)
    }
}
