# Agent briefing — Locally iOS app (apps/ios)

## What this is

The SwiftUI iPhone companion of the Locally monorepo: imports and tags audio and delivers it into
the folder Spotify's iOS app reads local files from. Shares `spec/metadata.md` and `spec/sync.md`
with `apps/web`. Product plan in `docs/ios-plan.md`, design tokens in `docs/design.md`. See the
root `AGENTS.md` for the monorepo map and global invariants. Paths below are relative to `apps/ios`.

## Architecture map (apps/ios)

```
project.yml             # XcodeGen project spec — the source of truth for Locally.xcodeproj
Locally.storekit         # local StoreKit test config (product, price) for Xcode-run testing
Locally/
  App/                   # AppContainer (composes services; forTesting(...) for fakes), LocallyApp
  Domain/                # Release/Track/AlbumDraft/TagSet models, LocallyError, Entitlements
    ReleaseLayout.swift   # pure: sanitizeSegment, fileName, isInside, isPlainFileName
    SyncRecord.swift       # SyncDateFormat + wire types SyncTrack/SyncRecord shared with apps/web
  Services/              # FileImporter, Transcoder, TagWriter (+M4A/ID3), SpotifyFolder,
                          # LibraryStore, CoverStore, InboxStore, PurchaseService
    SyncAccount.swift      # protocol SyncAccountStore: baseURL/email/deviceToken/deviceId/lastVersion,
                            # token kept in Keychain, never UserDefaults
    SyncApi.swift           # wire types + protocol SyncApi/HttpSyncApi: verify, releases page, uploads
    SyncEngine.swift         # ReleaseSyncHook + SyncStatus + SyncEngine: reconcile loop, push, accept
  Coordinator/            # ReleaseCoordinator — sequences stage → transcode → tag → move → index for
                          # import/update/delete; the only place that calls SpotifyFolderAccess
  Views/                  # Onboarding, Import (single + album), Library, Settings, Purchase, Components
  Resources/              # Copy.swift (user-facing strings), Theme.swift (palette), Assets.xcassets
LocallyShare/             # "Send to Locally" share extension — ShareViewController only, no SwiftUI
Shared/                   # compiled into both targets: AppGroup id, InboxFileNaming
LocallyTests/             # Swift Testing suites; Fakes.swift has a fake for every Services protocol
```

## Non-negotiable rules

- **`Locally.xcodeproj` is generated, not hand-edited.** It comes from `project.yml`, including
  entitlements (the `entitlements:` key); run `xcodegen generate` after adding/removing source
  files or changing `project.yml`.
- **Every service is a protocol with one production implementation.** `ReleaseCoordinator` and the
  views depend only on the protocols; tests substitute fakes from `LocallyTests/Fakes.swift` — no
  real disk, AVFoundation, SwiftData, StoreKit, or network in tests.
- **Never write or delete outside the connected Spotify folder.** Every path goes through
  `Domain/ReleaseLayout.swift` (`sanitizeSegment`, `isInside`); `ReleaseCoordinator.deleteRelease`
  refuses otherwise. Touch the folder only inside `SpotifyFolderAccess.withAccess` (sync/async).
- **Sync record file names and ids are plain child names, validated before use** —
  `ReleaseLayout.isPlainFileName`, applied before every download and read (issue #10).
- **Edits re-tag files in place; never rename or move a track** — Spotify playlists keep it.
- **User-facing strings live in `Resources/Copy.swift`; colors/spacing in `Resources/Theme.swift`.**
- **`LocallyTests` uses Swift Testing** (`import Testing`, `@Test`), not XCTest.
- **The share extension has no SwiftUI and no dependency on the `Locally` target.** It copies a
  shared item into the App Group Inbox inside the `loadFileRepresentation` callback itself — the
  temporary URL iOS hands it is deleted once that callback returns.

## Building and testing

```sh
cd apps/ios
xcodegen generate
xcodebuild -project Locally.xcodeproj -target Locally -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO
xcodebuild test -scheme Locally -destination 'platform=iOS Simulator,name=<device>'
```

The `.storekit` test configuration only attaches when the app is run from Xcode (Product ▸ Run).

## Before pushing

Build with `xcodebuild` (required by the root `CLAUDE.md`); if a simulator is available, also run
`xcodebuild test` above.
