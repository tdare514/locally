# iOS: M4A tag writer must check `replaceItemAt` and clean up its temp file (#12, slice A)

## Summary

`M4ATagWriter.write` re-exports the m4a into a sibling temp file and then swaps it over the
original with `FileManager.replaceItemAt`. The swap is wrapped in `try?` and its result is
discarded, so a failed swap looks like success to `ReleaseCoordinator`: the release is indexed
and (on import) moved/pushed with its *old* tags, and the freshly exported temp m4a is left
sitting next to the real track inside the Spotify folder, where Spotify's Local Files scanner
picks it up as a stray, untitled song.

Fix, in one file: treat a failed replace as a tagging failure (`LocallyError.taggingFailed`),
delete the temp file on every failure path, and leave the original untouched. Add a one-closure
seam so the replace step can be made to fail in a unit test.

This slice is iOS-only. It is one bullet of the #12 backlog; the other iOS bullets (ID3 size
guard, share-extension extension check and inbox sweep) are separate slices and are not touched.

## Current behaviour

```44:46:apps/ios/Locally/Services/M4ATagWriter.swift
        // Replace the original in place so callers can keep treating `url`
        // as the file's final location.
        _ = try? FileManager.default.replaceItemAt(url, withItemAt: tmpOutput)
```

Also relevant:

- `tmpOutput` is `url`'s directory + `<UUID>.m4a` (lines 22-24). When `url` is inside the Spotify
  folder, so is the temp file. Keep this placement: `replaceItemAt` needs both items on the same
  volume, and the coordinator has already inside-checked `url` before calling the writer.
- The export failure branch (lines 35-39) throws but never removes `tmpOutput`, which
  `AVAssetExportSession` may have partially written.
- The only callers are the four `writer.write(...)` sites in
  `apps/ios/Locally/Coordinator/ReleaseCoordinator.swift` (lines 61, 151, 258, 405). All of them
  already `try await` and propagate the error; none needs to change.

## Required behaviour

After this change `M4ATagWriter.write(_:cover:to:)` guarantees:

1. **Replace succeeds**: `url` is the tagged file (the export output now lives at `url`), and no
   file other than `url` that the writer created remains in `url`'s directory.
2. **Replace fails** (throws, or `url` does not exist afterwards): the writer deletes `tmpOutput`,
   then throws `LocallyError.taggingFailed(<detail>)`. The file at `url` is byte-for-byte the
   file that was there before the call.
3. **Export fails** (`.failed`, `.cancelled`, or an unexpected status): the writer deletes
   `tmpOutput` if it exists, then throws `LocallyError.taggingFailed` exactly as today.
4. `AVAssetExportSession` init failing still throws `taggingFailed("This device can't tag that
   file.")` before any temp file exists; nothing to clean up there.
5. No behaviour change for callers: same protocol (`TagWriter`), same error type, same
   `AppContainer` construction (`M4ATagWriter()` with no arguments still compiles).

## Files to change

| File | Change |
|------|--------|
| `apps/ios/Locally/Services/M4ATagWriter.swift` | Production fix + test seam (below). |
| `apps/ios/LocallyTests/M4ATagWriterTests.swift` | Move the tiny m4a into a per-test directory; add the three tests below. |

Nothing else:

- `apps/ios/LocallyTests/Fakes.swift`: **no change.** `FakeTagWriter` stays as is; the seam is a
  closure on the concrete writer, not a new `Services` protocol, so no fake type is needed.
- `apps/ios/project.yml`: **no change** (no source files added or removed). Still run
  `xcodegen generate` before building, per `apps/ios/AGENTS.md`.
- `apps/ios/Locally/App/AppContainer.swift` line 119 (`m4aTagWriter: M4ATagWriter()`): **no
  change**; the new init parameter has a default.
