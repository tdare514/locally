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
  Domain/         Release/Track/TagSet models, LocallyError, ReleaseLayout (naming/sanitising)
  Services/       FileImporter, Transcoder, TagWriter (+ M4A/ID3 writers), SpotifyFolder, LibraryStore
  Coordinator/    ReleaseCoordinator — the one place that sequences stage → transcode → tag → move → index
  Views/          Onboarding, Import, Library, Settings, and shared Components
  Resources/      Copy.swift (all user-facing strings), Theme.swift (dark palette), Assets.xcassets
LocallyTests/     Swift Testing suites, with fakes for every Services protocol
```

Every service is a protocol with one production implementation; `ReleaseCoordinator` and
the views depend only on the protocols, so tests substitute fakes (see
`LocallyTests/Fakes.swift`) without touching disk, AVFoundation, or a real SwiftData store.
