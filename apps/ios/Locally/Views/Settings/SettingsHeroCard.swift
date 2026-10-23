import SwiftUI

/// The account card at the top of Settings (#160, direction A). Signed in: the avatar, email,
/// device, a "Synced 2 min ago" pill and Sync now / Sign out. Signed out: the same card offers the
/// two-step email-code sign-in from `spec/sync.md` instead. Sync errors show here in both states.
struct SettingsHeroCard: View {
    @Environment(\.appContainer) private var container
    @Environment(SyncStatus.self) private var syncStatus

    @State private var email = ""
    @State private var code = ""
    @State private var isSendingCode = false
    @State private var isSigningIn = false
    @State private var isSyncingNow = false
    @State private var formError: String?

    var body: some View {
        GlassCard(prominent: true) {
            VStack(alignment: .leading, spacing: 16) {
                switch SettingsHeroState(syncStatus) {
                case .signedIn(let email, let deviceName, let initial, let lastRunAt):
                    signedIn(email: email, deviceName: deviceName, initial: initial, lastRunAt: lastRunAt)
                case .signedOut:
                    signedOut
                }

                if let formError {
                    errorLine(formError)
                }
                if let lastError = syncStatus.lastError {
                    errorLine(lastError)
                }
            }
            .padding(18)
        }
    }

    private func errorLine(_ text: String) -> some View {
        Text(text)
            .font(Theme.ScaledFont.caption)
            .foregroundStyle(Theme.danger)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: - Signed in

    @ViewBuilder
    private func signedIn(email: String, deviceName: String?, initial: String?, lastRunAt: Date?) -> some View {
        AccountHeader(avatar: Avatar(initial: initial)) {
            VStack(alignment: .leading, spacing: 3) {
                Text(email)
                    .font(Theme.ScaledFont.headline)
                    .foregroundStyle(Theme.primaryText)
                    .addressLineLimit()
                if let deviceName {
                    Label(deviceName, systemImage: "iphone")
                        .font(Theme.ScaledFont.subheadline)
                        .foregroundStyle(Theme.secondaryText)
                }
            }
            .accessibilityElement(children: .combine)
        }
        // Redrawn each minute so "2 min ago" does not go stale on a screen left open. The time is
        // read fresh: a timeline's own date is the start of the minute, up to a minute behind.
        TimelineView(.everyMinute) { _ in
            SyncPill(text: SettingsHeroState.syncedText(lastRunAt: lastRunAt, now: Date()))
        }
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) { syncNowButton; signOutButton }
            VStack(spacing: 10) { syncNowButton; signOutButton }
        }
    }

    private var syncNowButton: some View {
        Button {
            Task { await syncNow() }
        } label: {
            if isSyncingNow {
                ProgressView().tint(.black)
            } else {
                Text(Copy.Sync.syncNow)
            }
        }
        .buttonStyle(HeroButtonStyle(isPrimary: true))
        .disabled(isSyncingNow)
        .accessibilityLabel(isSyncingNow ? Copy.Sync.syncing : Copy.Sync.syncNow)
    }

    private var signOutButton: some View {
        Button(Copy.Sync.signOut) {
            Task { await container?.syncEngine.signOut() }
        }
        .buttonStyle(HeroButtonStyle(isPrimary: false))
    }

    // MARK: - Signed out

    @ViewBuilder
    private var signedOut: some View {
        AccountHeader(avatar: Avatar(initial: nil)) {
            VStack(alignment: .leading, spacing: 3) {
                Text(Copy.Sync.cardTitle)
                    .font(Theme.ScaledFont.headline)
                    .foregroundStyle(Theme.primaryText)
                    .accessibilityAddTraits(.isHeader)
                Text(Copy.Sync.cardBody)
                    .font(Theme.ScaledFont.subheadline)
                    .foregroundStyle(Theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }

        if let sentTo = syncStatus.codeSentTo {
            Text("\(Copy.Sync.codeSentTo) \(sentTo)")
                .font(Theme.ScaledFont.caption)
                .foregroundStyle(Theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
            GlassField(label: Copy.Sync.codeFieldLabel, placeholder: Copy.Sync.codePlaceholder, text: $code, keyboardType: .numberPad, contentType: .oneTimeCode)
            Button {
                Task { await signIn() }
            } label: {
                if isSigningIn {
                    ProgressView().tint(.black)
                } else {
                    Text(Copy.Sync.signIn)
                }
            }
            .buttonStyle(HeroButtonStyle(isPrimary: true))
            .disabled(code.isEmpty || isSigningIn)
            .accessibilityLabel(isSigningIn ? Copy.Sync.signingIn : Copy.Sync.signIn)

            Button(Copy.Sync.useDifferentEmail) {
                syncStatus.codeSentTo = nil
                code = ""
                formError = nil
            }
            .buttonStyle(HeroButtonStyle(isPrimary: false))
        } else {
            GlassField(label: Copy.Sync.emailFieldLabel, placeholder: Copy.Sync.emailPlaceholder, text: $email, keyboardType: .emailAddress, contentType: .emailAddress)
            Button {
                Task { await sendCode() }
            } label: {
                if isSendingCode {
                    ProgressView().tint(.black)
                } else {
                    Text(Copy.Sync.sendCode)
                }
            }
            .buttonStyle(HeroButtonStyle(isPrimary: true))
            .disabled(email.isEmpty || isSendingCode)
            .accessibilityLabel(isSendingCode ? Copy.Sync.sending : Copy.Sync.sendCode)

            #if DEBUG
            DevelopmentServerField()
            #endif
        }
    }

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
}

// MARK: - Pieces

/// The avatar beside its text, or above it at accessibility text sizes, where a column beside the
/// avatar is too narrow to hold an email address or a device name.
private struct AccountHeader<Content: View>: View {
    let avatar: Avatar
    @ViewBuilder var content: () -> Content
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 12) {
                avatar
                content()
            }
        } else {
            HStack(spacing: 14) {
                avatar
                content()
                Spacer(minLength: 0)
            }
        }
    }
}

