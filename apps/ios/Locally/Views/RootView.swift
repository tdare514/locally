import SwiftUI

/// Top-level switch: onboarding until Spotify's folder is connected, then
/// the app's three tabs. Reads `FolderStatus` from the environment so it
/// updates the moment onboarding (or a reconnect in Settings) finishes.
struct RootView: View {
    @Environment(FolderStatus.self) private var folderStatus

    /// Onboarding ends on "Get started", not the moment the bookmark is
    /// stored, so the user actually sees the "Connected" confirmation.
    @State private var hasFinishedOnboarding = false

    var body: some View {
        Group {
            if !folderStatus.isConnected || !hasFinishedOnboarding {
                OnboardingView { hasFinishedOnboarding = true }
            } else {
                TabView {
                    ImportSingleView()
                        .tabItem { Label(Copy.Import.title, systemImage: "plus.circle") }

                    LibraryView()
                        .tabItem { Label(Copy.Library.title, systemImage: "music.note.list") }

                    SettingsView()
                        .tabItem { Label(Copy.Settings.title, systemImage: "gearshape") }
                }
                .tint(Theme.accent)
            }
        }
        .background(Theme.background)
        .onAppear {
            // A returning user with a stored bookmark skips onboarding entirely.
            if folderStatus.isConnected { hasFinishedOnboarding = true }
        }
    }
}
