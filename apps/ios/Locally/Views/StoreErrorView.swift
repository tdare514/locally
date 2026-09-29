import SwiftUI

/// Shown at launch when the library index can't be opened. Offers a retry
/// and, behind a confirmation, a reset that moves the index aside (see
/// `ModelStore.moveAside`).
struct StoreErrorView: View {
    let detail: String
    let onRetry: () -> Void
    let onReset: () -> Void

    @State private var showResetConfirm = false

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            VStack(spacing: Theme.Spacing.sectionGap) {
                Spacer()

                VStack(spacing: Theme.Spacing.labelGap) {
                    Text(Copy.StoreError.title)
                        .font(Theme.Font.pageTitle)
                        .foregroundStyle(Theme.primaryText)
                        .multilineTextAlignment(.center)
                    Text(Copy.StoreError.body)
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.secondaryText)
                        .multilineTextAlignment(.center)
                    Text(Copy.StoreError.detail(detail))
                        .font(Theme.Font.rowSubtitle)
                        .foregroundStyle(Theme.danger)
                        .multilineTextAlignment(.center)
                }

                Spacer()

                VStack(spacing: Theme.Spacing.labelGap) {
                    Button(Copy.StoreError.tryAgain, action: onRetry)
                        .buttonStyle(PrimaryPillButtonStyle())
                    Button(Copy.StoreError.reset) { showResetConfirm = true }
                        .buttonStyle(SecondaryPillButtonStyle(isDestructive: true))
                }
            }
            .padding(Theme.Spacing.pagePadding)
        }
        .alert(Copy.StoreError.resetTitle, isPresented: $showResetConfirm) {
            Button(Copy.StoreError.resetConfirm, role: .destructive, action: onReset)
            Button(Copy.StoreError.resetCancel, role: .cancel) {}
        } message: {
            Text(Copy.StoreError.resetMessage)
        }
    }
}
