import SwiftUI

/// Top-level switch: onboarding until Spotify's folder is connected, then
/// the app's four tabs. Reads `FolderStatus` from the environment so it
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

    /// Set by the Stats tab when an artist is opened, so the Library shows just their releases.
    /// `LibraryView` puts it in its search box and clears it.
    @State private var librarySearchRequest: String?

    /// The one-time line after the move into the brand folder (#335); nil once dismissed.
    @State private var migrationNotice: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    enum Tab: Int {
        case library = 0, importSong = 1, settings = 2, stats = 3
    }

    var body: some View {
        VStack(spacing: 0) {
            // In the layout above the tabs, not over them: the Library's cloud button sits at the
            // very top and must stay reachable.
            if let migrationNotice {
                MigrationNoticeBanner(text: migrationNotice) { self.migrationNotice = nil }
                    .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
            }
            tabsOrOnboarding
        }
        .background(Theme.background)
        .animation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(duration: 0.35), value: migrationNotice)
    }

    @ViewBuilder
    private var tabsOrOnboarding: some View {
        Group {
            if !folderStatus.isConnected || !hasFinishedOnboarding {
                OnboardingView { hasFinishedOnboarding = true }
            } else {
                TabView(selection: $selectedTab) {
                    LibraryView(selectedTab: $selectedTab, requestedImportKind: $requestedImportKind, librarySearchRequest: $librarySearchRequest)
                        .environment(\.isTabSelected, selectedTab == .library)
                        .tabItem { Label(Copy.Library.title, image: "Icon/Library") }
                        .tag(Tab.library)

                    ImportView(requestedKind: $requestedImportKind)
                        .environment(\.isTabSelected, selectedTab == .importSong)
                        .tabItem { Label(Copy.Import.title, image: "Icon/Plus") }
                        .tag(Tab.importSong)

                    StatsTab(selectedTab: $selectedTab, librarySearchRequest: $librarySearchRequest)
                        .environment(\.isTabSelected, selectedTab == .stats)
                        .tabItem { Label(Copy.Stats.tabLabel, image: "Icon/Stats") }
                        .tag(Tab.stats)

                    SettingsView()
                        .environment(\.isTabSelected, selectedTab == .settings)
                        .tabItem { Label(Copy.Settings.title, systemImage: "gearshape") }
                        .tag(Tab.settings)
                }
                .tint(Theme.accent)
                .environment(\.openSettingsTab, { selectedTab = .settings })
            }
        }
        .background(Theme.background)
        .task(id: folderStatus.isConnected) {
            guard folderStatus.isConnected, let container else { return }
            if let moved = await container.coordinator.migrateIntoBrandFolder(), moved > 0 {
                let text = Copy.Settings.songsMoved(count: moved)
                migrationNotice = text
                AccessibilityNotification.Announcement(text).post()
                // Left up for VoiceOver users, who need time to hear and act on it.
                guard !UIAccessibility.isVoiceOverRunning else { return }
                try? await Task.sleep(for: .seconds(8))
                if !Task.isCancelled, migrationNotice == text { migrationNotice = nil }
            }
        }
        .onAppear {
            // A returning user with a stored bookmark skips onboarding entirely.
            if folderStatus.isConnected { hasFinishedOnboarding = true }
            container?.syncEngine.startAutoReconcile()
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                container?.syncEngine.startAutoReconcile()
            } else {
                container?.syncEngine.stopAutoReconcile()
            }
        }
    }
}

/// The one-time "moved N songs" line (#335): a tap dismisses it.
struct MigrationNoticeBanner: View {
    let text: String
    let onDismiss: () -> Void

    var body: some View {
        Button(action: onDismiss) {
            Text(text)
                .themeFont(.body, weight: .semibold)
                .foregroundStyle(Theme.primaryText)
                .multilineTextAlignment(.leading)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.Immersive.panelFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, Theme.Spacing.pagePadding)
        .accessibilityLabel(text)
        .accessibilityHint(Copy.Settings.dismissHint)
        .accessibilityAction(named: Copy.Settings.dismissAction, onDismiss)
        .padding(.top, 8)
    }
}

#if DEBUG
extension RootView {
    /// DEBUG only: the app's tabs with the "moved N songs" banner already showing (gallery `root-banner`).
    init(demoNotice: String?) {
        self.init()
        _migrationNotice = State(initialValue: demoNotice)
    }
}
#endif
