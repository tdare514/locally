import Foundation
import SwiftUI
import Testing
@testable import Locally

/// The record player's pure parts (#352): a port of the Mac's `record-player.ts`, so the same collections sit in the same order.
struct RecordWheelTests {
    @Test func wrapDTakesTheShortestWayRoundAnEndlessWheel() {
        #expect(RecordWheel.wrapD(1, 0, 24) == 1)
        #expect(RecordWheel.wrapD(23, 0, 24) == -1)
        #expect(RecordWheel.wrapD(0, 23, 24) == 1)
        #expect(RecordWheel.wrapD(12, 0, 24) == 12)
        #expect(RecordWheel.wrapD(2, 0.5, 24) == 1.5)
    }

    @Test func theFrontRowIsLevelAtFullSizeOnTheDial() throws {
        let pose = try #require(RecordWheel.rowPose(0))
        #expect(pose.x == 182)
        #expect(pose.y == 0)
        #expect(pose.scale == 1)
        #expect(pose.opacity == 1)
    }

    @Test func eachStepRoundIsDrawnAtPointEightSevenOfTheOneBefore() throws {
        let one = try #require(RecordWheel.rowPose(1))
        let two = try #require(RecordWheel.rowPose(2))
        #expect(abs(one.scale - 0.87) < 1e-9)
        #expect(abs(two.scale - 0.87 * 0.87) < 1e-9)
        // Rows below the front sit lower, rows above sit higher, mirrored.
        let above = try #require(RecordWheel.rowPose(-1))
        #expect(one.y > 0 && above.y == -one.y)
    }

    @Test func rowsFadePastFiftyDegreesAndAboutSevenShow() {
        #expect(RecordWheel.fadeOpacity(0.84) == 1)
        #expect(abs(RecordWheel.fadeOpacity(0.85 + 0.25) - 0.5) < 1e-9)
        #expect(RecordWheel.fadeOpacity(-1.35) == 0)
        let shown = (-RecordWheel.maxSteps...RecordWheel.maxSteps).filter { (RecordWheel.rowPose(Double($0))?.opacity ?? 0) >= 0.9 }
        #expect(shown.count == 7)
    }

    @Test func aRowFarFromTheFrontIsNotDrawn() {
        #expect(RecordWheel.rowPose(7) == nil)
        #expect(RecordWheel.rowPose(-100) == nil)
    }

    @Test func theWindowHoldsTheSameFewRowsWhateverTheCount() {
        #expect(RecordWheel.windowIndexes(0, 200).count == 15)
        #expect(RecordWheel.windowIndexes(0, 20).count == 15)
        #expect(RecordWheel.windowIndexes(0, 200) == Array(Set(RecordWheel.windowIndexes(0, 200))).sorted { RecordWheel.windowIndexes(0, 200).firstIndex(of: $0)! < RecordWheel.windowIndexes(0, 200).firstIndex(of: $1)! })
        #expect(RecordWheel.windowIndexes(0, 5).sorted() == [0, 1, 2, 3, 4])
        #expect(RecordWheel.windowIndexes(0, 0).isEmpty)
        // It wraps past both ends.
        #expect(RecordWheel.windowIndexes(0, 200).contains(199))
        #expect(RecordWheel.windowIndexes(199, 200).contains(0))
    }

    @Test func theWindowFollowsTheRoundedPositionAndTheFrontWraps() {
        #expect(RecordWheel.frontIndex(0.5, 24) == 1)
        #expect(RecordWheel.frontIndex(-0.5, 24) == 0)
        #expect(RecordWheel.frontIndex(-1, 24) == 23)
        #expect(RecordWheel.frontIndex(24, 24) == 0)
        #expect(RecordWheel.frontIndex(3, 0) == 0)
    }

    @Test func turnTargetTakesTheShortestWayInTheWheelsOwnCount() {
        #expect(RecordWheel.turnTarget(3, from: 0, 24) == 3)
        #expect(RecordWheel.turnTarget(23, from: 0, 24) == -1)
        #expect(RecordWheel.turnTarget(0, from: 23, 24) == 24)
    }

