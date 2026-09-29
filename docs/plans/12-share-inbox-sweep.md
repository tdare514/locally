# iOS share extension: reject unknown extensions and sweep the Inbox (#12, slice C)

Single-app slice (iOS only) of the #12 hardening backlog. It lives in `docs/plans/` so the
implementation session can work from a fixed contract without redesigning it. Only `apps/ios`
changes; `spec/` and the other apps are untouched.

## Summary

The "Send to Locally" share extension copies every item that conforms to `public.audio` into the
App Group `Inbox` folder, and `AppGroupInboxStore` lists whatever `UTType` says is audio. Neither
side knows what the app can actually import, so an `.ogg`, `.opus` or `.caf` share lands in the
Inbox, is never listed (or is listed and then fails at transcode), and is never deleted. Nothing
ever removes a file the extension left behind, so the App Group container grows forever.

This plan:

1. defines one allow-list of file extensions the import path accepts, compiled into both targets;
2. makes the share extension refuse anything off that list *before* it copies, and clean up its
   own destination if a copy fails midway;
3. makes `AppGroupInboxStore.pendingFiles()` use the same allow-list instead of `UTType.audio`;
4. adds `sweepOrphans()` to the inbox store, deleting Inbox files that can never be imported or
   were left behind, and runs it every time the app refreshes the inbox.

The sweep touches only the App Group `Inbox` folder. The app's Documents folder ("On My iPhone >
Locally") is listed but never swept (see "Documents is left alone").

## The allow-list

Confirmed from the import path:

- `apps/ios/Locally/Services/Transcoder.swift`: `AVTranscoder.passthroughExtensions = ["mp3", "m4a"]`;
  everything else is exported through `AVAssetExportSession` with `AVAssetExportPresetAppleM4A`.
- `docs/ios-plan.md` line 15: "Conversion: AAC 256 kbps m4a for wav/flac/aiff; mp3 and m4a pass
  through."
- The tag writers (`M4ATagWriter`, `ID3TagWriter`) only ever see mp3 or m4a, because the
  transcoder runs first.

So the allow-list, compared case-insensitively on the file extension, is exactly:

```
mp3  m4a  wav  flac  aiff  aif
```

(`aif` is the common short spelling of AIFF; both are the same container and both are readable by
AVFoundation.) A name with no extension is rejected. Nothing else (`ogg`, `opus`, `aac`, `caf`,
`wma`, `alac`, `mp4`, `mov`, …) is accepted anywhere in this slice, even where AVFoundation might
happen to read it; widening the list is a separate product decision and needs a transcoder test.

Do not change `AVTranscoder`. The allow-list documents its behaviour; it does not replace the
`passthroughExtensions` set.

## Current behaviour (for orientation)

- `apps/ios/LocallyShare/ShareViewController.swift`
  - `save(_:)` checks `provider.hasItemConformingToTypeIdentifier(UTType.audio.identifier)`,
    creates the Inbox folder, then inside the `loadFileRepresentation` completion handler builds
    `InboxFileNaming.fileName(id: UUID(), originalName: url.lastPathComponent)` and
    `FileManager.copyItem(at:to:)`. The copy *must* stay inside that handler: the temporary URL is
    deleted when the handler returns.
  - `handleSharedItems()` counts saves; any save → "Saved to Locally. Open Locally to tag and
    send.", none → the last error's description. Strings are inline (the extension cannot use
    `Resources/Copy.swift`, which is in the `Locally` target).
  - A failed `copyItem` can leave a partial destination behind; nothing removes it.
- `apps/ios/Locally/Services/InboxStore.swift`
  - `protocol InboxStore { pendingFiles(); remove(_:) }`.
  - `AppGroupInboxStore` has the production init (`appGroupIdentifier:`) and the test init
    `init(directory: URL, documentsDirectory: URL? = nil)`.
  - `audioFiles(in:originalName:)` skips hidden names, names the closure rejects, and
    directories, then keeps a file only if `UTType(filenameExtension:)` conforms to `.audio`.
    Reads `.creationDate` (the privacy manifest already declares the file-timestamp API reason
    `C617.1` for this).
- `apps/ios/Locally/Views/Import/ImportView.swift`: `refreshInbox()` (called `onAppear` and when
  `scenePhase` becomes `.active`) calls `container.inbox.pendingFiles()` and filters out paths
  already in the library.
