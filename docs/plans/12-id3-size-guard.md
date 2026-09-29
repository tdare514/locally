# iOS ID3 writer: guard the synchsafe size limit and stop double-buffering (#12, slice B)

## Summary

`ID3TagWriter.write` (`apps/ios/Locally/Services/ID3TagWriter.swift`) has two problems from the
Sep 27 security review (#12):

1. ID3v2.4 sizes are 4-byte synchsafe integers: 28 usable bits, so a tag body must be strictly
   below 2^28 bytes (256 MiB). `synchsafe(_:)` silently keeps only the low 28 bits, so a tag body
   at or above 2^28 (realistically: a huge cover) writes a header whose declared size does not
   match the frames that follow. The file is then corrupt and nothing reports it.
2. The writer loads the whole file with `Data(contentsOf:)`, then appends header + frames + audio
   into a second `Data` before writing. For a long mp3 the input and the output are both fully in
   memory at once, on a phone, in a path the share extension can also reach indirectly.

Fix: build the frames first, refuse (with `LocallyError.taggingFailed`) when they are not
encodable, and only then touch the file: stream the audio bytes from the original through a
sibling temp file in fixed-size chunks and swap it into place with `replaceItemAt`. The file on
disk is never modified before every check has passed, and peak memory becomes
`frames + one chunk` instead of `2 × file`.

This slice is iOS-only. It does not change `spec/*`, the sync contract, or any other app.

## Current behaviour (what the implementer is changing)

`apps/ios/Locally/Services/ID3TagWriter.swift`, `write(_:cover:to:)`, lines 13–35:

- `original = Data(contentsOf: url)` (whole file), wrapped into `taggingFailed` on error.
- `audio = Self.stripExistingID3Header(from: original)` (a slice; no copy, but keeps
  `original` alive).
- `frames = buildFrames(tags:cover:)`, `header = buildHeader(framesSize: frames.count)`.
- A new `Data` gets `header`, `frames`, `audio` appended (second full copy), then
  `output.write(to: url, options: .atomic)`.

`stripExistingID3Header(from:)` (lines 128–136) is `static`, is called by `ID3TagWriterTests`
(`audioSuffix(of:)`) and `ID3MalformedInputTests` directly, and must keep its signature and
its exact recovery behaviour (return the input unchanged whenever the header is unusable).

Callers: `ReleaseCoordinator` picks `id3TagWriter` for `.mp3` (`writer(for:)`, ~line 595) and
only depends on the `TagWriter` protocol (`apps/ios/Locally/Services/TagWriter.swift`); it
already surfaces thrown `LocallyError`s to the UI. Nothing else calls the writer.
`AppContainer` constructs it with `ID3TagWriter()` (line 120) — that call must keep compiling.

## Files

| File | Change |
| --- | --- |
| `apps/ios/Locally/Services/ID3TagWriter.swift` | Size guard, streaming write, shared header-length helper. |
| `apps/ios/LocallyTests/ID3TagWriterTests.swift` | Per-test directory helper; new guard, boundary, chunking and temp-file tests. |
| `apps/ios/LocallyTests/ID3MalformedInputTests.swift` | Existing tests unchanged; add two `write` cases over the streaming path. |

No other file. No `project.yml` change (no files added or removed, so no `xcodegen generate` is
needed, but running it is harmless).

## Design

### 1. Size guard

Add to `ID3TagWriter`:

```swift
/// Exclusive upper bound for any ID3v2.4 size field: 4 synchsafe bytes carry 28 bits.
static let synchsafeLimit = 1 << 28

/// True when `value` fits a 4-byte synchsafe integer.
static func canEncodeSynchsafe(_ value: Int) -> Bool {
    value >= 0 && value < synchsafeLimit
}

/// Tag bodies (all frames together) must be strictly below this. Production uses
/// `synchsafeLimit`; tests inject a small value so the rejection path runs on a few KB.
private let tagBodyLimit: Int

init(tagBodyLimit: Int = ID3TagWriter.synchsafeLimit) {
    self.tagBodyLimit = tagBodyLimit
}
```

The guard in `write`, before any file access:

```swift
let frames = buildFrames(tags: tags, cover: cover)
guard frames.count < tagBodyLimit else {
    throw LocallyError.taggingFailed("That cover is too large to store in an mp3.")
}
```

Rules:

- Reject when the ID3 body (all frames, `frames.count`) is `>= 2^28`. Because the body size is
  the sum of every frame's `10 + payload.count`, a body below 2^28 implies every per-frame
  payload size is also below 2^28, so no second check on `frame(_:payload:)` is needed.
- The guard runs before the file is opened, so on rejection the file is untouched by
  construction (no temp file is created either).
- The thrown error is `LocallyError.taggingFailed(String)`; nothing new in `Errors.swift`. The
  message is an inline string, matching the existing `taggingFailed("This device can't tag that
  file.")` precedent in `M4ATagWriter` and the inline details in `Errors.swift`.
- Leave `synchsafe(_:)` and `desynchsafe(_:)` as they are (tests call both). Do not add a
  `precondition` to `synchsafe` — the guard upstream is the check; a trap would turn a bad cover
  into a crash.

### 2. Streaming write (no double-buffering)

Chosen approach: **stream the audio through a sibling temp file with `FileHandle`**, then
`replaceItemAt`. Not chosen: keeping `Data(contentsOf:)` and only dropping `original` earlier
(still holds the whole file once, and `Data.append` still copies), or memory-mapped `Data`
(`.mappedIfSafe` is silently ignored on some volumes and interacts badly with the file being
replaced underneath it). No library change; Foundation only.

Add two private constants and one static helper:

```swift
/// Audio is copied in chunks of this size; peak memory is frames + one chunk.
private static let copyChunkSize = 1 << 20 // 1 MiB

/// Byte count of a usable ID3v2 header at the start of a file whose first (up to) 10 bytes
/// are `prefix` and whose total length is `fileLength`; 0 when there is none or it cannot
/// be trusted (too short, no "ID3" magic, or a declared size that runs past the file).
static func existingID3HeaderLength(prefix: Data, fileLength: Int) -> Int {
    guard prefix.count >= 10 else { return 0 }
    let bytes = [UInt8](prefix.prefix(10))
    guard bytes[0] == 0x49, bytes[1] == 0x44, bytes[2] == 0x33 else { return 0 }
    let framesSize = desynchsafe(Array(bytes[6...9]))
    let totalHeaderSize = 10 + framesSize
    guard totalHeaderSize <= fileLength else { return 0 }
    return totalHeaderSize
}
```

Rewrite `stripExistingID3Header(from:)` on top of it so both paths share one parsing rule and
the malformed-input suite keeps covering the streaming path:

```swift
static func stripExistingID3Header(from data: Data) -> Data {
    let skip = existingID3HeaderLength(prefix: data.prefix(10), fileLength: data.count)
    return data.suffix(from: data.startIndex + skip)
}
```

(`data.prefix(10)` is a slice with a non-zero `startIndex` when `data` is itself a slice; the
helper indexes via `[UInt8](...)`, exactly as the current code does, so that is safe.)

New `write`:

```swift
func write(_ tags: TagSet, cover: Data?, to url: URL) async throws {
    let frames = buildFrames(tags: tags, cover: cover)
    guard frames.count < tagBodyLimit else {
        throw LocallyError.taggingFailed("That cover is too large to store in an mp3.")
    }
    let header = buildHeader(framesSize: frames.count)

    // Same directory as the target so `replaceItemAt` is a rename on the same volume,
    // and `.tmp` so Spotify's scanner never picks it up if the app dies mid-write.
    let tmp = url.deletingLastPathComponent()
        .appendingPathComponent(UUID().uuidString)
        .appendingPathExtension("tmp")

    do {
        try Self.assemble(header: header, frames: frames, audioFrom: url, into: tmp)
        _ = try FileManager.default.replaceItemAt(url, withItemAt: tmp)
    } catch {
        try? FileManager.default.removeItem(at: tmp)
        throw LocallyError.taggingFailed(error.localizedDescription)
    }
}

/// Writes `header` + `frames` + the audio bytes of `source` (its existing ID3 header, if
/// any, skipped) into `destination`, copying audio in `copyChunkSize` pieces.
private static func assemble(header: Data, frames: Data, audioFrom source: URL, into destination: URL) throws {
    let input = try FileHandle(forReadingFrom: source)
    defer { try? input.close() }

    let fileLength = try input.seekToEnd()
    try input.seek(toOffset: 0)
    let prefix = try input.read(upToCount: 10) ?? Data()
    let skip = existingID3HeaderLength(prefix: prefix, fileLength: Int(clamping: fileLength))
    try input.seek(toOffset: UInt64(skip))

    guard FileManager.default.createFile(atPath: destination.path, contents: nil) else {
        throw CocoaError(.fileWriteUnknown)
    }
    let output = try FileHandle(forWritingTo: destination)

    try output.write(contentsOf: header)
    try output.write(contentsOf: frames)
    while let chunk = try input.read(upToCount: copyChunkSize), !chunk.isEmpty {
        try output.write(contentsOf: chunk)
    }
    try output.close()
}
```

Notes for the implementer:

- `replaceItemAt` is called with `try`, not `try?`: a failed swap throws and becomes
  `taggingFailed`, the temp file is removed, and the original is still intact (the swap is the
  only step that can alter `url`, and it is atomic).
- `output.close()` is called explicitly (once) before the swap so every byte is flushed. Do not
  add a `defer { try? output.close() }` as well: closing a `FileHandle` twice can raise an
  Objective-C exception that Swift `try?` cannot catch. If `assemble` throws midway, `output`
  goes out of scope and the URL-based `FileHandle` initialisers close their descriptor on
  deinit; the caller then removes `tmp`. `input` is closed by its `defer`, which runs once.
- `read(upToCount:)` returns `nil` or an empty `Data` at end of file depending on the OS
  version; the `while let ..., !chunk.isEmpty` condition handles both.
- An empty source, a source shorter than 10 bytes, or a source whose "header" declares more
  bytes than exist all give `skip == 0` and copy every original byte as audio — identical to
  today, which is what `ID3MalformedInputTests` asserts.
- `LocallyError` thrown inside the `do` (there is none today) would be re-wrapped; that is
  acceptable, but if a future edit adds one, add a `catch let error as LocallyError` clause
  first that removes `tmp` and rethrows unchanged.
- All the FileHandle APIs used (`seekToEnd`, `seek(toOffset:)`, `read(upToCount:)`,
  `write(contentsOf:)`, `close()`) are iOS 13.4+; the deployment target is 17.0.
- Delete the now-unused `Data(contentsOf:)` block and the `output` `Data`. Keep the class doc
  comment; add one sentence that audio is streamed and tags are bounded by the synchsafe limit.

### Security and invariants

- **Never write outside the Spotify folder / library**: the only new path is `tmp`, a sibling
  of `url` (`url.deletingLastPathComponent()`), so it is inside whatever directory the
  coordinator already validated for `url`. `M4ATagWriter` uses the same sibling-temp pattern.
- **Untrusted input**: the only bytes parsed from the file are the 10-byte prefix, via the same
  bounds-checked helper the malformed-input suite already exercises. A hostile declared size
  cannot cause a seek past EOF (`totalHeaderSize <= fileLength` or it is ignored).
- **No new user-facing behaviour** except the new failure message on an oversized tag.
- **Failure leaves no debris**: every error path removes `tmp`; a rejection before the file is
  opened never creates it.

## Tests (Swift Testing, temp directories only)

All files are created under `FileManager.default.temporaryDirectory`, never under Documents,
the App Group container, or any real Spotify folder. Every test that creates a directory removes
it in a `defer`.

### `apps/ios/LocallyTests/ID3TagWriterTests.swift`

Change the `makeFile()` helper to create a **per-test directory** so a test can assert what else
is in the directory (the shared temp dir is used by other suites running in parallel):

```swift
/// A fresh directory holding one `track.mp3`; the caller removes the directory.
private func makeFile(audio: Data? = nil) throws -> (dir: URL, url: URL) {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let url = dir.appendingPathComponent("track.mp3")
    try (audio ?? fakeAudioBytes()).write(to: url)
    return (dir, url)
}
```

Update the four existing tests to destructure `(dir, url)` and add
`defer { try? FileManager.default.removeItem(at: dir) }`; their assertions do not change.

Add:

- `defaultLimitIsTheSynchsafeLimit` — `ID3TagWriter.synchsafeLimit == 1 << 28`;
  `canEncodeSynchsafe((1 << 28) - 1) == true`; `canEncodeSynchsafe(1 << 28) == false`;
  `canEncodeSynchsafe(-1) == false`.
- `rejectsATagBodyAtTheLimitAndLeavesTheFileUntouched` — `ID3TagWriter(tagBodyLimit: 1024)`,
  a 2048-byte cover; capture the file bytes before; the call must throw `LocallyError` and the
  case must be `.taggingFailed`; the file bytes after equal the bytes before; the directory
  lists exactly `["track.mp3"]` (no temp file). Assert the error case like this (there is no
  `Equatable` on `LocallyError`):

```swift
do {
    try await writer.write(tags(), cover: cover, to: url)
    Issue.record("expected taggingFailed")
} catch let error as LocallyError {
    guard case .taggingFailed = error else {
        Issue.record("unexpected LocallyError \(error)")
        return
    }
}
```

- `acceptsATagBodyOneByteBelowTheLimitAndRejectsAtIt` (exact boundary, no dependence on
  internals): write once with the default writer, read the declared size `S` from bytes 6..9
  with `desynchsafe`; then `ID3TagWriter(tagBodyLimit: S + 1)` on a fresh copy succeeds and
  `ID3TagWriter(tagBodyLimit: S)` on another fresh copy throws `taggingFailed`.
- `streamsAudioLargerThanOneChunkByteForByte` — audio of `(2 << 20) + 4097` bytes (two full
  1 MiB chunks plus a partial tail; use `fakeAudioBytes(count:)`); after `write`, `parse` shows
  the frames and `audio == original audio` exactly. Also run it with an existing ID3 header
  prefixed onto the audio (write twice, as `writingTwiceDoesNotStackHeaders` does) so the seek
  past the old header is exercised on a multi-chunk file.
- `leavesOnlyTheTaggedFileBehindOnSuccess` — after a successful `write`, the directory lists
  exactly `["track.mp3"]`.
- `missingFileThrowsTaggingFailed` — `write` to `dir/does-not-exist.mp3` (using the `dir` from
  `makeFile()`) throws `LocallyError.taggingFailed`, and the directory still lists exactly
  `["track.mp3"]` afterwards (no temp file was created for the missing source).

### `apps/ios/LocallyTests/ID3MalformedInputTests.swift`

The existing `stripExistingID3Header` and `desynchsafe` tests stay exactly as they are; they now
exercise `existingID3HeaderLength` through the wrapper. The three existing `write` tests
(`...MalformedExistingHeader...`, `...TruncatedGarbageFile...`, `...EmptyFile...`) stay as they
are and must pass on the streaming path. Add:

- `existingID3HeaderLengthMatchesStripForEveryMalformedShape` — call
  `ID3TagWriter.existingID3HeaderLength(prefix:fileLength:)` directly for: empty prefix (0),
  4-byte prefix (0), no magic (0), `[0x7F,0x7F,0x7F,0x7F]` size in a 20-byte file (0), size 5 in
  a 15-byte file (15).
- `writingOverAFileThatIsOnlyAnID3HeaderYieldsANewHeaderAndNoAudio` — file = 10-byte header
  declaring size 5 + 5 frame bytes (the `headerConsumingTheEntireFileLeavesEmptyAudio` shape);
  after `write`, the result's declared size `S` satisfies `result.count == 10 + S` (no audio
  tail) and the result does not end with the original 5 frame bytes.

