# iOS: persist the sync device name and send the model name (#38)

## Summary

On the iPhone 14 used for the #3 smoke test, Settings → Sync with your Mac shows a **Device**
row with an empty value after a relaunch, and the server lists the device as `iPhone`. Two
causes, two fixes, both inside `apps/ios`:

1. `SyncEngine.verify` puts the verify response's `device.name` on `status.deviceName` and
   nothing persists it, so a fresh engine instance (every launch) starts with `nil`. The fix is
   to **persist the name in the account store** at verify time and read it back in
   `SyncEngine.init`, the same way `email` is restored today. A fresh engine shows the name with
   no network call and no new sign-in.
2. `AppContainer.production` hands the engine `UIDevice.current.name`, which iOS 16+ returns as
   the generic "iPhone". The fix is to send the **hardware model's marketing name** ("iPhone 14",
   from `utsname.machine` → `iPhone14,7` → a small lookup table), falling back to the raw
   identifier when the table doesn't know it. Still 1–200 characters, which is all the API
   requires (`verifyRequestSchema` in `apps/api/src/shared/types.ts`: `deviceName:
   z.string().trim().min(1).max(200)`).

No API change. No contract change. No user-editable name.

## Current behaviour

- `SyncEngine.init` (`apps/ios/Locally/Services/SyncEngine.swift`, ~line 133) restores
  `status.signedIn` and `status.email` from `SyncAccountStore`; `status.deviceName` is left at
  its default `nil`.
- `SyncEngine.verify` (~line 173) calls `api.verify(email:code:deviceName: deviceName(),
  platform: "ios")`, saves `email`/`deviceToken`/`deviceId` via `account.save`, and sets
  `status.deviceName = result.deviceName`. That is the only place the name is ever set.
- `SyncEngine.runReconcile` (~line 517) already calls `api.me()` and keeps only `me.quota`.
  `SyncMeResult` (`SyncApi.swift`, ~line 22) already carries `deviceName` decoded from
  `/v1/me`'s `device.name`.
- `SyncAccountStore` (`apps/ios/Locally/Services/SyncAccount.swift`) exposes `baseURL`, `email`,
  `deviceToken`, `deviceId`, `lastVersion`, `save(email:deviceToken:deviceId:)`, `clear()`.
  `UserDefaultsSyncAccountStore` keeps everything but the token in `UserDefaults` under
  `com.tdare.locally.sync.*` keys.
- `AppContainer.production` (`apps/ios/Locally/App/AppContainer.swift`, ~line 135) passes
  `deviceName: { UIDevice.current.name }`; `forTesting` defaults to `{ "Test Device" }`.
- `SyncSettingsSection.signedInContent` (`apps/ios/Locally/Views/Settings/SyncSettingsSection.swift`,
  ~line 109) renders `LabeledContent(Copy.Sync.deviceLabel, value: syncStatus.deviceName ?? "")`,
  so a `nil` name is a label with an empty value.
- `SyncStatus` is injected into the view tree as `container.syncStatus` (`LocallyApp.swift`,
  line 26), which is `syncEngine.status`. Whatever the engine puts there is what the row shows.
- The Mac sends `os.hostname()` (`apps/web/src/server/sync/SyncEngine.ts`, line 67), so its
  device row is distinctive; the phone's is not.

## Decisions

### Restore: persist in the account store (not "refresh from `/v1/me`")

The name is stored next to `email` and `deviceId` and read back in `SyncEngine.init`. Reasons:

- It works offline and at the instant of launch. The `/v1/me` route only runs inside
  `reconcile()`, which needs the network and only starts on the foreground timer
  (`startAutoReconcile` in `RootView`) or "Sync now", so a refresh-only design would show a
  blank row for the first seconds of every launch and forever when offline.
- It mirrors how `email` is restored, so the engine keeps one rule: everything the signed-in
  card shows about the account comes from the store at init.
- The value stored is the server's echo (`SyncVerifyResult.deviceName`), not the local
  closure's output, so the row shows exactly what the server lists for this device.

