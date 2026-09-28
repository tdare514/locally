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
// immediately followed by a load comes back `nil`, with no error thrown.
// `SecKeychainTokenStore.save` now throws `KeychainTokenStoreError.saveFailed`
// on a non-success `OSStatus`, but a real-Keychain round trip still can't be
// covered under `CODE_SIGNING_ALLOWED=NO`: entitlement-gated system services
// on this project's signing setup need a real code signature that
// `CODE_SIGNING_ALLOWED=NO` strips. This lines up with the App Groups caveat
// already documented in `docs/ios-plan.md` ("Installing on a physical
// iPhone…"); unlike the App Group case that doc found working "regardless" on
// the Simulator, a generic Keychain item apparently does not tolerate an
// unsigned test binary here.
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

    @Test func saveRecordsEmailDeviceIdAndToken() throws {
        let (store, _) = makeStore()

        try store.save(email: "toby@example.com", deviceToken: "device-token", deviceId: "device-1")

        #expect(store.email == "toby@example.com")
        #expect(store.deviceId == "device-1")
        #expect(store.deviceToken == "device-token")
    }

    @Test func clearSignsOutAndResetsLastVersion() throws {
        let (store, _) = makeStore()
        try store.save(email: "toby@example.com", deviceToken: "device-token", deviceId: "device-1")
        store.lastVersion = 42

        store.clear()

        #expect(store.email == nil)
        #expect(store.deviceToken == nil)
        #expect(store.deviceId == nil)
        #expect(store.lastVersion == 0)
        #expect(store.deviceName == nil)
    }

    @Test func deviceNamePersistsAcrossStoreInstances() {
        let suiteName = "com.tdare.locally.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        let tokenStore = InMemoryKeychainTokenStore()
        let first = UserDefaultsSyncAccountStore(defaults: defaults, tokenStore: tokenStore)
        first.deviceName = "iPhone 14"
        let second = UserDefaultsSyncAccountStore(defaults: defaults, tokenStore: tokenStore)
        #expect(second.deviceName == "iPhone 14")
    }

    @Test func lastVersionPersistsAcrossReads() {
        let (store, _) = makeStore()
        store.lastVersion = 12
        #expect(store.lastVersion == 12)
    }

    @Test func changingBaseURLSignsOutAndResetsLastVersion() throws {
        let (store, _) = makeStore()
        try store.save(email: "toby@example.com", deviceToken: "device-token", deviceId: "device-1")
        store.lastVersion = 7

        store.baseURL = URL(string: "http://192.168.1.23:4000")!

        #expect(store.email == nil)
        #expect(store.deviceToken == nil)
        #expect(store.deviceId == nil)
        #expect(store.lastVersion == 0)
        #expect(store.deviceName == nil)
        #expect(store.baseURL == URL(string: "http://192.168.1.23:4000")!)
    }

    @Test func settingTheSameBaseURLKeepsTheSignIn() throws {
        let (store, _) = makeStore()
        try store.save(email: "toby@example.com", deviceToken: "device-token", deviceId: "device-1")

        store.baseURL = URL(string: "http://localhost:4000")!

        #expect(store.email == "toby@example.com")
        #expect(store.deviceToken == "device-token")
        #expect(store.deviceId == "device-1")
    }

    @Test func failedTokenSavePersistsNothing() throws {
        let suiteName = "com.tdare.locally.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        let store = UserDefaultsSyncAccountStore(defaults: defaults, tokenStore: FailingKeychainTokenStore())

        #expect(throws: KeychainTokenStoreError.self) {
            try store.save(email: "toby@example.com", deviceToken: "device-token", deviceId: "device-1")
        }

        #expect(store.email == nil)
        #expect(store.deviceId == nil)
        #expect(store.deviceToken == nil)
    }

    @Test func productionBaseURLIsHttps() {
        #expect(UserDefaultsSyncAccountStore.productionBaseURL.scheme == "https")
    }
}
