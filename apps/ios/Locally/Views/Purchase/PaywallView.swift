import SwiftUI

/// The "Locally Full" sheet, opened from Settings. Locally Full doesn't
/// gate any current feature (see `Entitlements`) — buying it supports
/// development and unlocks features as they ship, and this view says so
/// rather than promising anything it can't back up yet.
struct PaywallView: View {
    @Environment(\.appContainer) private var container
    @Environment(\.dismiss) private var dismiss

    @State private var product: PurchaseProduct?
    @State private var isPurchasing = false
    @State private var isRestoring = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Spacer()

                Image(systemName: "seal.fill")
                    .font(.system(size: 40))
                    .foregroundStyle(Theme.accent)

                Text(Copy.Purchase.title)
                    .font(.title2.bold())
                    .foregroundStyle(Theme.primaryText)

                Text(Copy.Purchase.body)
                    .foregroundStyle(Theme.secondaryText)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                }

                Button {
                    Task { await buy() }
                } label: {
                    if isPurchasing {
                        ProgressView().tint(.white)
                    } else {
                        Text(Copy.Purchase.buyLabel(price: product?.displayPrice))
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .disabled(isPurchasing || isRestoring || product == nil)

                Button(Copy.Purchase.restore) {
                    Task { await restore() }
                }
                .foregroundStyle(Theme.accent)
                .disabled(isPurchasing || isRestoring)

                Spacer()
            }
            .padding(24)
            .frame(maxWidth: .infinity)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(Copy.Purchase.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(Copy.Purchase.close) { dismiss() }
                        .foregroundStyle(Theme.primaryText)
                }
            }
        }
        .task { await loadProduct() }
    }

    private func loadProduct() async {
        guard let container else { return }
        do {
            product = try await container.purchase.loadProduct()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func buy() async {
        guard let container else { return }
        errorMessage = nil
        isPurchasing = true
        defer { isPurchasing = false }

        do {
            let unlocked = try await container.purchase.purchase()
            await container.refreshPurchaseStatus()
            if unlocked { dismiss() }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func restore() async {
        guard let container else { return }
        errorMessage = nil
        isRestoring = true
        defer { isRestoring = false }

        do {
            let unlocked = try await container.purchase.restore()
            await container.refreshPurchaseStatus()
            if unlocked { dismiss() }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