- `ImportSingleViewModel.pick` and `AlbumBuilderViewModel.addFiles` call `inbox.remove(file)`
  right after `FileImporter.stage` copies the file out. That is the only place Inbox files are
  deleted today.
- `apps/ios/Shared/` (`AppGroup.swift`, `InboxFileNaming.swift`) is compiled into both targets
  via `project.yml` (`sources: - path: Shared` under both `Locally` and `LocallyShare`).
- `apps/ios/LocallyTests/Fakes.swift`: `FakeInboxStore` is the in-memory `InboxStore`.

## Behaviour to implement

### A. One shared allow-list

New file `apps/ios/Shared/SupportedAudio.swift`:

```swift
import Foundation

/// File extensions the import path accepts. mp3 and m4a pass through
/// `AVTranscoder`; wav, flac and aiff/aif are converted to m4a. Compiled into
/// both the app and the share extension so they can never disagree about
/// what is worth copying into the Inbox.
enum SupportedAudio {
    static let extensions: Set<String> = ["mp3", "m4a", "wav", "flac", "aiff", "aif"]

    /// True when `fileName` has an extension (case-insensitive) on the list.
    static func isSupported(fileName: String) -> Bool {
        let ext = (fileName as NSString).pathExtension.lowercased()
        return !ext.isEmpty && extensions.contains(ext)
    }

    /// For user-facing messages: "mp3, m4a, wav, flac or aiff".
    static let readableList = "mp3, m4a, wav, flac or aiff"
}
```

Because `project.yml` lists the `Shared` directory as a source path for both targets, the new
file is picked up by `xcodegen generate`; no `project.yml` edit is needed.

### B. Share extension rejects before copying

File: `apps/ios/LocallyShare/ShareViewController.swift`. No SwiftUI, no import of the `Locally`
module; only `Shared/` types.

1. Keep the existing `hasItemConformingToTypeIdentifier(UTType.audio.identifier)` guard (it is
   the cheap pre-check; the activation rule in `project.yml` is unchanged).
2. Inside the `loadFileRepresentation` completion handler, after `startAccessingSecurityScopedResource`
   and **before** `copyItem`, add:

   ```swift
   let originalName = url.lastPathComponent
   guard SupportedAudio.isSupported(fileName: originalName) else {
       continuation.resume(throwing: ShareError.unsupportedFormat(extension: url.pathExtension))
       return
   }
   ```

   The check has to be inside the handler because the real file name (and therefore the
   extension) is only known there. `NSItemProvider.suggestedName` is not reliable enough to
   check earlier; do not use it.
3. In the `catch` around `copyItem`, remove a partial destination before rethrowing:

   ```swift
   } catch {
       try? FileManager.default.removeItem(at: destination)
       continuation.resume(throwing: error)
   }
   ```

   `destination` is always `inboxDirectory.appendingPathComponent(destinationName)`, a child of
   the Inbox folder, so this can never delete anything outside it.
4. Add `case unsupportedFormat(extension: String)` to `ShareError` with the description
   `"Locally can't import .<ext> files. Share \(SupportedAudio.readableList)."` (when the extension
   is empty: `"Locally can't import that file. Share \(SupportedAudio.readableList)."`).
5. Result messages in `handleSharedItems()`. Track `savedCount`, `unsupportedCount` (throws of
   `.unsupportedFormat`) and `lastError` as today:
   - `savedCount > 0 && unsupportedCount == 0` → unchanged: "Saved to Locally. Open Locally to
     tag and send."
   - `savedCount > 0 && unsupportedCount > 0` → "Saved \(savedCount) to Locally, skipped
     \(unsupportedCount) it can't import. Open Locally to tag and send."
   - `savedCount == 0` → unchanged: `lastError ?? "Couldn't save that file."` (for a single
     unsupported share this is the `.unsupportedFormat` text).

Nothing else in the controller changes. In particular the UUID-prefixed naming, the App Group
lookup and `completeRequest` stay as they are.

### C. `pendingFiles()` uses the allow-list

File: `apps/ios/Locally/Services/InboxStore.swift`, `AppGroupInboxStore.audioFiles(in:originalName:)`.

Replace

```swift
let type = UTType(filenameExtension: url.pathExtension)
guard let type, type.conforms(to: .audio) else { continue }
```

with

```swift
guard SupportedAudio.isSupported(fileName: name) else { continue }
```

This applies to both the Inbox and the Documents scan: a `.ogg` in Documents is no longer offered
as "waiting" (it would only fail at transcode). Drop `import UniformTypeIdentifiers` from the file
if nothing else uses it. Everything else in `audioFiles` (hidden names, `originalName` closure,
directory skip, `creationDate`) stays.

