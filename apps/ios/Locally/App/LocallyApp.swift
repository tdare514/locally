import SwiftUI

/// App entry point: builds the one production `AppContainer` and injects it
/// into the view tree via `.environment`, so every view reaches services
/// through protocols rather than constructing anything itself.
@main
struct LocallyApp: App {
    @State private var container = AppContainer.production()

    init() {
        Theme.applyChrome()
    }

    var body: some Scene {
        WindowGroup {
            if Self.isHostingUnitTests {
                // The test bundle runs inside this app. Showing RootView would
                // start auto-reconcile with the simulator's real account and
                // hit the network mid-test, so the host stays inert.
                Color.clear
            } else {
                RootView()
                    .environment(\.appContainer, container)
                    .environment(container.folderStatus)
                    .environment(container.purchaseStatus)
                    .environment(container.syncStatus)
                    .preferredColorScheme(.dark)
            }
        }
    }

    /// True when XCTest has injected a test bundle into this process.
    private static var isHostingUnitTests: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    }
}