`reconcile()` does **not** refresh a stored name from `/v1/me`. One exception, for installs
that signed in before this change and therefore have no stored name: in `runReconcile`'s
existing `if let me = try? await api.me()` block, when `account.deviceName == nil`, write
`me.deviceName` to the store and to `status`. This is a one-time back-fill (it only fires while
the stored value is `nil`), so the store remains the single source of truth and an existing
signed-in phone stops showing a blank row after its first successful reconcile without having
to sign in again. It shows "iPhone" for such installs, which is what the server has for that
device row (see "Compatibility").

### Store shape: a settable `deviceName` property, not a new `save` parameter

`SyncAccountStore` gains `var deviceName: String? { get set }`, modelled on `lastVersion`,
rather than a fourth parameter on `save(email:deviceToken:deviceId:)`. Reasons: no signature
change, so the eight existing test call sites of `save(...)` (`SyncAccountStoreTests`,
`SyncEngineTests.makeHarness`, `HttpSyncApiTests`, `SyncReleasesPageDecodingTests`) stay as
they are; the name is not part of the "half signed-in"
invariant `save` protects (a name without a token is harmless and `clear()` removes it).
`verify` writes it right after `account.save` succeeds, so a failed Keychain write persists
neither token nor name.

### The name sent at verify: model marketing name from `utsname`, table + fallback

