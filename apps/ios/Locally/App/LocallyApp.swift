import SwiftUI

/// App entry point: builds the one production `AppContainer` and injects it
/// into the view tree via `.environment`, so every view reaches services
/// through protocols rather than constructing anything itself.
@main
struct LocallyApp: App {
    @State private var container = AppContainer.production()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(\.appContainer, container)
                .environment(container.folderStatus)
                .environment(container.purchaseStatus)
                .preferredColorScheme(.dark)
        }
    }
}
