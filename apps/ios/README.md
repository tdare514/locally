# Locally (iOS)

A standalone SwiftUI companion app: import audio, tag it with cover/artist/album/track
details, and deliver the tagged file into the folder Spotify's iOS app reads local files
from. Independent of, and not affiliated with, Spotify. See `docs/ios-plan.md` for the
product plan and `spec/metadata.md` for the metadata model shared with `apps/web`.

## Requirements

- Xcode 26 or later, with the iOS 17+ SDK.
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) on `PATH` (`brew install xcodegen`).
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

## Architecture

```
Locally/
  App/            AppContainer (composes services; forTesting(...) for fakes), LocallyApp (@main)
  Domain/         Release/Track/AlbumDraft/ReleaseChanges/TagSet models, LocallyError, ReleaseLayout
  Services/       FileImporter, Transcoder, TagWriter (+ M4A/ID3 writers), SpotifyFolder,
                  LibraryStore, CoverStore (+ FileCoverStore)
  Coordinator/    ReleaseCoordinator — the one place that sequences stage → transcode → tag → move →
                  index for import (single or album), rewrites tags in place for edits, and removes
                  files + store entry for deletes
  Views/          Onboarding, Import (single + album builder), Library (+ release detail/edit),
                  Settings, and shared Components
  Resources/      Copy.swift (all user-facing strings), Theme.swift (dark palette), Assets.xcassets
LocallyTests/     Swift Testing suites, with fakes for every Services protocol
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
