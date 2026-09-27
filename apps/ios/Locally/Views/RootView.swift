import SwiftUI

/// Top-level switch: onboarding until Spotify's folder is connected, then
/// the app's three tabs. Reads `FolderStatus` from the environment so it
/// updates the moment onboarding (or a reconnect in Settings) finishes.
struct RootView: View {
    @Environment(\.appContainer) private var container
    @Environment(FolderStatus.self) private var folderStatus
    @Environment(\.scenePhase) private var scenePhase

    /// Onboarding ends on "Get started", not the moment the bookmark is
    /// stored, so the user actually sees the "Connected" confirmation.
    @State private var hasFinishedOnboarding = false

    /// The selected tab index, shared with `LibraryView` so its sticky
    /// "Add a song" footer button can switch to the Add a song tab (the
    /// `TabView` has no other shared selection to hook into).
    @State private var selectedTab = 0

    /// Runs `SyncEngine.reconcile()` immediately, then every 30 seconds while
    /// the app is in the foreground, per `spec/sync.md` ("on foreground,
    /// on a timer while the app is open"). `reconcile()` itself no-ops when
    /// signed out, so this loop is harmless to keep running regardless.
    @State private var reconcileTask: Task<Void, Never>?

    var body: some View {
        Group {
            if !folderStatus.isConnected || !hasFinishedOnboarding {
                OnboardingView { hasFinishedOnboarding = true }
            } else {
                TabView(selection: $selectedTab) {
                    ImportView()
                        .tabItem { Label(Copy.Import.title, systemImage: "plus.circle") }
                        .tag(0)

                    LibraryView(selectedTab: $selectedTab)
                        .tabItem { Label(Copy.Library.title, systemImage: "music.note.list") }
                        .tag(1)

                    SettingsView()
                        .tabItem { Label(Copy.Settings.title, systemImage: "gearshape") }
                        .tag(2)
                }
                .tint(Theme.accent)
            }
        }
        .background(Theme.background)
        .onAppear {
            // A returning user with a stored bookmark skips onboarding entirely.
            if folderStatus.isConnected { hasFinishedOnboarding = true }
            startReconcileLoop()
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                startReconcileLoop()
            } else {
                reconcileTask?.cancel()
            }
        }
    }

    private func startReconcileLoop() {
        guard let container else { return }
        reconcileTask?.cancel()
        reconcileTask = Task {
            while !Task.isCancelled {
                await container.syncEngine.reconcile()
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }
}
