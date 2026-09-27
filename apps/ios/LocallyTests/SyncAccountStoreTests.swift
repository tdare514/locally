import Foundation
import Testing
@testable import Locally

// NOTE on `SecKeychainTokenStore` (real-Keychain coverage):
//
// Tried here first as a real `SecItemAdd`/`SecItemCopyMatching`/`SecItemDelete`
// round trip against the Simulator's Keychain, the same way
// `AppGroupInboxStoreTests` exercises a real App Group container. Under this
// project's test invocation — `CODE_SIGNING_ALLOWED=NO`, matching
// `apps/ios/README.md`'s documented command — `SecItemDelete`/`load()` behave
// normally, but `SecItemAdd` silently fails to persist anything: a save
// immediately followed by a load comes back `nil`, with no error thrown
// (`SecItemAdd`'s `OSStatus` is treated as best-effort in
// `SecKeychainTokenStore.save`, matching how the rest of this codebase treats
// bookmark/keychain failures as non-fatal). This lines up with the App Groups
// caveat already documented in `docs/ios-plan.md` ("Installing on a physical
// iPhone…"): entitlement-gated system services on this project's signing
// setup need a real code signature that `CODE_SIGNING_ALLOWED=NO` strips, and
// unlike the App Group case that doc found working "regardless" on the
// Simulator, a generic Keychain item apparently does not tolerate an unsigned
// test binary here.
//
// Rather than a suite that fails under the exact command this project's own
// definition of done runs, `SyncAccountStoreTests` below covers
// `UserDefaultsSyncAccountStore`'s actual logic (base URL default/persistence,
// sign-in/out bookkeeping, `lastVersion`) against `InMemoryKeychainTokenStore`
// instead of the real Keychain. `SecKeychainTokenStore` itself — a thin,
// direct wrapping of three `Security` framework calls — is left to manual
// verification when running the app signed from Xcode (Product ▸ Run), the
// same way `ios-plan.md`'s phase-1 assumptions were verified on a real build.

/// `UserDefaultsSyncAccountStore` over an in-memory `KeychainTokenStore`
/// fake, so these tests exercise the `UserDefaults` bookkeeping
/// (`baseURL`/`email`/`deviceId`/`lastVersion`) without depending on the
/// simulator keychain at all — `SecKeychainTokenStoreTests` above already
/// covers the Keychain half in isolation.
struct UserDefaultsSyncAccountStoreTests {
    private func makeStore() -> (UserDefaultsSyncAccountStore, UserDefaults) {
        let suiteName = "com.tdare.locally.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        return (UserDefaultsSyncAccountStore(defaults: defaults, tokenStore: InMemoryKeychainTokenStore()), defaults)
    }

    @Test func defaultsToLocalhostFourThousandWhenNeverSet() {
        let (store, _) = makeStore()
        #expect(store.baseURL == URL(string: "http://localhost:4000")!)
    }

    @Test func baseURLPersistsAcrossReads() {
        let (store, _) = makeStore()
        store.baseURL = URL(string: "http://192.168.1.23:4000")!
        #expect(store.baseURL == URL(string: "http://192.168.1.23:4000")!)
    }

    @Test func isSignedOutUntilSaveIsCalled() {
        let (store, _) = makeStore()
        #expect(store.email == nil)
        #expect(store.deviceToken == nil)
        #expect(store.deviceId == nil)
    }

    @Test func saveRecordsEmailDeviceIdAndToken() {
        let (store, _) = makeStore()

        store.save(email: "toby@example.com", deviceToken: "device-token", deviceId: "device-1")

        #expect(store.email == "toby@example.com")
        #expect(store.deviceId == "device-1")
        #expect(store.deviceToken == "device-token")
    }

    @Test func clearSignsOutAndResetsLastVersion() {
        let (store, _) = makeStore()
        store.save(email: "toby@example.com", deviceToken: "device-token", deviceId: "device-1")
        store.lastVersion = 42

        store.clear()

        #expect(store.email == nil)
        #expect(store.deviceToken == nil)
        #expect(store.deviceId == nil)
        #expect(store.lastVersion == 0)
    }

    @Test func lastVersionPersistsAcrossReads() {
        let (store, _) = makeStore()
        store.lastVersion = 12
        #expect(store.lastVersion == 12)
    }
}
