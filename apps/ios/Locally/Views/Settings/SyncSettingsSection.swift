import SwiftUI

/// The Settings "Sync with your Mac" card from `spec/sync.md`: signed out,
/// it's an email field and a two-step code sign-in; signed in, it shows the
/// account, device, quota, "Sync now"/"Sign out", the last run/error, and
/// (development builds only) a field for the Mac's LAN address, since a
/// physical phone can't reach the Mac's own `localhost`.
struct SyncSettingsSection: View {
    @Environment(\.appContainer) private var container
    @Environment(SyncStatus.self) private var syncStatus

    @State private var email = ""
    @State private var code = ""
    @State private var isSendingCode = false
    @State private var isSigningIn = false
    @State private var isSyncingNow = false
    @State private var formError: String?
    @State private var serverAddressText = ""
    @State private var isDeletingAccount = false
    @State private var showDeleteAccountConfirm = false

    var body: some View {
        Section {
            if syncStatus.signedIn {
                signedInContent
            } else {
                signedOutContent
            }

            if let formError {
                Text(formError)
                    .font(Theme.Font.rowSubtitle)
                    .foregroundStyle(Theme.danger)
            }
            if let lastError = syncStatus.lastError {
                Text(lastError)
                    .font(Theme.Font.rowSubtitle)
                    .foregroundStyle(Theme.danger)
            }
        } header: {
            Text(Copy.Sync.cardTitle).eyebrow()
        } footer: {
            if !syncStatus.signedIn {
                Text(Copy.Sync.cardBody)
                    .font(Theme.Font.rowSubtitle)
                    .foregroundStyle(Theme.secondaryText)
            }
        }
        .listRowBackground(Theme.card)
        .onAppear {
            serverAddressText = container?.syncAccount.baseURL.absoluteString ?? ""
        }
    }

    // MARK: - Signed out

    @ViewBuilder
    private var signedOutContent: some View {
        if syncStatus.codeSentTo != nil {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(Copy.Sync.codeSentTo) \(syncStatus.codeSentTo ?? "")")
                    .font(Theme.Font.rowSubtitle)
                    .foregroundStyle(Theme.secondaryText)
            }
            Field(Copy.Sync.codeFieldLabel, placeholder: Copy.Sync.codePlaceholder, text: $code, keyboardType: .numberPad)
            Button {
                Task { await signIn() }
            } label: {
                if isSigningIn {
                    ProgressView().tint(.black)
                } else {
                    Text(Copy.Sync.signIn)
                }
            }
            .buttonStyle(PrimaryPillButtonStyle())
            .disabled(code.isEmpty || isSigningIn)

            Button(Copy.Sync.useDifferentEmail) {
                syncStatus.codeSentTo = nil
                code = ""
                formError = nil
            }
            .buttonStyle(TextButtonStyle())
        } else {
            Field(Copy.Sync.emailFieldLabel, placeholder: Copy.Sync.emailPlaceholder, text: $email, keyboardType: .emailAddress)
            Button {
                Task { await sendCode() }
            } label: {
                if isSendingCode {
                    ProgressView().tint(.black)
                } else {
                    Text(Copy.Sync.sendCode)
                }
            }
            .buttonStyle(PrimaryPillButtonStyle())
            .disabled(email.isEmpty || isSendingCode)

            #if DEBUG
            developmentServerField
            #endif
        }
    }

    // MARK: - Signed in

    private var signedInContent: some View {
        VStack(alignment: .leading, spacing: 10) {
            LabeledContent(Copy.Sync.emailFieldLabel, value: syncStatus.email ?? "")
            LabeledContent(Copy.Sync.deviceLabel, value: syncStatus.deviceName ?? "")
            if let quota = syncStatus.quota {
                LabeledContent(Copy.Sync.storageLabel, value: Copy.Sync.quota(usedMB: quota.usedBytes / 1_048_576, limitMB: quota.limitBytes / 1_048_576))
            }
            Text(syncLastRunText)
                .font(Theme.Font.rowSubtitle)
                .foregroundStyle(Theme.secondaryText)
            Text(Copy.Sync.mergeNotice)
                .font(Theme.Font.rowSubtitle)
                .foregroundStyle(Theme.secondaryText)

            HStack(spacing: 12) {
                Button {
                    Task { await syncNow() }
                } label: {
                    if isSyncingNow {
                        ProgressView().tint(.black)
                    } else {
                        Text(Copy.Sync.syncNow)
                    }
                }
                .buttonStyle(PrimaryPillButtonStyle(isFullWidth: false))
                .disabled(isSyncingNow)

                Button(Copy.Sync.signOut) {
                    Task { await container?.syncEngine.signOut() }
                }
                .buttonStyle(SecondaryPillButtonStyle(isDestructive: true))
            }

            Button(role: .destructive) {
                showDeleteAccountConfirm = true
            } label: {
                if isDeletingAccount {
                    ProgressView().tint(Theme.danger)
                } else {
                    Text(Copy.Sync.deleteAccountButton)
                }
            }
            .buttonStyle(TextButtonStyle())
            .foregroundStyle(Theme.danger)
            .disabled(isDeletingAccount)

            #if DEBUG
            developmentServerField
            #endif
        }
        .font(Theme.Font.body)
        .foregroundStyle(Theme.primaryText)
        .alert(Copy.Sync.deleteAccountTitle, isPresented: $showDeleteAccountConfirm) {
            Button(Copy.Sync.deleteAccountConfirm, role: .destructive) {
                Task { await deleteAccount() }
            }
            Button(Copy.Sync.deleteAccountCancel, role: .cancel) {}
        } message: {
            Text(Copy.Sync.deleteAccountMessage)
        }
    }

    private var syncLastRunText: String {
        guard let lastRunAt = syncStatus.lastRunAt else { return Copy.Sync.neverSynced }
        let formatter = RelativeDateTimeFormatter()
        return Copy.Sync.lastSynced(formatter.localizedString(for: lastRunAt, relativeTo: Date()))
    }

    #if DEBUG
    /// Development-only: lets the app owner point the client at the Mac's
    /// LAN address (e.g. `http://192.168.1.23:4000`) instead of `localhost`,
    /// since a physical phone can't reach the Mac's own loopback address.
    private var developmentServerField: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.labelGap) {
            Field(Copy.Sync.serverAddress, text: Binding(
                get: { serverAddressText },
                set: { newValue in
                    serverAddressText = newValue
                    if let url = URL(string: newValue), newValue.contains("://") {
                        container?.syncAccount.baseURL = url
                    }
                }
            ), keyboardType: .URL)
            Text(Copy.Sync.serverAddressHint)
                .font(Theme.Font.dropZoneHint)
                .foregroundStyle(Theme.textHint)
        }
    }
    #endif

    // MARK: - Actions

    private func sendCode() async {
        guard let container else { return }
        formError = nil
        isSendingCode = true
        defer { isSendingCode = false }
        do {
            try await container.syncEngine.requestCode(email: email)
        } catch {
            formError = error.localizedDescription
        }
    }

    private func signIn() async {
        guard let container else { return }
        formError = nil
        isSigningIn = true
        defer { isSigningIn = false }
        do {
            try await container.syncEngine.verify(email: email, code: code)
            code = ""
        } catch {
            formError = error.localizedDescription
        }
    }

    private func syncNow() async {
        guard let container else { return }
        isSyncingNow = true
        defer { isSyncingNow = false }
        await container.syncEngine.reconcile()
    }

    private func deleteAccount() async {
        guard let container else { return }
        isDeletingAccount = true
        defer { isDeletingAccount = false }
        await container.syncEngine.deleteAccount()
    }
}
