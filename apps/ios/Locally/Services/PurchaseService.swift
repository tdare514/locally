import Foundation
import StoreKit

/// The one non-consumable Locally sells, as loaded from the store (or the
/// `Locally.storekit` test config when that's what the scheme is running
/// against). Kept as a plain struct, independent of `StoreKit.Product`, so
/// views and fakes never need to import StoreKit.
struct PurchaseProduct: Equatable {
    var id: String
    var displayName: String
    var displayPrice: String
}

/// Locally Full's one-time purchase: buy, restore, and the current
/// entitlement. Today it unlocks nothing (see `Entitlements`) — it exists so
/// supporting the app doesn't wait on the first paid feature, and so that
/// feature can gate on `isFullUnlocked` from day one.
///
/// `@MainActor`: `StoreKitPurchaseService` listens for `Transaction.updates`
/// and updates `isFullUnlocked` as they arrive, and every call site is
/// already on the main actor (views, `AppContainer`), so isolating the
/// protocol itself — rather than leaving `isFullUnlocked` nonisolated on a
/// main-actor class — keeps every witness's isolation consistent.
@MainActor
protocol PurchaseService {
    /// Whether a verified transaction for Locally Full exists. Reflects
    /// whatever `refreshEntitlement` (or a prior purchase/restore) last
    /// found; not itself observable — see `PurchaseStatus` for a type UI
    /// can bind to.
    var isFullUnlocked: Bool { get }
    func loadProduct() async throws -> PurchaseProduct?
    /// Starts the purchase flow. Returns `true` once a verified transaction
    /// lands, `false` if the user cancelled or the purchase is pending
    /// (e.g. "Ask to Buy"), and throws only on an unverifiable transaction
    /// or a StoreKit error.
    func purchase() async throws -> Bool
    /// Replays the account's past purchases via `AppStore.sync()`. Returns
    /// whether Locally Full is unlocked afterwards.
    func restore() async throws -> Bool
    /// Re-checks `Transaction.currentEntitlements` and updates
    /// `isFullUnlocked` accordingly.
    func refreshEntitlement() async
}

/// Production `PurchaseService`, backed by StoreKit 2. Verified transactions
/// only: an unverifiable one is treated as a failure rather than as an
/// unlock.
@MainActor
final class StoreKitPurchaseService: PurchaseService {
    static let productId = "com.tdare.locally.full"

    private(set) var isFullUnlocked = false
    private var cachedProduct: Product?
    private var updatesTask: Task<Void, Never>?

    init() {
        updatesTask = Task { [weak self] in
            for await update in Transaction.updates {
                await self?.handle(update)
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    func loadProduct() async throws -> PurchaseProduct? {
        let product = try await product()
        guard let product else { return nil }
        return PurchaseProduct(id: product.id, displayName: product.displayName, displayPrice: product.displayPrice)
    }

    func purchase() async throws -> Bool {
        guard let product = try await product() else {
            throw LocallyError.purchaseFailed("Couldn't find Locally Full to buy.")
        }

        let result: Product.PurchaseResult
        do {
            result = try await product.purchase()
        } catch {
            throw LocallyError.purchaseFailed(error.localizedDescription)
        }

        switch result {
        case .success(let verification):
            let transaction = try Self.checkVerified(verification)
            await transaction.finish()
            isFullUnlocked = true
            return true
        case .userCancelled, .pending:
            return false
        @unknown default:
            return false
        }
    }

    func restore() async throws -> Bool {
        do {
            try await AppStore.sync()
        } catch {
            throw LocallyError.purchaseFailed(error.localizedDescription)
        }
        await refreshEntitlement()
        return isFullUnlocked
    }

    func refreshEntitlement() async {
        for await result in Transaction.currentEntitlements {
            if let transaction = try? Self.checkVerified(result), transaction.productID == Self.productId {
                isFullUnlocked = true
                return
            }
        }
        isFullUnlocked = false
    }

    private func product() async throws -> Product? {
        if let cachedProduct { return cachedProduct }
        do {
            let products = try await Product.products(for: [Self.productId])
            cachedProduct = products.first
            return cachedProduct
        } catch {
            throw LocallyError.purchaseFailed(error.localizedDescription)
        }
    }

    private func handle(_ update: VerificationResult<Transaction>) async {
        guard let transaction = try? Self.checkVerified(update) else { return }
        if transaction.productID == Self.productId {
            isFullUnlocked = true
        }
        await transaction.finish()
    }

    private static func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified:
            throw LocallyError.purchaseFailed("Couldn't verify that purchase.")
        case .verified(let safe):
            return safe
        }
    }
}