### D. The sweep

Add to the protocol:

```swift
protocol InboxStore {
    func pendingFiles() -> [InboxFile]
    func remove(_ file: InboxFile) throws
    /// Deletes Inbox files that can never be imported or were left behind
    /// (see `AppGroupInboxStore.sweepOrphans`). Returns how many were removed.
    @discardableResult
    func sweepOrphans() -> Int
}
```

`FakeInboxStore` (`LocallyTests/Fakes.swift`) implements it as `sweepCalls += 1; return 0` with a
`private(set) var sweepCalls = 0`.

`AppGroupInboxStore.sweepOrphans()`:

- Operates on `inboxDirectory` only. If it is `nil` or does not exist, return 0. **Never** looks
  at `documentsDirectory`.
- `static let orphanGracePeriod: TimeInterval = 60 * 60` (one hour).
- For each `name` in `contentsOfDirectory(atPath:)` of the Inbox folder, with
  `url = inboxDirectory.appendingPathComponent(name)`:
  1. Skip hidden names (`name.hasPrefix(".")`) and directories (`fileExists(atPath:isDirectory:)`
     says directory). Neither is ever deleted.
  2. Read `attributesOfItem`. `age` is `now - modificationDate`, falling back to
     `creationDate`; if neither exists, the file is treated as **fresh** (never deleted by an
     age-based rule). `size` is `(attributes[.size] as? NSNumber)?.intValue ?? -1`.
  3. Apply the rules in this order; the first that matches decides. Delete with
     `try? FileManager.default.removeItem(at: url)` and count it only if the file is gone
     afterwards.

  | # | Condition | Action | Why it is safe |
  |---|-----------|--------|----------------|
  | R1 | `!SupportedAudio.isSupported(fileName: name)` | delete, any age | `pendingFiles()` will never list it and the import path could never handle it; nothing can make it valid later. A valid share always has a supported extension, so this rule never touches one. |
  | R2 | `InboxFileNaming.originalName(fromInboxFileName: name) == nil` (supported extension but not the `<uuid>-<name>` scheme) | delete if `age > orphanGracePeriod`, else keep | Only the extension writes here, and it always uses the scheme, so an off-scheme file is a leftover from an older build or a bug. The grace period protects anything a future writer might be mid-way through. |
  | R3 | `size == 0` | delete if `age > orphanGracePeriod`, else keep | A copy that never received data (extension killed mid-copy, or `copyItem` failed before the cleanup in B.3 existed). A genuinely empty audio file cannot be imported either. |
  | R4 | otherwise (supported, in-scheme, non-empty) | **keep, regardless of age** | This is a valid pending share. It is visible in the Import tab ("N waiting" chip and banner) until the user imports it, at which point `remove(_:)` deletes it. The Inbox is the only copy the app has; deleting it on a timer would silently lose something the user shared on purpose. |

- Return the number deleted. Failures to delete are ignored (the file is retried on the next
  sweep); do not throw.
- Reading `modificationDate` is covered by the same privacy-manifest reason (`C617.1`,
  file-timestamp API) already declared for `creationDate`; no manifest change.

### E. When the sweep runs

File: `apps/ios/Locally/Views/Import/ImportView.swift`, `refreshInbox()`. Call
`container.inbox.sweepOrphans()` as the first statement, before `pendingFiles()`:

```swift
private func refreshInbox() {
    guard let container else { return }
    container.inbox.sweepOrphans()
    let knownPaths = ...
    inboxFiles = container.inbox.pendingFiles().filter { !knownPaths.contains($0.url.path) }
}
```

`refreshInbox()` already runs on appear and whenever `scenePhase` becomes `.active`, which is the
only time the Inbox can have changed (the extension runs while the app is not in the foreground).
The Inbox holds a handful of files at most; a synchronous directory pass on the main actor next to
the existing `pendingFiles()` listing is fine. No new timer, no background task, no change to
`RootView` or `AppContainer`.

### F. Documents is left alone

`AppGroupInboxStore` also lists the app's Documents folder (Files → "On My iPhone > Locally").
The sweep must **not** run there:

- Files there were put there by the user on purpose ("Save to Files", copy in Files). They are
  user data, not a staging copy, and the user may keep non-audio or unsupported files next to
  their music.