    @Test func aDragTurnsByRowsAndSnapsToTheNearestRow() {
        // Finger up (negative) moves forward.
        #expect(RecordWheel.dragPosition(start: 2, translation: -64, pitch: 64) == 3)
        #expect(RecordWheel.snapTarget(start: 2, predictedTranslation: -90, pitch: 64) == 3)
        #expect(RecordWheel.snapTarget(start: 2, predictedTranslation: 20, pitch: 64) == 2)
        // A flick is capped.
        #expect(RecordWheel.snapTarget(start: 0, predictedTranslation: -100_000, pitch: 64) == 8)
        #expect(RecordWheel.snapTarget(start: 0, predictedTranslation: 100_000, pitch: 64) == -8)
    }

    @Test func captionsAndTheSpokenValue() {
        #expect(RecordWheel.durationLabel(6960) == "1 hr 56 min")
        #expect(RecordWheel.durationLabel(1440) == "24 min")
        #expect(RecordWheel.durationLabel(7200) == "2 hr")
        #expect(RecordWheel.durationLabel(nil).isEmpty)
        #expect(RecordWheel.hubCount(0, 24) == "1 of 24")
        #expect(RecordWheel.spokenValue(name: "Late drives", tracks: 27, totalSec: 6960, state: "playing", front: 0, count: 24)
            == "Late drives, 27 tracks, 1 hr 56 min, playing, 1 of 24")
        #expect(RecordWheel.spokenValue(name: "Gym", tracks: 1, totalSec: nil, state: nil, front: 4, count: 24) == "Gym, 1 track, 5 of 24")
    }

    @Test func sideACarriesTheExtraTrack() {
        #expect(CollectionQueue.sideACount(27) == 14)
        #expect(CollectionQueue.sideACount(4) == 2)
        #expect(CollectionQueue.sideACount(1) == 1)
    }
}

struct RecordSpinTests {
    @Test func theRecordTurnsThreeHundredThirtyThreeRpm() {
        let start = Date(timeIntervalSince1970: 1000)
        #expect(abs(RecordSpin.angle(accumulated: 0, startedAt: start, now: start.addingTimeInterval(1.8)) - 360) < 0.001)
    }

    @Test func aPausedRecordStaysAtItsAngleAndResumesFromIt() {
        let start = Date(timeIntervalSince1970: 1000)
        let paused = RecordSpin.angle(accumulated: 10, startedAt: start, now: start.addingTimeInterval(0.5))
        #expect(paused == 110)
        #expect(RecordSpin.angle(accumulated: paused, startedAt: nil, now: start.addingTimeInterval(99)) == 110)
        let resumed = start.addingTimeInterval(100)
        #expect(RecordSpin.angle(accumulated: paused, startedAt: resumed, now: resumed.addingTimeInterval(0.5)) == 210)
    }
}

struct WheelMotionTests {
    @Test func theSpinAndTheWheelStopWhenAnythingSaysStop() {
        func animated(scene: ScenePhase = .active, showing: Bool = true, lowPower: Bool = false, inView: Bool = true, reduce: Bool = false) -> Bool {
            WheelMotion.isAnimated(scenePhase: scene, isScreenShowing: showing, isLowPowerMode: lowPower, isInView: inView, reduceMotion: reduce)
        }
        #expect(animated())
        #expect(!animated(scene: .inactive))
        #expect(!animated(scene: .background))
        #expect(!animated(lowPower: true))
        #expect(!animated(showing: false))
        #expect(!animated(inView: false))
        #expect(!animated(reduce: true))
        #expect(WheelMotion.spins(isPlaying: true, isAnimated: true))
        #expect(!WheelMotion.spins(isPlaying: false, isAnimated: true))
        #expect(!WheelMotion.spins(isPlaying: true, isAnimated: false))
    }
}

struct CollectionsViewPrefsTests {
    @Test func theChoicesDefaultToRecordPlayerAndPictureDisc() {
        #expect(CollectionsViewMode(storedRaw: nil) == .player)
        #expect(CollectionsViewMode(storedRaw: "list") == .list)
        #expect(CollectionsViewMode(storedRaw: "nonsense") == .player)
        #expect(SpinningRecord(storedRaw: nil) == .picture)
        #expect(SpinningRecord(storedRaw: "vinyl") == .vinyl)
        #expect(SpinningRecord(storedRaw: "") == .picture)
    }
}
