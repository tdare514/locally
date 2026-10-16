import SwiftUI
import Testing
@testable import Locally

/// When a backdrop's drift runs (#160): only in the foreground, on the selected tab, with Low
/// Power Mode off.
struct BackdropMotionTests {
    @Test func runsInTheForegroundOnTheSelectedTabWithoutLowPower() {
        #expect(BackdropMotion.isActive(scenePhase: .active, isTabSelected: true, isLowPowerMode: false))
    }

    @Test(arguments: [ScenePhase.inactive, .background])
    func pausesOutsideTheForeground(phase: ScenePhase) {
        #expect(!BackdropMotion.isActive(scenePhase: phase, isTabSelected: true, isLowPowerMode: false))
    }

    @Test func pausesOnATabThatIsNotSelected() {
        #expect(!BackdropMotion.isActive(scenePhase: .active, isTabSelected: false, isLowPowerMode: false))
    }

    @Test func pausesInLowPowerMode() {
        #expect(!BackdropMotion.isActive(scenePhase: .active, isTabSelected: true, isLowPowerMode: true))
    }

    @Test(arguments: [
        (false, false, false), (false, true, false), (true, false, true), (true, true, false),
    ])
    func reducesMotionOnlyWhenTheSystemAsksAndTheSwitchIsOff(system: Bool, keepMoving: Bool, expected: Bool) {
        #expect(BackdropMotion.reducesMotion(systemReduceMotion: system, keepMoving: keepMoving) == expected)
    }
}
