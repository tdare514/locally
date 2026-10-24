import SwiftUI

/// Whether the record player's animated parts (the spin and the wheel's turning) may run (#352): the scene is active and
/// the phone is not in Low Power Mode (the backdrops' rule, `BackdropMotion.isActive`), the screen is showing and the
/// wheel is in view, and Reduce Motion is off.
enum WheelMotion {
    #if DEBUG
    /// Debug only: the gallery's Reduce Motion frame (the system setting can't be set from a view).
    static let debugReduceMotionKey = "debugWheelReduceMotion"
    #endif

    static func isAnimated(scenePhase: ScenePhase, isScreenShowing: Bool, isLowPowerMode: Bool, isInView: Bool, reduceMotion: Bool) -> Bool {
        BackdropMotion.isActive(scenePhase: scenePhase, isTabSelected: isScreenShowing, isLowPowerMode: isLowPowerMode) && isInView && !reduceMotion
    }

    static func spins(isPlaying: Bool, isAnimated: Bool) -> Bool { isPlaying && isAnimated }
}