- `Copy.swift`: **no change.** The `taggingFailed` detail strings in this file are inline
  literals already ("This device can't tag that file.", "Tagging failed.", "Unexpected export
  state."); follow that pattern.

## Implementation (`M4ATagWriter.swift`)

### 1. Add the seam

Add a stored closure that performs the replace, defaulting to `FileManager`. Swift version is
5.10 (`project.yml`), so no `Sendable` annotation is required; the closure is called from the
same task after the export `await`, never from the export session's callback queue.

```swift
final class M4ATagWriter: TagWriter {
    /// Swaps `replacement` over `original` in place. Injected so tests can
    /// make the swap fail without touching AVFoundation's export path.
    typealias ReplaceItem = (_ original: URL, _ replacement: URL) throws -> Void

    private let replaceItem: ReplaceItem

    init(replaceItem: ReplaceItem = { original, replacement in
        _ = try FileManager.default.replaceItemAt(original, withItemAt: replacement)
    }) {
        self.replaceItem = replaceItem
    }
```

Do not introduce a protocol, a `FileSystem` abstraction, or a new fake for this; one closure
with a default is the whole seam.

### 2. Clean up on export failure

Inside the `withCheckedThrowingContinuation` callback nothing changes. Wrap the `await` so the
temp file is removed when the export throws:

```swift
        do {
            try await withCheckedThrowingContinuation { ... /* unchanged */ }
        } catch {
            removeTempOutput(tmpOutput)
            throw error
        }
```

(`error` is already a `LocallyError.taggingFailed` from the continuation; rethrow it unchanged.)

### 3. Check the replace

Replace lines 44-46 with:

```swift
        // Replace the original in place so callers can keep treating `url`
        // as the file's final location. A failed swap is a tagging failure:
        // the caller must not index a file whose tags never landed.
        do {
            try replaceItem(url, tmpOutput)
        } catch {
            removeTempOutput(tmpOutput)
            throw LocallyError.taggingFailed(error.localizedDescription)
        }
        guard FileManager.default.fileExists(atPath: url.path) else {
            removeTempOutput(tmpOutput)
            throw LocallyError.taggingFailed("The tagged file didn't land in place.")
        }
```

The `fileExists` guard covers `replaceItemAt` returning without throwing but leaving `url`
absent (its documented return value is the new item's URL, which the default closure discards).
After a successful replace `tmpOutput` no longer exists, so no cleanup runs on that path.

### 4. Cleanup helper

```swift
    /// Removes the writer's own temp export, if it exists. Only ever called
    /// with `tmpOutput`, a file this writer created next to `url`; never
    /// with `url` itself.
    private func removeTempOutput(_ tmpOutput: URL) {
        guard FileManager.default.fileExists(atPath: tmpOutput.path) else { return }
        try? FileManager.default.removeItem(at: tmpOutput)
    }
```

Cleanup is best-effort (`try?`) on purpose: the thrown `taggingFailed` is the error the user
needs to see, and a second failure removing the temp file must not mask it.

## Tests (`apps/ios/LocallyTests/M4ATagWriterTests.swift`)

### Why AVFoundation stays in this file

`apps/ios/AGENTS.md` bans AVFoundation in tests that exercise `ReleaseCoordinator` and the
views; those use `FakeTagWriter` and are unchanged. The writer's own tests are the one place
the real `AVAssetExportSession` runs, and `M4ATagWriterTests.swift` already does exactly that
(it builds a real 0.1 s m4a with `AVAudioFile` in `makeTinyM4A()`, as `AVTranscoderTests` does
for WAV). The new tests reuse that helper; they need the simulator, like every test in this
file today. There is no cheaper way to reach the replace step without also faking the export,
which would be a second seam this slice does not need.

Coordinator-level coverage of "tag write throws, so import/edit fails" already exists via
`FakeTagWriter.errorToThrow` (`ReleaseCoordinatorTests.swift` lines 55-56,
`ReleaseCoordinatorAlbumTests.swift` lines 103-104) and needs no addition.

### Helper change

`makeTinyM4A()` currently writes `<UUID>.m4a` straight into `temporaryDirectory`, which is
shared and noisy, so "no stray file remains" cannot be asserted. Change it to create a fresh
directory and return both:

```swift
    private func makeTinyM4A() throws -> (dir: URL, url: URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("M4ATagWriterTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("song.m4a")
        // ... existing AVAudioFile body, unchanged ...
        return (dir, url)
    }
```

Update the two existing tests to destructure `(dir, url)` and add
`defer { try? FileManager.default.removeItem(at: dir) }`. Add a small helper:

```swift
    private func fileNames(in dir: URL) throws -> [String] {
        try FileManager.default.contentsOfDirectory(atPath: dir.path).sorted()
    }
```

`M4ATagWriterTests` is a `struct` with `let writer = M4ATagWriter()`; keep that for the
existing tests and construct a writer locally in the new failure test.

### New tests

1. **`successfulWriteLeavesOnlyTheTaggedFile`**
   - `makeTinyM4A()`, `writer.write(tags, cover: nil, to: url)`.
   - `#expect(try fileNames(in: dir) == ["song.m4a"])`.
   - `let (title, _) = try await readBackTitleAndArtist(url)`; `#expect(title == "First Title")`
     (tags actually landed at `url`, i.e. behaviour 1).

2. **`failedReplaceThrowsTaggingFailedAndLeavesTheOriginalUntouched`**
   - `makeTinyM4A()`, `let before = try Data(contentsOf: url)`.
   - `let writer = M4ATagWriter(replaceItem: { _, _ in throw CocoaError(.fileWriteNoPermission) })`.
   - Assert the specific case. `LocallyError` is not `Equatable`, so use do/catch:

     ```swift
     do {
         try await writer.write(tags, cover: nil, to: url)
         Issue.record("write must throw when the replace fails")
     } catch let error as LocallyError {
         guard case .taggingFailed = error else {
             Issue.record("expected .taggingFailed, got \(error)")
             return
         }
     }
     ```

   - `#expect(try Data(contentsOf: url) == before)` (original untouched, behaviour 2).
   - `#expect(try fileNames(in: dir) == ["song.m4a"])` (temp file removed, behaviour 2).

3. **`unreadableInputThrowsAndLeavesNoTempFile`**
   - Create the per-test `dir`, write `Data("not audio".utf8)` to `dir/garbage.m4a` (same idea
     as `AVTranscoderTests.unreadableInputThrowsTranscodeFailedRatherThanCrashing`).
   - `await #expect(throws: LocallyError.self) { try await writer.write(tags, cover: nil, to: url) }`.
   - `#expect(try fileNames(in: dir) == ["garbage.m4a"])`.
   - This holds whichever way AVFoundation rejects the file: if `AVAssetExportSession` init
     returns `nil`, no temp file was ever created; if the export runs and fails, behaviour 3
     removed it. Either way the directory must contain only the input.

All three use `defer { try? FileManager.default.removeItem(at: dir) }` and only touch
`FileManager.default.temporaryDirectory`, never a real user directory.

## Checks

From `apps/ios/AGENTS.md`:

```sh
cd apps/ios
xcodegen generate
xcodebuild -project Locally.xcodeproj -target Locally -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO
xcodebuild test -scheme Locally -destination 'platform=iOS Simulator,name=<device>'
```

The build is required before pushing (root `CLAUDE.md`). Run `xcodebuild test` where a
simulator is available; the new tests need one, like the rest of `M4ATagWriterTests`. If the
implementation environment has no Xcode, say so in the PR and still name the commands above as
the check the reviewer runs.

Before pushing, `git diff` self-review: no leftover debug output, no test writing outside
`temporaryDirectory`, `AppContainer.swift` untouched.

## Security

- The temp file is created where it is today (next to `url`), so nothing new is written
  anywhere; the change only adds a delete, and the only path it ever deletes is `tmpOutput`, a
  `<UUID>.m4a` name the writer generated itself. `url` (the user's track) is never deleted by
  this code.
- No path is derived from tag text or file names supplied by the user; `tmpOutput` is
  `url.deletingLastPathComponent()` + a fresh UUID, exactly as before.
- The thrown detail is `error.localizedDescription` from `FileManager`, consistent with the
  existing `ID3TagWriter` error paths (lines 18 and 33), and does not include the full path
  beyond what Foundation already puts in that string.

## Non-goals

Do not touch any of these in this slice:

- `apps/ios/Locally/Services/ID3TagWriter.swift` (the 2^28 size guard is a separate #12 slice).
- `apps/ios/LocallyShare/` (the share extension's extension check and inbox sweep are another
  #12 slice).
- `apps/ios/Locally/Services/InboxStore.swift`, `SyncEngine.swift`, or anything under
  `apps/web` / `apps/api`.
- `ReleaseCoordinator.swift`: its error handling already propagates a thrown `write`; no
  coordinator change is needed for this fix to be user-visible.
- Moving `tmpOutput` to `temporaryDirectory` or another volume; `replaceItemAt` semantics
  depend on same-volume placement, and this is not the bug being fixed.
- Retrying a failed replace, or falling back to `moveItem`/`copyItem`.
- `FakeTagWriter` or any new protocol; the closure seam is sufficient.

## STATUS.md

`STATUS.md` line 50 records the #12 iOS items as remaining. This slice alone does not close
#12; leave that line as is unless the implementer's change also lands the other iOS bullets
(it should not; see Non-goals). Do not edit `STATUS.md` in this slice.

## Acceptance checklist for the implementer

- [ ] `M4ATagWriter` has `init(replaceItem:)` with a `FileManager.replaceItemAt` default; `M4ATagWriter()` still compiles.
- [ ] Export failure and replace failure both remove `tmpOutput` and throw `LocallyError.taggingFailed`.
- [ ] After a successful `write`, `url` exists with the new tags and no `<UUID>.m4a` sibling remains.
- [ ] `M4ATagWriterTests` gains the three tests above; existing two tests still pass with the per-test directory.
- [ ] `Fakes.swift`, `project.yml`, `AppContainer.swift`, `ID3TagWriter.swift`, `LocallyShare/`, `STATUS.md` unchanged.
- [ ] `xcodegen generate` + `xcodebuild` build passes; `xcodebuild test` passes where a simulator exists.