/// The account's stand-in until there is a user profile (#199): the email's initial on the accent
/// gradient, or the listener mark when there is no initial (signed out). Not editable.
private struct Avatar: View {
    let initial: String?
    @ScaledMetric(relativeTo: .title) private var side: CGFloat = 54

    var body: some View {
        Circle()
            .fill(LinearGradient(
                colors: [Theme.accent, Theme.Tint.violet],
                startPoint: .topLeading, endPoint: .bottomTrailing
            ))
            .frame(width: side, height: side)
            .overlay {
                if let initial {
                    Text(initial)
                        .font(.system(size: side * 0.42, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                } else {
                    Image("ListenerSolid")
                        .resizable()
                        .scaledToFit()
                        .padding(side * 0.18)
                }
            }
            .accessibilityHidden(true)
    }
}

/// "Synced 2 min ago" as a small capsule: a faint accent fill, no outline.
private struct SyncPill: View {
    let text: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "checkmark.circle.fill")
            Text(text)
        }
        .font(Theme.ScaledFont.pill)
        .foregroundStyle(Theme.Tint.accentText)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Capsule().fill(Theme.accent.opacity(0.16)))
        .accessibilityElement(children: .combine)
    }
}

/// The account card's buttons: an accent capsule with black text, or a faint white one.
private struct HeroButtonStyle: ButtonStyle {
    let isPrimary: Bool
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.ScaledFont.button)
            .foregroundStyle(isPrimary ? Color.black : Theme.primaryText)
            .frame(maxWidth: .infinity, minHeight: 42)
            .padding(.horizontal, 16)
            .background(Capsule().fill(isPrimary ? Theme.accent : Color.white.opacity(0.09)))
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.5)
    }
}

#if DEBUG
/// Development-only: lets the app owner point the client at the Mac's LAN address (e.g.
/// `http://192.168.1.23:4000`) instead of `localhost`, since a physical phone can't reach the
/// Mac's own loopback address.
struct DevelopmentServerField: View {
    @Environment(\.appContainer) private var container
    @State private var serverAddressText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.labelGap) {
            Text(Copy.Sync.serverAddress)
                .font(Theme.ScaledFont.caption)
                .foregroundStyle(Theme.secondaryText)
            GlassField(label: Copy.Sync.serverAddress, text: Binding(
                get: { serverAddressText },
                set: { newValue in
                    serverAddressText = newValue
                    if let url = URL(string: newValue), newValue.contains("://") {
                        let previous = container?.syncEngine.currentShareScope
                        container?.syncAccount.baseURL = url
                        // A new host signs the device out (the account store clears itself); drop the shares.
                        if let engine = container?.syncEngine, container?.syncAccount.deviceToken == nil, previous != nil {
                            engine.syncHostChanged(previousScope: previous)
                        }
                    }
                }
            ), keyboardType: .URL)
            Text(Copy.Sync.serverAddressHint)
                .font(Theme.ScaledFont.caption)
                .foregroundStyle(Theme.textHint)
        }
        .onAppear {
            serverAddressText = container?.syncAccount.baseURL.absoluteString ?? ""
        }
    }
}
#endif
