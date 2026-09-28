import Foundation
import Security

/// Everything the sync feature needs to remember about the signed-in
/// account and this device: where the service lives, who's signed in, the
/// device's bearer token, and how far reconcile has read. Kept as a
/// protocol (mirroring every other service in the app) so `SyncEngine` and
/// the Settings UI never touch `UserDefaults`/Keychain directly, and tests
/// can substitute an in-memory fake.
protocol SyncAccountStore: AnyObject {
    /// Where the sync service lives. Defaults to `http://localhost:4000` in
    /// DEBUG builds (the API's own dev default — see
    /// `apps/api/src/server/config/env.ts`) and to
    /// `UserDefaultsSyncAccountStore.productionBaseURL` in release builds. A
    /// Settings field (development builds only) lets the owner point this at
    /// the Mac's LAN address instead, since a physical phone can't reach the
    /// Mac's `localhost`. Changing it signs the device out: the device token
    /// was issued by the old host and must not be sent to the new one.
    var baseURL: URL { get set }
    /// The signed-in account's email, or `nil` when signed out.
    var email: String? { get }
    /// This device's bearer token, or `nil` when signed out. Stored in the
    /// Keychain, never in `UserDefaults`.
    var deviceToken: String? { get }
    /// This device's id, as returned by `POST /v1/auth/verify`, used to
    /// revoke it from `DELETE /v1/devices/:id` on sign-out.
    var deviceId: String? { get }
    /// The last `version` reconcile saw from `GET /v1/releases`, so the next
    /// call only pages in what changed since. `0` before the first sync.
    var lastVersion: Int { get set }

    /// Records a successful `POST /v1/auth/verify`, making `email`,
    /// `deviceId` and `deviceToken` non-nil. Throws (and persists nothing)
    /// if the token can't be written to the Keychain, so a failed token
    /// write never leaves the account half signed-in.
    func save(email: String, deviceToken: String, deviceId: String) throws
    /// Signs this device out locally (does not itself call the server —
    /// `SyncEngine.signOut` revokes the device first, then calls this).
    func clear()
}

/// Production `SyncAccountStore`: the device token lives in the Keychain
/// (`KeychainTokenStore`); everything else — none of it a secret — lives in
/// `UserDefaults`, same pattern as `UserDefaultsSpotifyFolder`.
final class UserDefaultsSyncAccountStore: SyncAccountStore {
    #if DEBUG
    static let defaultBaseURL = URL(string: "http://localhost:4000")!
    #else
    static let defaultBaseURL = UserDefaultsSyncAccountStore.productionBaseURL
    #endif

    /// Placeholder until the sync API is deployed (issue #3). Must stay
    /// `https://` — release builds refuse to sync over plain http (issue #11).
    static let productionBaseURL = URL(string: "https://sync.locally.app")!

    private enum Key {
        static let baseURL = "com.tdare.locally.sync.baseURL"
        static let email = "com.tdare.locally.sync.email"
        static let deviceId = "com.tdare.locally.sync.deviceId"
        static let lastVersion = "com.tdare.locally.sync.lastVersion"
    }

    private let defaults: UserDefaults
    private let tokenStore: KeychainTokenStore

    init(defaults: UserDefaults = .standard, tokenStore: KeychainTokenStore = SecKeychainTokenStore()) {
        self.defaults = defaults
        self.tokenStore = tokenStore
    }

    var baseURL: URL {
        get {
            #if DEBUG
            if let stored = defaults.string(forKey: Key.baseURL), let url = URL(string: stored) {
                return url
            }
            return Self.defaultBaseURL
            #else
            // A stale dev override must never survive into a release build.
            return Self.productionBaseURL
            #endif
        }
        set {
            #if DEBUG
            if newValue.absoluteString != baseURL.absoluteString {
                // The device token was issued by the old host; don't send it
                // to the new one.
                clear()
            }
            defaults.set(newValue.absoluteString, forKey: Key.baseURL)
            #endif
            // Outside DEBUG, baseURL is always productionBaseURL: no-op.
        }
    }

    var email: String? { defaults.string(forKey: Key.email) }
    var deviceId: String? { defaults.string(forKey: Key.deviceId) }
    var deviceToken: String? { tokenStore.load() }

    var lastVersion: Int {
        get { defaults.integer(forKey: Key.lastVersion) }
        set { defaults.set(newValue, forKey: Key.lastVersion) }
    }

    func save(email: String, deviceToken: String, deviceId: String) throws {
        // Write the token first: if the Keychain write fails, nothing else
        // is persisted, so we never end up half signed-in.
        try tokenStore.save(deviceToken)
        defaults.set(email, forKey: Key.email)
        defaults.set(deviceId, forKey: Key.deviceId)
    }

    func clear() {
        defaults.removeObject(forKey: Key.email)
        defaults.removeObject(forKey: Key.deviceId)
        defaults.removeObject(forKey: Key.lastVersion)
        tokenStore.delete()
    }
}

/// Errors from `KeychainTokenStore.save`, surfaced to the caller instead of
/// being swallowed, since a lost device token means a silent sign-out.
enum KeychainTokenStoreError: LocalizedError, Equatable {
    case saveFailed(OSStatus)

    var errorDescription: String? {
        switch self {
        case .saveFailed(let status):
            return "Couldn't store the sign-in token securely (Keychain error \(status))."
        }
    }
}

/// The narrow Keychain seam `UserDefaultsSyncAccountStore` uses for the
/// device token, so tests can substitute an in-memory fake if the simulator
/// keychain isn't available in a given test environment.
protocol KeychainTokenStore {
    func load() -> String?
    func save(_ token: String) throws
    func delete()
}

/// Production `KeychainTokenStore`: one generic password item, accessible
/// only while the device is unlocked and only on this device. The app syncs
/// while foregrounded, so it never needs the after-first-unlock level, and
/// the token must never migrate to another device via an iCloud/iTunes
/// backup restore.
final class SecKeychainTokenStore: KeychainTokenStore {
    private let service = "com.tdare.locally.sync"
    private let account = "deviceToken"

    func load() -> String? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func save(_ token: String) throws {
        delete()
        var query = baseQuery()
        query[kSecValueData as String] = Data(token.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainTokenStoreError.saveFailed(status)
        }
    }

    /// Best-effort: `errSecItemNotFound` (nothing to delete) is expected and
    /// ignored, same as any other status here.
    func delete() {
        SecItemDelete(baseQuery() as CFDictionary)
    }

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
