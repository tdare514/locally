# Locally (iOS)

A standalone SwiftUI companion app: import audio, tag it with cover/artist/album/track
details, and deliver the tagged file into the folder Spotify's iOS app reads local files
from. Independent of, and not affiliated with, Spotify. See `docs/ios-plan.md` for the
product plan and `spec/metadata.md` for the metadata model shared with `apps/web`.

## Requirements

- Xcode 26 or later, with the iOS 17+ SDK.
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) on `PATH` (`brew install xcodegen`). CI pins 2.46.0 in `.github/workflows/ios.yml`.
- An iOS Simulator runtime installed (Xcode > Settings > Components) to run the app or
  its tests. Building for the simulator SDK does **not** require a runtime, but Xcode's
  asset-catalog compiler (`actool`) does need one installed to compile `Assets.xcassets`
  even for a plain build — if none is installed, `xcodebuild -downloadPlatform iOS` will
  fetch one (a large download; check Xcode > Settings > Components for progress).

## Generating the project

`Locally.xcodeproj` is generated from `project.yml` and is not meant to be hand-edited.
After changing `project.yml` or adding/removing source files:

```sh
cd apps/ios
xcodegen generate
```

## Building

Open `Locally.xcodeproj` in Xcode and run the `Locally` scheme, or from the command line:

```sh
cd apps/ios
xcodebuild -project Locally.xcodeproj -target Locally -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO
```

No signing team is configured (`CODE_SIGN_STYLE` is `Automatic` with no `DEVELOPMENT_TEAM`),
so simulator builds need no Apple ID. Building for a physical device requires picking a
team in Xcode's Signing & Capabilities tab first.

## Testing

```sh
cd apps/ios
xcodebuild test -scheme Locally -destination 'platform=iOS Simulator,name=<device>'
```

Replace `<device>` with an available simulator name (`xcrun simctl list devices
available`). If no simulator is installed yet, you can still confirm the test target
compiles with:

```sh
xcodebuild build-for-testing -scheme Locally -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO
```

