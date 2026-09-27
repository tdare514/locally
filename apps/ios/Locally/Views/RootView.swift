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

    /// The selected tab index, shared with `LibraryView` so its "Add a song"
    /// actions can switch to the Import tab (the `TabView` has no other
    /// shared selection to hook into). Library is tab 0: it is the home of
    /// the app, and its empty state is the first-run onboarding.
    @State private var selectedTab = Tab.library

    /// Set by the library's empty state so the Import tab opens on the flow
    /// the user chose (single or album). `ImportView` clears it once applied.
    @State private var requestedImportKind: ImportKind?

    enum Tab: Int {
        case library = 0, importSong = 1, settings = 2
    }

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
                    LibraryView(selectedTab: $selectedTab, requestedImportKind: $requestedImportKind)
                        .tabItem { Label(Copy.Library.title, systemImage: "music.note.list") }
                        .tag(Tab.library)

                    ImportView(requestedKind: $requestedImportKind)
                        .tabItem { Label(Copy.Import.title, systemImage: "plus.circle") }
                        .tag(Tab.importSong)

                    SettingsView()
                        .tabItem { Label(Copy.Settings.title, systemImage: "gearshape") }
                        .tag(Tab.settings)
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
