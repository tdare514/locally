import Foundation

/// A feature gated behind Locally Full. Empty for now: every current
/// feature (singles, albums, editing, deleting, unlimited sends) is free
/// because it concerns songs already sent, or sending itself, which has no
/// limit. Cases are added here as paid features ship, each one then wired
/// into `Entitlements.isFeatureAvailable` and the call site that checks it.
enum PaidFeature: CaseIterable {
    static var allCases: [PaidFeature] { [] }
}

/// Pure gate for paid features. With no `PaidFeature` cases yet, every
/// feature is available regardless of purchase state — there is nothing to
/// gate until `PaidFeature` gains its first case.
enum Entitlements {
    static func isFeatureAvailable(_ feature: PaidFeature, isFull: Bool) -> Bool {
        true
    }
}