`LocallyTests` uses [Swift Testing](https://developer.apple.com/documentation/testing)
(`import Testing`, `@Test`), not XCTest.

## Running on a simulator or device

1. Open `Locally.xcodeproj` in Xcode.
2. Pick a simulator (or a device, after selecting a signing team) as the run destination.
3. Run. On first launch you'll walk through onboarding: the app explains it's independent
   of Spotify, notes it assumes a Premium account, walks through turning on Spotify's
   "Local Files" setting, and then asks you to pick the folder Spotify created under
   *On My iPhone* in the Files app.

## Verifying the Spotify folder assumption

`docs/ios-plan.md` lists the phase-1 assumptions to check on a real phone (not the
simulator, since Spotify itself needs a real device and a Local Files folder created by
a real install):

- With Local Files turned on in Spotify's settings, a **Spotify** folder appears under
  *On My iPhone* in the Files app.
- The app's onboarding folder picker can select that folder and later write into it from
  the stored security-scoped bookmark (`Services/SpotifyFolder.swift`).
- A tagged mp3 (ID3v2.4 + APIC cover) and a tagged m4a (iTunes metadata atoms) both show
  their title/artist/album/artwork in Spotify's Local Files after fully closing and
  reopening the app.

These are manual, on-device checks for phase 1; nothing in the codebase gates on them.

## Mobile restructure device checks (#6)

The Library-as-home restructure (#14–#18) is in code. Two UI details still need a real phone
(or a signed simulator run) before #6 can close — unit tests cover the reorder ViewModels, not
the long-press gesture itself:

1. **Import silhouette**
   - Open **Add a song → Single** with no file chosen: one faint `FileRow`-shaped block under
     the drop zone, centred "No tracks yet" / "Add audio files above and they'll appear here."
   - Switch to **Album** with no files: three stacked placeholder blocks with the same blurb,
     spaced like live track rows (not tighter).
2. **Long-press drag reorder (no Edit button)**
   - Album builder with 2+ tracks: "Hold and drag a track to reorder." under Tracks; long-press
     a row (outside the title field if the field steals the press), drag to a new position,
     send — Spotify track numbers follow the new order.
   - Release page for an album with 2+ tracks: same hint and long-press drag; Save stays off
     until something changes, then persists the new order. Compact rows show a trailing chevron.
   - With only one track, long-press must not lift the row (move is disabled).

Record the phone model and iOS version next to each item when checked, then tick the matching
bullets on issue #6.

## Architecture

```
Locally/
  App/            AppContainer (composes services; forTesting(...) for fakes), LocallyApp (@main)
  Domain/         Release/Track/AlbumDraft/ReleaseChanges/TagSet models, LocallyError, ReleaseLayout,
                  Entitlements (paid-feature gate — see Phase 3), SyncRecord (wire types shared with apps/web)
  Services/       FileImporter, Transcoder, TagWriter (+ M4A/ID3 writers), SpotifyFolder,
                  LibraryStore, CoverStore (+ FileCoverStore), InboxStore (+ AppGroupInboxStore),
                  PurchaseService (+ StoreKitPurchaseService),
                  SyncAccount (Keychain-backed token), SyncApi / HttpSyncApi, SyncEngine,
                  SyncOutbox (persistent push/delete queue), ReconcileScheduler
  Coordinator/    ReleaseCoordinator — the one place that sequences stage → transcode → tag → move →
                  index for import (single or album), rewrites tags in place for edits, and removes
                  files + store entry for deletes; also the ReleaseSyncHook call site
  Views/          Onboarding, Import (single + album builder), Library (+ release detail/edit),
                  Settings, Purchase (PaywallView), and shared Components
  Resources/      Copy.swift (all user-facing strings), Theme.swift (dark palette), Assets.xcassets,
                  PrivacyInfo.xcprivacy
LocallyShare/     The "Send to Locally" share extension (see Phase 3) — ShareViewController only;
                  no SwiftUI, no dependency on the Locally target.
Shared/           Compiled into both Locally and LocallyShare: AppGroup (the group id constant) and
                  InboxFileNaming (pure `"<uuid>-<original name>"` naming for staged Inbox files).
LocallyTests/     Swift Testing suites, with fakes for every Services protocol (see Fakes.swift)
```

Every service is a protocol with one production implementation; `ReleaseCoordinator` and
the views depend only on the protocols, so tests substitute fakes (see
`LocallyTests/Fakes.swift`) without touching disk, AVFoundation, or a real SwiftData store.

## Phase 2 features

Building on phase 1's single-track import:

- **Album import** (`Views/Import/AlbumBuilderView.swift`, `AlbumBuilderViewModel`): pick several
  audio files at once, give each an editable, tag-prefilled title, reorder and remove them, then
  send them as one album — `ReleaseCoordinator.importAlbum` numbers tracks by position, shares the
  album/artist/year/genre/cover tags across every file, and reports "tagging and moving N of M"
  progress as each one lands. A failed track rolls back every file that call already moved into
  Spotify's folder and leaves the library untouched.
- **Edit in place** (`Views/Library/ReleaseDetailView.swift`, `ReleaseDetailViewModel`): change a
  release's title/artist/year/genre/cover and each track's title/order; `ReleaseCoordinator.updateRelease`
  rewrites every track file's tags in place (never renaming or moving them, so playlists keep the
  track) and updates the library index.
  Save is disabled until something actually changed.
- **Delete** (`ReleaseDetailView`, two-step `confirmationDialog`): removes every track file from
  Spotify's folder (a file already missing there is not an error) and the library entry.
  `ReleaseCoordinator.deleteRelease` refuses — and deletes nothing — if a track's recorded path
  doesn't resolve to somewhere inside the connected folder (`ReleaseLayout.isInside`).
- **Cover thumbnails**: covers are saved once per release under the app's own Application Support
  directory via `CoverStore`/`FileCoverStore` (`<releaseId>.jpg` or `.png`, chosen by the image's
  magic bytes), separately from the Spotify folder, and read back for `LibraryView`'s thumbnails.
- The Import tab now has a `Single | Album` segmented control (`Views/Import/ImportView.swift`);
  `ImportSingleView` is unchanged apart from moving its `NavigationStack`/title up into `ImportView`.

`SpotifyFolderAccess.withAccess` gained an `async` overload (alongside the original synchronous
one) so a track can be re-tagged in place — via `M4ATagWriter`'s `async` `AVAssetExportSession`
export, or `ID3TagWriter`'s synchronous rewrite — while the security-scoped access to Spotify's
folder is still open.

## Phase 3 features

Building on phase 2's albums and library, polishing toward App Store submission:

### Share extension ("Send to Locally")

`LocallyShare` is a minimal `UIViewController`-based share extension (no SwiftUI, no
`SLComposeServiceViewController`) that accepts 1–20 shared items whose UTI conforms to
`public.audio` (`NSExtensionActivationRule` in `project.yml`, a SUBQUERY predicate over
`registeredTypeIdentifiers` rather than the simpler `NSExtensionActivationSupportsFileWithMaxCount`
dictionary form, since that form can't filter by UTI). For each item it resolves the file via
`NSItemProvider.loadFileRepresentation(forTypeIdentifier:)`, copies only mp3, m4a, wav, flac and
aiff/aif (`SupportedAudio`, shared with the app) into
`<App Group container>/Inbox/<uuid>-<original name>` (`InboxFileNaming`), and
shows "Saved to Locally. Open Locally to tag and send." — it never tries to open the containing
app, which isn't possible from a share extension.

The app and extension share the App Group `group.com.tdare.locally` (entitlements generated by
XcodeGen's `entitlements:` key in `project.yml`, not hand-edited). `Services/InboxStore.swift`'s
`AppGroupInboxStore` lists and removes files in that Inbox folder; `ImportView` sweeps Inbox
orphans and checks for waiting files on appear and whenever `scenePhase` becomes `.active` (the
extension can only add to the inbox while the app isn't running), and shows a banner ("N songs
shared from other apps are waiting") with
"Add as singles" (queues them one at a time through the single-import flow, prefilled from
whatever tags they carry) and "Make an album" (seeds `AlbumBuilderView` with them). A file is
removed from the inbox as soon as `FileImporter` stages a copy of it, not when it's actually sent —
staging already has the only copy that matters.

**Verified on the iPhone 17 simulator**: with the app and extension built with the default
simulator ("Sign to Run Locally") signing — not `CODE_SIGNING_ALLOWED=NO`, which strips
entitlements entirely — placing a file at `<App Group container>/Inbox/<uuid>-name.mp3` and
foregrounding the app produced the exact banner copy, and "Add as singles" correctly staged the
real fixture file (via the production `LocalFileImporter`/`AVAsset` tag reading), prefilled the
form, and removed the file from the Inbox. The extension also appears correctly as "Locally" in
the system share sheet for an audio file (confirming the activation rule), and launches when
tapped.

**Verified on an iPhone 12 Pro (iOS 18.7, 27 Sep 2026)**: sharing an audio file from Files to
Locally shows "Saved to Locally", the app's banner offers it, "Add as singles" prefills the form,
and Send delivers it to Spotify. Two bugs were found and fixed on the way, both worth knowing:

- `loadFileRepresentation` hands the extension a temporary URL that iOS deletes as soon as the
  completion handler returns. Copying into the Inbox must happen inside that handler; resuming a
  continuation and copying afterwards fails with "The file ... doesn't exist". (An earlier
  simulator failure attributed to XPC flakiness was this bug.)
- The import view models delete an inbox file right after staging it, so they must keep the
  staged copy's URL for Send, never the inbox URL they were handed.

The app's own Documents folder ("On My iPhone > Locally" in Files) is scanned as a second inbox,
because "Save to Files" naturally lands there. Tracks already in the library are never offered.

### One-time purchase (StoreKit 2)

**Locally Full is not a feature gate today.** Every current feature — singles, albums, editing,
deleting, unlimited sends — is and remains free; none of it is metered. `Domain/Entitlements.swift`
exists as the one place a *future* paid feature will be gated: `PaidFeature` is an empty enum (a
doc comment there says cases are added as paid features ship) and
`Entitlements.isFeatureAvailable(_:isFull:)` returns `true` unconditionally because there is
nothing yet to gate. When a paid feature ships, it adds a case to `PaidFeature` and calls that
function at the point it needs to check purchase state — nothing else about this design changes.

`Services/PurchaseService.swift` defines the purchase itself: `loadProduct`, `purchase`, `restore`,
`refreshEntitlement`, and `isFullUnlocked`, implemented by `StoreKitPurchaseService` against
StoreKit 2 (`Product.products(for:)`, `product.purchase()`, `Transaction.updates`/
`currentEntitlements`, `AppStore.sync()` for restore). Only verified transactions count. Settings
has a "Locally Full" row: "Unlocked" once purchased, otherwise a "Buy" row that opens
`Views/Purchase/PaywallView.swift` — a sheet with the price (loaded from the product), a Buy
button, and "Restore purchase". The copy is deliberately modest about what it buys today: "A
one-time purchase, no subscription. It supports development and unlocks upcoming features as they
arrive."

**Testing the purchase with the StoreKit config**: `Locally.storekit` (product
`com.tdare.locally.full`, $4.99, matching `Locally.storekit`'s test price) is wired into the
scheme via `schemes.Locally.run.storeKitConfiguration` in `project.yml`, so **running the app from
Xcode** (Product ▸ Run, not a plain `xcodebuild build` + `simctl launch`) uses the local test store
automatically — no sandbox Apple ID needed. `xcodebuild`/`simctl` alone cannot attach a `.storekit`
configuration to a simulator launch (there is no CLI flag for it); a build installed and launched
outside Xcode's own Run action will call the real StoreKit servers and `loadProduct()` will
typically return `nil` (`PaywallView` then shows a disabled Buy button rather than crashing).
Verify from Xcode: run on the iPhone 17 simulator, open Settings, confirm the "Locally Full" row
and the Paywall show the test price, tap Buy, accept the test payment sheet, and confirm the row
flips to "Unlocked"; "Restore purchase" should do the same after a fresh install.

### App Store readiness

- `Locally/PrivacyInfo.xcprivacy`: `NSPrivacyTracking` is `false`, no collected data types.
  Declared required-reason APIs: `NSPrivacyAccessedAPICategoryUserDefaults` (reason `CA92.1` —
  `SpotifyFolder`'s bookmark, `StoreKitPurchaseService`) and
  `NSPrivacyAccessedAPICategoryFileTimestamp` (reason `C617.1` — `AppGroupInboxStore` reads a
  shared file's `.creationDate` to sort the inbox). `LocallyShare` doesn't use either API, so it
  doesn't need its own manifest.
- `project.yml` adds `ITSAppUsesNonExemptEncryption: false`, `CFBundleDisplayName: Locally`,
  `LSApplicationCategoryType: public.app-category.music`, and points
  `CFBundleShortVersionString`/`CFBundleVersion` at `MARKETING_VERSION` (`1.0`) /
  `CURRENT_PROJECT_VERSION` (`2`) so the extension's version always matches the app's (Xcode
  otherwise warns, and refuses to submit, if they differ).
- Submission checklist still open: the App Store icon is the listener mark rendered by
  `scripts/make-listener-icons.py` (main `AppIcon`, alternate `AppIcon-Line`, picker in Settings);
  export compliance is answered by `ITSAppUsesNonExemptEncryption: false` above; screenshots need
  capturing for onboarding, single import, album import, the library, and the paywall, at whatever
  device sizes App Store Connect requires.

## Installing on a physical iPhone from the command line

After the first run from Xcode (which creates the certificate and registers the phone), later
builds can go straight to the device. Find the device id with `xcrun devicectl list devices`.

```bash
xcodegen generate
xcodebuild -project Locally.xcodeproj -scheme Locally -configuration Debug \
  -destination 'generic/platform=iOS' -derivedDataPath DerivedData \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=<your team id> build
xcrun devicectl device install app --device <device id> DerivedData/Build/Products/Debug-iphoneos/Locally.app
xcrun devicectl device process launch --device <device id> com.tdare.locally
```

The team id is the ten-character code shown next to your name under Xcode, Settings, Accounts.

### App Groups on a Personal (free) team

Both `Locally` and `LocallyShare` now carry the `com.apple.security.application-groups`
entitlement (`group.com.tdare.locally`), needed for the share extension. On this project's
Personal Team (`E88UWYDJ8L`), `xcodebuild -allowProvisioningUpdates` alone could not fully
provision it for a device build: it refreshed the App ID and profiles (and, after opening the
project in Xcode once, added the App Groups *capability* to the App ID), but the profile's
`com.apple.security.application-groups` entitlement kept coming back as an **empty array** —
inspect a regenerated profile with
`security cms -D -i ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/<uuid>.mobileprovision`
to check — rather than containing `group.com.tdare.locally`, so `xcodebuild ... build` for
`generic/platform=iOS` fails with:

```
error: Provisioning profile "iOS Team Provisioning Profile: com.tdare.locally" doesn't match the
entitlements file's value for the com.apple.security.application-groups entitlement.
```

This reproduced identically across repeated `-allowProvisioningUpdates` runs and after opening the
project in Xcode.app directly, and the network path to `developerservices2.apple.com` was
reachable throughout, so it isn't a connectivity issue. It looks like creating a *new* App Group
resource (as opposed to toggling the App Groups capability bit on an already-registered App ID) on
a Personal Team either isn't automatable this way or needs a step this environment couldn't
perform (Personal Teams don't get the full developer.apple.com portal UI). **The App Group works
correctly on the Simulator regardless** — Simulator code signing doesn't enforce a real
provisioning profile, so both targets' entitlements are honored locally; the phase 3 verification
above ran entirely on the simulator for exactly this reason. To get an on-device build past this,
either enroll in the paid Apple Developer Program (which manages App Groups through the full
portal) or fall back to a documented alternative for on-device sharing (e.g. dropping the App
Group and having the extension hand the file to the app through a different channel) before
shipping a device build that needs the share extension.