`UIDevice.current.name` is "iPhone" on iOS 16+ without the
`com.apple.developer.device-information.user-assigned-device-name` entitlement (which requires
Apple's approval; not pursued). `UIDevice.current.model` is also just "iPhone".
`utsname.machine` gives the hardware identifier (`iPhone14,7`), which is exact but unfriendly. A
small identifier → marketing-name table gives "iPhone 14"; anything not in the table falls back
to the raw identifier, which is still distinct from the Mac's hostname and from "iPhone" and
needs no maintenance to stay truthful. On the Simulator `utsname.machine` is `arm64`/`x86_64`,
so the identifier is read from `ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"]`
when that key is present.

The mapping is a pure function so it can be unit-tested with fixed identifiers. The table covers
the iPhones that can run the deployment target (iOS 17.0, `project.yml`):

| Identifier | Name |
| --- | --- |
| `iPhone11,2` | iPhone XS |
| `iPhone11,4`, `iPhone11,6` | iPhone XS Max |
| `iPhone11,8` | iPhone XR |
| `iPhone12,1` | iPhone 11 |
| `iPhone12,3` | iPhone 11 Pro |
| `iPhone12,5` | iPhone 11 Pro Max |
| `iPhone12,8` | iPhone SE (2nd generation) |
| `iPhone13,1` | iPhone 12 mini |
| `iPhone13,2` | iPhone 12 |
| `iPhone13,3` | iPhone 12 Pro |
| `iPhone13,4` | iPhone 12 Pro Max |
| `iPhone14,2` | iPhone 13 Pro |
| `iPhone14,3` | iPhone 13 Pro Max |
| `iPhone14,4` | iPhone 13 mini |
| `iPhone14,5` | iPhone 13 |
| `iPhone14,6` | iPhone SE (3rd generation) |
| `iPhone14,7` | iPhone 14 |
| `iPhone14,8` | iPhone 14 Plus |
| `iPhone15,2` | iPhone 14 Pro |
| `iPhone15,3` | iPhone 14 Pro Max |
| `iPhone15,4` | iPhone 15 |
| `iPhone15,5` | iPhone 15 Plus |
| `iPhone16,1` | iPhone 15 Pro |
| `iPhone16,2` | iPhone 15 Pro Max |
| `iPhone17,1` | iPhone 16 Pro |
| `iPhone17,2` | iPhone 16 Pro Max |
| `iPhone17,3` | iPhone 16 |
| `iPhone17,4` | iPhone 16 Plus |
| `iPhone17,5` | iPhone 16e |

Newer identifiers (the iPhone 17 family and later) fall back to the raw identifier; add rows as
they are confirmed. Do not guess rows.

Length rule, applied last: trim whitespace; if the result is empty use `"iPhone"`; if it is
longer than 200 characters keep the first 200. This guarantees the API's `min(1).max(200)`
without depending on the server to trim.

### `originDevice` and `isOwnEcho` keep using the `deviceName` closure

`pushInternal` (`originDevice: deviceName()`) and `isOwnEcho` (`record.originDevice ==
deviceName()`) are not changed. After this change both use the model name instead of "iPhone".
Consequences, accepted: two same-model iPhones on one account would treat each other's records
as own echoes in the narrow 409-then-upload-failure path; today two iOS 16+ phones both named
"iPhone" already collide there, so this is not a regression. The proper fix is to compare device
ids, which is out of scope. A record pushed before this change carries `originDevice: "iPhone"`;
if such a record echoes back after the update with a newer `updatedAt` it is treated as a remote
update (re-tagged with identical content) rather than an own echo. Narrow, and self-limiting.

### Settings row: shown only when a name is known

`signedInContent` renders the Device row inside `if let deviceName = syncStatus.deviceName`,
so the card never shows a label with an empty value. With the store change the only time the
name is `nil` while signed in is a pre-existing install before its first reconcile back-fill.
No new copy, so `Resources/Copy.swift` is untouched.

## Affected components (all in `apps/ios`)

Only these files and functions. Nothing in `Domain/` is touched (issue #39 owns
`Domain/SyncRecord.swift` and the file-name validation paths).

### `Locally/Services/SyncAccount.swift`

- `protocol SyncAccountStore`: add `var deviceName: String? { get set }` with a doc comment:
  "The device name the server echoed from `POST /v1/auth/verify`, shown in Settings; `nil`
  when signed out or when signed in before it was stored."
- `UserDefaultsSyncAccountStore`: new key `Key.deviceName = "com.tdare.locally.sync.deviceName"`;
  `deviceName` getter/setter over `defaults` (setter removes the key on `nil`); `clear()` also
  removes it.

### `Locally/Services/SyncEngine.swift`

- `init(...)`: after `status.email = account.email`, add `status.deviceName = account.deviceName`.
- `verify(email:code:)`: after `try account.save(...)`, add `account.deviceName =
  result.deviceName`. `status.deviceName = result.deviceName` stays.
- `runReconcile()`: inside the existing `if let me = try? await api.me()` block, after
  `status.quota = me.quota`, add the nil-gated back-fill:
  `if account.deviceName == nil { account.deviceName = me.deviceName; status.deviceName = me.deviceName }`.
- `clearLocalAccountState()`: no code change; `account.clear()` now removes the stored name and
  `status.deviceName = nil` is already there. Update its doc comment if it lists what is cleared.

No other function in this file changes. In particular `process(_:)`, `downloadFile`,
`acceptFromMac`, `applyRemoteUpdate`, `pushInternal` and `isOwnEcho` are left alone.

### `Locally/App/AppContainer.swift`

- New file-level `enum SyncDeviceName` (internal, so `LocallyTests` can reach it with
  `@testable import`) with:
  - `static func current() -> String`: reads `SIMULATOR_MODEL_IDENTIFIER` from the environment
    if present, else `utsname.machine`, and returns `name(forMachine:)`.
  - `static func name(forMachine machine: String) -> String`: the table lookup, raw-identifier
    fallback, then the trim/empty/200-character rule above. Pure; no `UIKit` needed.
- `production()`: `deviceName: { SyncDeviceName.current() }` replaces
  `{ UIDevice.current.name }`. If nothing else in the file still needs `UIKit`, drop the import.
- `forTesting(...)`: unchanged (default `{ "Test Device" }`).

### `Locally/Views/Settings/SyncSettingsSection.swift`

- `signedInContent`: wrap the Device `LabeledContent` in `if let deviceName =
  syncStatus.deviceName`. Nothing else in the view changes.

### `LocallyTests/Fakes.swift`

- `InMemorySyncAccountStore`: add `var deviceName: String?`; `clear()` sets it to `nil`.
- `FakeSyncApi`: add `private(set) var meCallCount = 0`, incremented in `me()`, so a test can
  assert the restore path made no `/v1/me` call.

### `STATUS.md` (implementation change, not this plan)

One bullet under "What works → iOS": the Sync card keeps the device name across relaunches and
signs in as the model name ("iPhone 14") (#38). Also note that a phone signed in before this
change keeps its "iPhone" row on the server until it signs out and in again.

## Compatibility and migration

- No API, `spec/sync.md` or `spec/metadata.md` change. `POST /v1/auth/verify` already accepts a
  1–200 character `deviceName` and echoes it in `device.name`; `GET /v1/me` already returns
  `device.name`. `apps/web` is unaffected.
- A device row's name is fixed when the device is created at verify; there is no rename route
  and this plan does not add one. A phone that signed in before this change keeps "iPhone" on
  the server and, after its first reconcile, shows "iPhone" in Settings (from the back-fill).
  It shows "iPhone 14" only after the user signs out and in again, which creates a new device
  row. State this in `STATUS.md`.
- `UserDefaults`: one new key; absent on old installs, read as `nil`. No migration step.
- Sync records (`originDevice`) written after this change carry the model name. Readers on both
  sides treat the field as an opaque string; see the `isOwnEcho` note above.

## Security implications

- The model identifier/name is coarser than the user-assigned device name Apple hid behind an
  entitlement; it is sent only to the account's own sync service over the existing HTTPS-only
  path (release builds refuse plain http, #11) and stored in `UserDefaults`, never in the
  Keychain, since it is not a secret. This matches how `email` and `deviceId` are stored.
- The name is never used to build a path. It appears only in the verify body, in
  `originDevice` of pushed records (as today), and in the Settings row.
- The length rule is enforced client-side so a hostile or odd `utsname` value can neither be
  empty (400 from the API) nor oversized.
- No process spawning, no writes to the library or Spotify folder, no new network calls.

## Tests (Swift Testing, `LocallyTests`, fakes only, no network)

### `LocallyTests/SyncEngineTests.swift`

Extend `makeHarness` with an optional `account: InMemorySyncAccountStore? = nil` parameter
(when `nil`, build and sign in a fresh one as today), so a test can hand a second engine the
same store the way `deleteSurvivesAnAppRestartWithTheNetworkDown` reuses `library`/`outbox`.
Add a `// MARK: - Device name (#38)` section at the end of the account tests with:

- `verifyPersistsTheDeviceNameAndAFreshEngineRestoresItWithoutSigningInAgain`: sign the
  harness out (`h.account.clear()`), set `h.api.verifyResult` with `deviceName: "iPhone 14"`,
  call `verify(email:code:)`; expect `h.account.deviceName == "iPhone 14"`,
  `h.engine.status.deviceName == "iPhone 14"`, and `h.api.verifyCalls.first?.deviceName ==
  "Toby's iPhone"` (the closure's output went on the wire, the server's echo is what was
  stored). Then build `restarted = makeHarness(library: h.library, outbox: h.outbox, api:
  FakeSyncApi(), account: h.account)` and, with no call on `restarted.engine`, expect
  `restarted.engine.status.deviceName == "iPhone 14"`, `restarted.api.verifyCalls.isEmpty` and
  `restarted.api.meCallCount == 0`.
- `reconcileBackfillsAMissingDeviceNameFromMe`: default harness (signed in, no stored name),
  `h.api.meResult` with `deviceName: "iPhone"`; `await h.engine.reconcile()`; expect
  `h.account.deviceName == "iPhone"` and `h.engine.status.deviceName == "iPhone"`.
- `reconcileDoesNotOverwriteAStoredDeviceName`: `h.account.deviceName = "iPhone 14"`,
  `h.api.meResult` with `deviceName: "iPhone"`; reconcile; both store and status stay
  `"iPhone 14"`.
- `signOutClearsThePersistedDeviceName`: `h.account.deviceName = "iPhone 14"`; `await
  h.engine.signOut()`; `h.account.deviceName == nil` and `status.deviceName == nil`. (One
  added assertion pair in the existing `deleteAccount...ClearsLocalState` test covers the
  delete path.)

### `LocallyTests/SyncAccountStoreTests.swift`

- `deviceNamePersistsAcrossStoreInstances`: set `deviceName` on one
  `UserDefaultsSyncAccountStore`, build a second store over the same `UserDefaults` suite and
  `InMemoryKeychainTokenStore`, read it back. This is the production-store half of "survives a
  relaunch".
- `clearRemovesTheDeviceName` (or one assertion added to `clearSignsOutAndResetsLastVersion`).
- `changingBaseURLSignsOutAndResetsLastVersion`: add `#expect(store.deviceName == nil)`.

### New `LocallyTests/SyncDeviceNameTests.swift`

Pure tests on `SyncDeviceName.name(forMachine:)`: `"iPhone14,7"` → `"iPhone 14"`;
`"iPhone17,5"` → `"iPhone 16e"`; an unknown `"iPhone99,9"` → `"iPhone99,9"`; `"  "` and `""` →
`"iPhone"`; a 300-character string → 200 characters; every result satisfies `1...200`. A new
test file needs `xcodegen generate` (the `LocallyTests` path is globbed in `project.yml`).

### Settings section shows it: `LocallyTests/SyncDeviceNameTests.swift` (same file) or `SyncEngineTests.swift`

There is no view-testing dependency in this project (no ViewInspector, no snapshot tests), so
the section is covered at the value it binds to. `SyncSettingsSection` reads
`@Environment(SyncStatus.self)`, which `LocallyApp` injects as `container.syncStatus`:

- `aContainerBuiltOverASignedInStoreExposesTheDeviceNameTheSettingsRowBindsTo`: build an
  `InMemorySyncAccountStore`, `save(...)` a token and set `deviceName = "iPhone 14"`, then
  `AppContainer.forTesting(...)` with the existing fakes (`FakeSpotifyFolder` over a temp dir,
  `InMemoryLibraryStore`, `FakeFileImporter`, `FakeTranscoder`, `FakeTagWriter` ×2,
  `FakeCoverStore`, `FakeInboxStore`, `FakePurchaseService`, `FakeSyncApi`,
  `outbox: InMemorySyncOutbox()`); expect `container.syncStatus.deviceName == "iPhone 14"` and
  `container.syncStatus.signedIn` with `api.meCallCount == 0`. `forTesting` is `@MainActor`, so
  the test is too.

Manual check, recorded in the PR: on the Simulator (shows the sim's model, e.g. "iPhone 16
Pro") and if possible on the iPhone 14, sign in, force-quit, relaunch, open Settings: the
Device row shows the name before "Sync now" is tapped and while in airplane mode.

## Checks (from `apps/ios/AGENTS.md`)

```sh
cd apps/ios
xcodegen generate
xcodebuild -project Locally.xcodeproj -target Locally -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO
xcodebuild test -scheme Locally -destination 'platform=iOS Simulator,name=<device>'
```

The build is required before pushing (root `CLAUDE.md`); run the test command too when a
simulator is available. `apps/web` and `apps/api` are untouched, so their `npm run check` is
not needed for this change.

## Collision with #39 and ordering

- #39 (file-name extension validation) owns `Domain/SyncRecord.swift` and may add checks next to
  `ReleaseLayout.isPlainFileName` in `SyncEngine.downloadFile`/`process(_:)` and in
  `ReleaseCoordinator`, plus `SyncFixtureTests.swift`. This plan does not touch `Domain/`,
  `ReleaseCoordinator`, `downloadFile`, `process(_:)` or the fixture tests. Its `SyncEngine.swift`
  edits are confined to `init`, `verify` and the `api.me()` block of `runReconcile`.
- Shared files both may edit: `SyncEngineTests.swift` (this plan appends a new MARK section and
  adds one optional parameter to `makeHarness`) and `Fakes.swift` (this plan adds two members to
  existing fakes). Keep each addition self-contained so a rebase is a trivial merge.
- Do not fold this change into a file-name validation change or vice versa; separate PRs.
- No dependency on any other open issue. Land after rebasing on `main`.

## Not in this plan

- A user-editable device name (a Settings field plus a server rename route). The issue offers it
  as an alternative; the model name closes the "two devices look alike" complaint without a
  contract change. If wanted later it is additive: `PATCH /v1/devices/:id { name }` and a field.
- Renaming an existing device row from the client (no route exists; sign out/in creates a new
  row).
- Refreshing a stored name from `/v1/me` on every reconcile (only the nil back-fill).
- Comparing `originDevice` by device id instead of name in `isOwnEcho` (see "Decisions").
- The `user-assigned-device-name` entitlement.
- Any change to `apps/api`, `apps/web`, `spec/`, or `Resources/Copy.swift`.
