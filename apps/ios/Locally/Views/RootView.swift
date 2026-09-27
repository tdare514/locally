import SwiftUI

/// Top-level switch: onboarding until Spotify's folder is connected, then
/// the app's three tabs. Reads `FolderStatus` from the environment so it
/// updates the moment onboarding (or a reconnect in Settings) finishes.
struct RootView: View {
    @Environment(FolderStatus.self) private var folderStatus

    var body: some View {
        Group {
            if !folderStatus.isConnected {
                OnboardingView()
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
    }
}