Both new tests use `makeFile(bytes:)` as the suite does today, with the existing
`defer { try? FileManager.default.removeItem(at: url) }`.

## Check command

From `apps/ios/AGENTS.md` (run from `apps/ios`; this environment may not have Xcode — run it
where it does before pushing):

```sh
cd apps/ios
xcodegen generate
xcodebuild -project Locally.xcodeproj -target Locally -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO
xcodebuild test -scheme Locally -destination 'platform=iOS Simulator,name=<device>'
```

The build is required before pushing; the test run is required when a simulator is available.
Both `ID3TagWriterTests` and `ID3MalformedInputTests` must be green, and every other suite must
stay green (no other production code changes).

## Acceptance criteria

1. `ID3TagWriter().write` with a tag body of `>= 2^28` bytes throws `LocallyError.taggingFailed`
   and the target file is byte-for-byte unchanged; no temp file exists afterwards.
2. `ID3TagWriter().write` never holds the full input and the full output in memory together:
   the source is read through a `FileHandle` in 1 MiB chunks, and no `Data(contentsOf:)` of the
   audio file remains in the writer.
3. Output bytes are identical to today's for every existing test: same header, same frames,
   same audio suffix, one `ID3` marker after repeated writes.
4. Any failure after the temp file is created (read, write, or `replaceItemAt`) throws
   `taggingFailed`, deletes the temp file, and leaves the original intact.
5. `stripExistingID3Header(from:)` keeps its signature and its behaviour on every malformed
   input listed in `ID3MalformedInputTests`.

## Non-goals

- `M4ATagWriter` (its `replaceItemAt` result check and temp-file cleanup are slice A of #12).
- The share extension (`LocallyShare`), `InboxStore`, `SyncEngine`, `ReleaseCoordinator`.
- Anything under `apps/web` or `apps/api`, `spec/*`, `STATUS.md` (nothing there describes the
  writer's memory profile; the planning session was told not to edit it and the implementer
  need not either).
- Handling the ID3v2.4 footer flag, ID3v2.2 headers, or unsynchronised frames; the writer
  strips exactly what it strips today.
- Reducing peak memory below `frames + one chunk` (the cover has to be in memory to be
  written; a cover under 2^28 bytes is bounded by the guard).
- A new `Copy.swift` string, a new `LocallyError` case, or any UI change.
