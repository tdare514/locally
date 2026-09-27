import Testing
@testable import Locally

/// Locally Full doesn't gate any current feature — singles, albums,
/// editing, deleting and unlimited sends are all free. `PaidFeature` has no
/// cases yet, so there's nothing for `Entitlements.isFeatureAvailable` to
/// actually gate; this just pins that invariant so adding the first paid
/// feature is a deliberate, visible change here.
struct EntitlementsTests {
    @Test func noPaidFeaturesExistYet() {
        #expect(PaidFeature.allCases.isEmpty)
    }
}