- The connected Spotify folder can be that same folder (see the `knownPaths` comment in
  `refreshInbox()`), and the iOS rule is "never write or delete outside the connected Spotify
  folder, and only through `ReleaseCoordinator` inside `SpotifyFolderAccess.withAccess`". A sweep
  in Documents would be a second, unguarded deletion path.
- The only effect of this slice on Documents is C above: unsupported audio is no longer listed as
  waiting. It stays on disk.

## Files to change

| File | Change |
|------|--------|
| `apps/ios/Shared/SupportedAudio.swift` | **new** — allow-list + `isSupported(fileName:)` + `readableList` (A) |
| `apps/ios/LocallyShare/ShareViewController.swift` | reject unsupported inside the handler before copy; delete partial destination on copy failure; `ShareError.unsupportedFormat`; mixed-result message (B) |
| `apps/ios/Locally/Services/InboxStore.swift` | `sweepOrphans()` on the protocol and `AppGroupInboxStore`; `audioFiles` uses the allow-list (C, D) |
| `apps/ios/Locally/Views/Import/ImportView.swift` | call `sweepOrphans()` at the top of `refreshInbox()` (E) |
| `apps/ios/LocallyTests/Fakes.swift` | `FakeInboxStore.sweepOrphans()` (returns 0, counts calls) |
| `apps/ios/LocallyTests/SupportedAudioTests.swift` | **new** |
| `apps/ios/LocallyTests/AppGroupInboxStoreTests.swift` | new cases below |
| `apps/ios/README.md` | in the share-extension/inbox paragraph (~lines 154–168): one sentence each for "the extension only copies mp3/m4a/wav/flac/aiff" and "`ImportView` sweeps orphans before listing" |
| `STATUS.md` | line ~50: the #12 iOS items — mark the share-extension item done, leave the M4A/ID3 writer items open (they are separate slices) |

Do **not** touch `M4ATagWriter`, `ID3TagWriter`, `SyncEngine`, `Transcoder`, `InboxFileNaming`,
`project.yml`, the activation rule, or the `spec/` files. `Locally.xcodeproj` is regenerated, not
edited.

## Compatibility

- Inbox on-disk format is unchanged (`<uuid>-<original name>`); an old extension build and a new
  app build interoperate. Files an old extension copied with an unsupported extension are removed
  by R1 on the app's next foreground.
- `InboxStore` gains a requirement; the only conformers are `AppGroupInboxStore` and
  `FakeInboxStore`.
- No change to `spec/metadata.md`, `spec/sync.md`, `apps/web` or `apps/api`.

## Security implications

- Every deletion target in the sweep is `inboxDirectory.appendingPathComponent(name)` with
  `name` taken from `contentsOfDirectory(atPath:)`, so it is a plain child of the App Group Inbox
  folder; the sweep cannot reach outside it. Directories are skipped, so a symlink to a directory
  is skipped too, and removing a symlinked file removes the link, not the target.
- The extension refuses unsupported input before it writes anything, so the App Group container
  can no longer be filled with files the app never reads, and a failed copy no longer leaves a
  partial file.
- The Documents folder, the Spotify folder and the app's tmp directory are not touched.
- No new strings from user input are interpolated into paths: the extension's destination name is
  still `InboxFileNaming.fileName(id:originalName:)`, and the app still re-derives its own file
  name through `ReleaseLayout` at import.

## Tests

All under `apps/ios/LocallyTests`, Swift Testing (`import Testing`, `@Test`), temp directories
only (`FileManager.default.temporaryDirectory/<UUID>`), constructed with
`AppGroupInboxStore(directory:documentsDirectory:)`. No App Group container, no AVFoundation.

Helper to add to `AppGroupInboxStoreTests` next to `writeInboxFile`: `setAge(_ url: URL, secondsAgo:)`
that sets both `.modificationDate` and `.creationDate` via `setAttributes(_:ofItemAtPath:)`, and a
`writeRaw(name:bytes:in:)` for off-scheme / empty files. Use `2 * 60 * 60` for "stale" and no
backdating for "fresh".

### `SupportedAudioTests.swift` (new)

- Accepts `song.mp3`, `song.m4a`, `song.wav`, `song.flac`, `song.aiff`, `song.aif`.
- Case-insensitive: `SONG.MP3`, `Song.Flac`.
- Rejects `song.ogg`, `song.opus`, `song.aac`, `song.caf`, `song.mp4`, `cover.jpg`, `notes.txt`.
- Rejects a name with no extension (`song`) and a trailing dot (`song.`).
- `readableList` mentions every entry of `extensions` except `aif` (guards the message against
  drifting from the set).

