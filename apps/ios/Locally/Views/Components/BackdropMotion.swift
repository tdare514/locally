import SwiftUI

/// When a backdrop's slow drift may run (#160). `ArtworkBackdrop` redraws its gradients every
/// frame while it drifts, and a `TabView` keeps every tab it has shown alive, so the drift runs
/// only while the app is in the foreground, the backdrop's tab is the selected one, and Low Power
/// Mode is off. Reduce Motion stops it separately, in the backdrop itself.
enum BackdropMotion {
    static func isActive(scenePhase: ScenePhase, isTabSelected: Bool, isLowPowerMode: Bool) -> Bool {
        scenePhase == .active && isTabSelected && !isLowPowerMode
    }
}

private struct IsTabSelectedKey: EnvironmentKey {
    static let defaultValue = true
}

extension EnvironmentValues {
    /// Whether the tab this view is in is the selected one. `RootView` sets it per tab; anywhere
    /// else (a sheet, the component gallery) it stays true.
    var isTabSelected: Bool {
        get { self[IsTabSelectedKey.self] }
        set { self[IsTabSelectedKey.self] = newValue }
    }
}
