import SwiftUI

/// App entry point: builds the one production `AppContainer` (or shows `StoreErrorView` if the library index won't open) and injects it
/// into the view tree via `.environment`, so every view reaches services
/// through protocols rather than constructing anything itself.
@main
struct LocallyApp: App {
    @State private var launch = LaunchState.open()
    @State private var queueToast = QueueToastCenter()

    init() {
        Theme.applyChrome()
    }

    var body: some Scene {
        WindowGroup {
            if let gallery = Self.componentGallery {
                gallery
            } else if Self.isHostingUnitTests {
                // The test bundle runs inside this app. Showing RootView would
                // start auto-reconcile with the simulator's real account and
                // hit the network mid-test, so the host stays inert.
                Color.clear
            } else {
                switch launch {
                case .ready(let container):
                    RootView()
                        .environment(\.appContainer, container)
                        .environment(\.playback, container.playback)
                        .environment(\.queueToast, queueToast)
                        .environment(container.folderStatus)
                        .environment(container.purchaseStatus)
                        .environment(container.syncStatus)
                        .preferredColorScheme(.dark)
                case .failed(let detail):
                    StoreErrorView(
                        detail: detail,
                        onRetry: { launch = LaunchState.open() },
                        onReset: { launch = LaunchState.resetAndOpen() }
                    )
                    .preferredColorScheme(.dark)
                }
            }
        }
    }

    /// DEBUG only: `-componentGallery <name>` shows one immersive component for screenshots.
    private static var componentGallery: AnyView? {
        #if DEBUG
        if let name = UserDefaults.standard.string(forKey: "componentGallery") {
            return AnyView(ComponentGallery(name: name))
        }
        #endif
        return nil
    }

    /// True when XCTest has injected a test bundle into this process.
    private static var isHostingUnitTests: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    }
}