### `AppGroupInboxStoreTests.swift` (additions)

Listing (C):

- `pendingFilesListsEverySupportedExtension`: one in-scheme file per allow-list entry plus an
  upper-case `LOUD.MP3`; all seven are listed.
- `pendingFilesIgnoresAudioTheAppCannotImport`: in-scheme `song.ogg` and `song.caf` (both conform
  to `UTType.audio`, which is exactly what used to leak through) are not listed; `song.mp3` is.
- Same for Documents: `documentsDirectory` holding `a.ogg` and `b.mp3` lists only `b.mp3`, and
  `a.ogg` still exists on disk afterwards.
- Existing tests keep passing unchanged (`cover.jpg` ignored, hidden ignored, off-scheme
  `stray.mp3` ignored, missing directory → empty, remove semantics, Documents listing).

Sweep (D, F):

- `sweepDeletesUnsupportedInboxFilesImmediately`: fresh in-scheme `cover.jpg` and `song.ogg` and a
  fresh in-scheme `song.mp3` → returns 2, only `song.mp3` remains.
- `sweepKeepsFreshOffSchemeFilesAndDeletesStaleOnes`: raw `stray.mp3` fresh and `old.mp3` stale →
  returns 1, `stray.mp3` remains.
- `sweepDeletesStaleEmptyFilesButKeepsFreshEmptyOnes`: two zero-byte in-scheme `.mp3` files, one
  stale one fresh → returns 1, the fresh one remains.
- `sweepNeverDeletesAValidPendingFileHoweverOld`: in-scheme non-empty `song.mp3` aged 400 days →
  returns 0, still listed by `pendingFiles()`.
- `sweepSkipsDirectoriesAndHiddenFiles`: a directory named `junk.ogg`, a stale hidden `.junk.ogg`
  → returns 0, both remain.
- `sweepNeverTouchesTheDocumentsFolder`: Documents holding stale `stray.mp3`, `song.ogg`,
  `notes.txt` and an empty stale `empty.mp3`; Inbox holding one unsupported file → returns 1 and
  every Documents file still exists.
- `sweepOnAMissingDirectoryReturnsZero`.
- `sweepThenPendingFilesAgree`: after a sweep, every file `pendingFiles()` returns still exists
  and every remaining Inbox file is either listed, hidden, a directory, or a fresh R2/R3 case.

View model tests (`ImportSingleViewModelInboxTests`, `AlbumBuilderViewModelInboxTests`) need no
change; `FakeInboxStore` just gains the new method.

### Share extension

`LocallyShare` has no test target and must not depend on the app. Its rejection is a call to
`SupportedAudio.isSupported(fileName:)`, which `SupportedAudioTests` covers in the app test
bundle; the copy-inside-handler structure is unchanged. After the build, if a simulator is
available, the manual check is: share an `.ogg` from Files → the sheet shows "Locally can't
import .ogg files…" and the Inbox folder gains no file; share an `.mp3` → saved as before.

## Checks (from `apps/ios/AGENTS.md`)

```sh
cd apps/ios
xcodegen generate          # required: two new source files
xcodebuild -project Locally.xcodeproj -target Locally -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO
xcodebuild test -scheme Locally -destination 'platform=iOS Simulator,name=<device>'   # if a simulator is available
```

The build must also compile the `LocallyShare` target (it is embedded in `Locally`), which is what
verifies the extension only uses `Shared/` types.

Before pushing: `git diff` self-review — no debug prints, tests write only under
`temporaryDirectory`, `Locally.xcodeproj` changes come from `xcodegen generate` only. Stage
files explicitly with `git add <path>`.

## Not in this plan

- Widening the allow-list (e.g. `aac`, `caf`, `mp4` audio). Needs an `AVTranscoderTests` case
  per format first.
- A time-to-live for valid pending shares (R4). Deliberately excluded: the file is visible and
  actionable in the UI, and the Inbox copy is the app's only copy.
- Sweeping or filtering the Documents folder beyond "unsupported audio is not listed".
- The other #12 iOS items (`M4ATagWriter` `replaceItemAt` result and temp cleanup; `ID3TagWriter`
  size guard and double-buffering). Separate slices.
- Changing the `NSExtensionActivationRule` to enumerate formats. `public.audio` keeps the
  extension visible for the common cases; the in-handler check is the enforcement point.
