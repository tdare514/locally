import SwiftUI

/// The "Sync with your Mac" group under the account card (#160), shown only while signed in:
/// how much of the quota is used and "Delete sync account…" (with its confirm), then the merge
/// notice. The account itself, Sync now and Sign out live in `SettingsHeroCard`; signed out, the
/// card carries the sign-in and this group is not shown.
struct SyncSettingsSection: View {
    @Environment(\.appContainer) private var container
    @Environment(SyncStatus.self) private var syncStatus

    @State private var isDeletingAccount = false
    @State private var showDeleteAccountConfirm = false

    var body: some View {
        if syncStatus.signedIn {
            GlassSection(title: Copy.Sync.cardTitle, footnote: Copy.Sync.mergeNotice) {
                GlassCard {
                    if let quota = syncStatus.quota {
                        GlassRow(
                            symbol: "externaldrive.fill", tint: Theme.Tint.teal, title: Copy.Sync.storageLabel,
                            value: Copy.Sync.quota(usedMB: quota.usedBytes / 1_048_576, limitMB: quota.limitBytes / 1_048_576)
                        )
                        GlassDivider()
                    }
                    Button(role: .destructive) {
                        showDeleteAccountConfirm = true
                    } label: {
                        GlassRow(symbol: "trash.fill", tint: Theme.danger, title: Copy.Sync.deleteAccountButton, destructive: true)
                            .overlay(alignment: .trailing) {
                                if isDeletingAccount {
                                    ProgressView().tint(Theme.danger).padding(.trailing, 16)
                                }
                            }
                    }
                    .buttonStyle(SoftPressStyle())
                    .disabled(isDeletingAccount)

                    #if DEBUG
                    GlassDivider()
                    DevelopmentServerField().padding(16)
                    #endif
                }
            }
            .alert(Copy.Sync.deleteAccountTitle, isPresented: $showDeleteAccountConfirm) {
                Button(Copy.Sync.deleteAccountConfirm, role: .destructive) {
                    Task { await deleteAccount() }
                }
                Button(Copy.Sync.deleteAccountCancel, role: .cancel) {}
            } message: {
                Text(Copy.Sync.deleteAccountMessage)
            }
        }
    }

    private func deleteAccount() async {
        guard let container else { return }
        isDeletingAccount = true
        defer { isDeletingAccount = false }
        await container.syncEngine.deleteAccount()
    }
}
