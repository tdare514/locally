# Sync: cover replaced on one device doesn't update on the other (#26)

## Summary

A cover replace on one client never reaches the other. The sync record names the cover
`cover.<ext>` and nothing else in the record changes when the bytes change, so the receiving
side has no signal to act on, and the pushing side (web) may not even re-upload the new bytes
because `uploadedFiles` still lists the old name. Fix: add `coverHash` (sha256 of the cover
bytes, hex, or `null`) to the sync record, bump `syncVersion` to `2`, and use the hash on both
push (force re-upload when it changed) and pull (re-download and re-tag when the remote hash
differs from the local one).

## Root cause

- `toSyncRecord` (both `apps/web/src/server/sync/SyncRecord.ts` and the iOS equivalent) emits
  `cover: "cover.jpg"` unconditionally; a replaced cover keeps the same name, so a diff of two
  records for the same release looks identical even when the bytes changed.
- On pull, both receiving paths deliberately leave the cover alone and only re-tag text fields,
  re-embedding whatever cover is already local:
  - `ReleaseCoordinator.applyRemoteUpdate` (`apps/ios/Locally/Coordinator/ReleaseCoordinator.swift`,
    around line 343-397): `coverForWrite` is loaded from the existing local `coverStore`, never
    from the remote record.
  - `ReleaseService.applyRemote` (`apps/web/src/server/releases/ReleaseService.ts`, line 462-511):
    `coverPath: existing.coverPath` is reused unchanged; the record's `cover` field (a name, not
    bytes) is never consulted.
- On push, the web side additionally never re-uploads: `SyncEngine.pushOne`
  (`apps/web/src/server/sync/SyncEngine.ts`, line ~139-152) skips any file name already present
  in `state.uploadedFiles[release.id]` (`FileSyncStateStore`/`SyncState.ts`). A replace keeps the
  name `cover.jpg`, so `already.has(record.cover)` is `true` forever after the first push, and
  the new bytes are never sent even though the local file changed.
- iOS pushes the cover by resolving `coverStore.fileURL` fresh every time
  (`apps/ios/Locally/Services/SyncEngine.swift` line ~201, `uploadFiles` line ~217-238), so the
  bytes it *sends* are always current; iOS's bug is entirely on the *receiving* side.

## Contract change (spec/sync.md)

Bump the record's `syncVersion` from `1` to `2` and add one field:

```json
{
  "syncVersion": 2,
  ...
  "cover": "cover.jpg",
  "coverHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  ...
}
```

- `coverHash`: lowercase hex sha256 of the cover file's bytes, or `null` if the release has no
  cover. Required key (like `year`/`genre`/`cover`), nullable, never omitted.
- The issue text says "spec/sync.md v3"; that is a slip. The spec's current `syncVersion` is `1`,
  so this change is the *second* version, `2`. Use `2` everywhere below.
- File name stays `cover.<ext>`; nothing else about naming, upload, or download changes.

Update `spec/sync.md`:
- The record's example JSON (currently lines 30-52 or thereabouts): change `"syncVersion": 1` to
  `"syncVersion": 2` and add `"coverHash"` after `"cover"`.
- Add one sentence near the field list or push/pull rules (currently lines ~90-108): "`coverHash`
  is the sha256 of the cover's bytes, or `null` with no cover; a receiver downloads and re-embeds
  the cover only when the remote `coverHash` differs from what it already has locally. A record
  from a client that predates `coverHash` (`syncVersion` 1) carries no signal that the cover
  changed and is handled exactly as before: the cover is left alone."

## Compatibility and migration

- **Old sender, new receiver**: a `syncVersion: 1` record has no `coverHash` key. Every receiver
  in this change must treat a record with no `coverHash` field (undefined, not present) as "no
  signal", i.e. leave the local cover untouched, same as today. This is the existing behaviour,
  so no special-casing is needed beyond making `coverHash` optional-tolerant on parse (see schema
  note below) and never treating "missing" the same as "hash differs".
- **New sender, old receiver**: a `syncVersion: 2` record must not be rejected by a client or API
  build that hasn't shipped this change yet. Today's zod schemas use `z.literal(1)` for
  `syncVersion`:
  - `apps/web/src/server/sync/SyncRecord.ts:47` (client-side schema used to validate records
    pulled from the API)
  - `apps/api/src/shared/types.ts:49` (server-side schema used to validate `PUT` bodies)
  A literal-1 schema throws on `syncVersion: 2`, so **both must be loosened before any client
  starts sending `2`**, otherwise an old API build 400s every push from an updated client, and an
  old web build throws parsing every pull from an updated iOS client (or vice versa). Loosen to
  `z.union([z.literal(1), z.literal(2)])` on both schemas (not `z.number().int().min(1).max(2)`:
  a bare range would silently accept `0` or accept future values without an explicit decision
  each time a version is added, and the union documents exactly which versions are understood).
  Same reasoning applies to iOS's `SyncRecord.syncVersion: Int` (`apps/ios/Locally/Domain/SyncRecord.swift`
  line ~117): it is already an unconstrained `Int` with no version check on decode, so iOS accepts
  `2` today with no change needed there; only the two zod schemas are a compatibility risk.
  `coverHash` itself must be optional-on-decode everywhere (zod `.optional().nullable()` or
  equivalent, Swift `String?` with `decodeIfPresent`) so a `syncVersion: 1` record (no key at all)
  still parses.
- **Sequencing**: because a receiver on an old build cannot understand `coverHash` but also must
  not choke on `syncVersion: 2`, the schema loosening has to land and be running everywhere
  (web, api) before any client is allowed to actually populate `coverHash` and send `2`. See
  Rollout order.
- No server-side data migration: `apps/api` stores whatever JSON blob it's given (see Affected
  components / apps/api below) and does not need a backfill of `coverHash` for existing rows; old
  rows simply have no `coverHash` until next pushed.

## Affected components

### apps/api

- `apps/api/src/shared/types.ts:49`: change `syncVersion: z.literal(1)` to
  `syncVersion: z.union([z.literal(1), z.literal(2)])`. Add `coverHash: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional()` to `releaseRecordSchema` (optional so a `syncVersion: 1` body with no key still validates; nullable so `syncVersion: 2` with no cover validates).
- No other apps/api change is required. `grep -rn "syncVersion" apps/api/src` shows exactly one
  reference, the schema literal; the API stores and returns the record as an opaque JSON blob
  (`ReleaseSyncService`, `apps/api/src/server/releases/ReleaseSyncService.ts`) and does not branch
  on `coverHash` or `syncVersion` itself, so once the schema accepts both, old clients sending `1`
  and new clients sending `2` are both stored and served unchanged. Confirm this with a read of
  `ReleaseSyncService` before implementing, in case a later change added version-specific logic.
- No new upload/download route needed: cover bytes already move through
  `apps/api/src/app/v1/releases/[id]/files/route.ts` (upload URL) and
  `apps/api/src/app/v1/releases/[id]/files/[name]/route.ts` (signed download), keyed by file
  name, not by hash. `coverHash` is metadata carried in the record only.

### apps/web

- `apps/web/src/server/sync/SyncRecord.ts`:
  - `SyncRecordSchema` (line 47): same `syncVersion` union change as the API, plus add
    `coverHash: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional()`.
  - `toSyncRecord` (line ~78-108): add a `coverHash` parameter (sha256 hex or `null`), computed
    by the caller from the on-disk cover bytes, since `toSyncRecord` is documented as pure and
    never touches disk (`trackBytesById` is passed in for the same reason). New signature:
    `toSyncRecord(release, origin, originDevice, trackBytesById, coverHash)`. Set
    `syncVersion: 2` in the returned object and include `coverHash` in the output.
  - `fromSyncRecord` / `SyncRecordMeta`: add `coverHash: string | null` to `SyncRecordMeta` and
    copy it through, so `ReleaseService.applyRemote`/`importSynced` can read it without touching
    the wire type directly.
  - Compute the local cover's hash on demand from the bytes on disk at push time. The cover file
    is already read/stat'd on every push
    (`SyncEngine.pushOne` calls `this.fs.statSize(release.coverPath)`), so hashing it in the same
    pass costs one more read of a small image file, no new state to keep in sync with reality, and
    no risk of a stale stored hash after an out-of-band file edit. Add a `sha256File(path): Promise<string>`
    helper (or reuse the `fs` abstraction already injected into `SyncEngine`/`ReleaseService`) built
    on Node's `crypto.createHash("sha256")` (already used in `apps/api/src/server/auth/AuthService.ts`
    and `apps/api/src/server/files/LocalFileStore.ts`, so the pattern is established in this
    codebase, just not yet in `apps/web/src/server/sync` or `apps/web/src/server/releases`).
- `apps/web/src/server/sync/SyncEngine.ts`:
  - `pushOne` (line ~139-152): after computing `record` (now including `coverHash`), when
    `record.cover` is non-null, compare the record's `coverHash` against the hash of the cover
    last uploaded. `uploadedFiles` is keyed by name, so it cannot tell a replace from a no-op;
    add `coverHash: Record<string, string>` (releaseId to last-uploaded cover hash) to `SyncState`
    (`apps/web/src/server/sync/SyncState.ts`), defaulted to `{}` in `emptySyncState()`. In
    `pushOne`, before building `toUpload`, if `record.cover` exists and
    `state.coverHash[release.id] !== record.coverHash`, remove `record.cover` from the
    `already` set (i.e. treat it as not-yet-uploaded) so it lands in `toUpload` regardless of
    `uploadedFiles`. After a successful upload, set `state.coverHash[release.id] = record.coverHash`
    (or delete the key when `record.coverHash` is `null`) in the same `afterUpload` write that
    already updates `uploadedFiles` (line ~192-195).
  - `pullOnce` (line ~211-260) and `applyIncoming`/import path (line ~300-347): no push-side
    change needed here; the pull path change is in `ReleaseService.applyRemote` (see below), since
    that is where cover bytes actually get written. `pullOnce` keeps passing the full `record`
    to `applyRemote`; the implementer locates that call site in `SyncEngine.ts` (near the
    `applyRemote`/`importSynced` calls) and adds the cover download described below in front of it.
- `apps/web/src/server/releases/ReleaseService.ts`:
  - `replaceCover` (line ~240-286): this is the push-trigger path, not the receive path; no
    `coverHash` field needs to be written here directly since the hash is computed at push time
    from disk (see above), but confirm `syncHooks.onCoverReplaced(updated)` still fires (line
    ~283) so `SyncEngine.push` runs and recomputes the hash.
  - `applyRemote` (line ~462-511): this is the fix's core. Currently line ~495 hardcodes
    `coverPath: existing.coverPath`. `applyRemote` takes only `record: SyncRecord` today and has
    no way to reach new cover bytes, so `SyncEngine` downloads the cover first, mirroring
    `acceptPending` (`apps/web/src/server/sync/SyncEngine.ts` line ~320-337, which downloads
    `record.tracks[].file` and `record.cover` into a temp `dir` before `importSynced`).
    Concretely:
    1. In `SyncEngine`, before calling `applyRemote` for a record whose `coverHash` differs from
       the local release's current cover hash (compute the local hash on demand from
       `existing.coverPath`, same `sha256File` helper), download `record.cover` into a temp dir
       via `api.downloadUrl`/`api.downloadFile` (same 404-tolerant retry as `acceptPending`: leave
       the release pending and retry next reconcile if the file 404s, per spec/sync.md's
       "visible before uploaded" rule).
    2. Pass the downloaded cover's local path (or `null` if `record.cover` is `null` or the hash
       matches) into `ReleaseService.applyRemote(record, { newCoverPath })` (extend the method
       signature with an optional second argument).
    3. Inside `applyRemote`, when `newCoverPath` is provided: move it into place with
       `this.layout.coverFileName` + `assertInsideLibrary` (same pattern as `replaceCover`,
       line ~249-260, including removing the old cover file if the extension differs), use it as
       `coverPath` for the updated release and as `coverPath` in every `tags.write` call in the
       loop (replacing the current `existing.coverPath` at line ~495), matching `replaceCover`'s
       re-embed-into-every-track behaviour.
    4. When `record.coverHash` is `null` and the local release currently has a cover: leave the
       local cover alone (do not delete it). Out of scope for this change; see Out of scope.
- The only stored hash on web is `SyncState.coverHash`, the hash of the bytes last uploaded per
  release; it exists purely so push can detect a replace. Everything else (the local file's
  current hash on push and on pull) is computed on demand from disk, because the cover is small,
  is already read for tag embedding, and a stored copy could drift from the real file if the
  library folder is edited by hand.

### apps/ios

- `apps/ios/Locally/Domain/SyncRecord.swift`:
  - Add `var coverHash: String?` to the `SyncRecord` struct (near `cover`, line ~121), to the
    memberwise `init` (line ~130-149) with default `nil`, to `CodingKeys` (line ~152-153), and to
    both `encode(to:)` (line ~163-178) and any custom `decode` (re-check for a custom
    `init(from:)`; if none exists, confirm the synthesized `Decodable` conformance is what's used,
    since `encode` is hand-written but decode may not be). `coverHash` should encode with
    `encodeIfPresent`-like nullable semantics matching the server's `.nullable()`: since the
    server schema will make it `.nullable().optional()`, iOS can safely omit the key when `nil`
    on encode (optional) but must handle an explicit JSON `null` OR a missing key on decode the
    same way (both become Swift `nil`).
  - Bump the default `syncVersion` iOS sends: `init(syncVersion: Int = 1, ...)` (line ~130) to
    `syncVersion: Int = 2`. Every call site that constructs a `SyncRecord` to push should now
    naturally send `2` via the default; grep call sites before changing the default to confirm
    none hardcode `1` explicitly (`apps/ios/Locally/Services/SyncEngine.swift` line ~201-202 is
    the main construction site, per the earlier grep, and doesn't pass `syncVersion` explicitly).
- `apps/ios/Locally/Services/SyncEngine.swift` (push path, per the file's own `cover|upload`
  grep results, lines ~197-238):
  - At line ~201-202 where `record.cover` is set from `coverStore.fileURL`, also compute
    `record.coverHash` by hashing the resolved `coverURL`'s bytes with `CryptoKit.SHA256` (not
    currently used anywhere in the repo per the hashing grep; this introduces the first
    `CryptoKit` import in `apps/ios/Locally`). When `coverURL` is `nil`, set `coverHash = nil`.
  - iOS's upload path already re-resolves `coverStore.fileURL` fresh on every push and does not
    consult any "already uploaded" cache the way web's `uploadedFiles` does (confirm by re-reading
    `uploadFiles`, line ~217-238: it builds `requests` from `record`/`files`/`coverURL` directly,
    not filtered by a prior-upload set), so no analogous "drop cover from uploaded set" fix is
    needed on iOS's push side; the bug there is receive-only.
- `apps/ios/Locally/Coordinator/ReleaseCoordinator.swift`:
  - `applyRemoteUpdate` (line ~343-397): currently line ~353 always reloads
    `coverForWrite` from the existing local `coverStore`. Change: before that, compare
    `record.coverHash` (new field) against a hash of the existing local cover (compute on demand:
    `coverStore.load(releaseId)` bytes, `CryptoKit.SHA256` hash, hex-encode; `nil` if
    `coverStore.load` returns `nil`).
    - If `record.coverHash == nil`: leave `coverForWrite` as the existing local load (today's
      behaviour, both for `syncVersion: 1` records and for a `syncVersion: 2` record that
      legitimately has no cover). Same "leave local cover alone" decision as web; out of scope to
      delete the local cover when remote has none.
    - If `record.coverHash` is non-nil and equals the local hash: no cover bytes changed; keep
      using the existing local load (avoids a redundant download).
    - If `record.coverHash` is non-nil and differs (or local has no cover yet): download the
      cover from the sync API first. `SyncEngine.swift` already has a
      `downloadFile(releaseId:name:into:)` step (around line 404) that fetches `record.cover` for
      `importSynced`; the reconcile branch that calls `applyRemoteUpdate` reuses it and passes the
      bytes through a new optional `newCoverData: Data?` parameter. A 404 (upload not finished)
      leaves the release pending for the next reconcile, as for tracks. Then
      `coverStore.save(newCoverData, for: releaseId)` and use those bytes as `coverForWrite` for
      every track in the re-tag loop (line ~381), matching the existing "update() cover replace"
      pattern used elsewhere in this same file (line ~227-234).
  - `applyRemoteUpdate` doc comment (line ~336-341) currently states the method deliberately never
    touches the cover; update that comment to describe the new conditional behaviour instead of
    leaving stale documentation.
- No new persisted field on `Release`/Core Data-equivalent model: compute the local cover's hash
  on demand from `coverStore.load(id)` at reconcile time, for the same reasons as web (small file,
  already read for re-embedding, avoids drift from a stored-but-stale hash).

## Security

- Hashing is over local bytes already resident on disk (web: the release's `coverPath` file;
  iOS: `coverStore.load`/`fileURL` bytes); no new user-derived path is introduced, and no new
  path component is built from network input beyond what already exists (`record.cover` is
  already a `plainName`/`assertPlainFileName`-checked value on both sides).
  - Cover download continues to go through the existing signed URL
    (`apps/api/src/app/v1/releases/[id]/files/[name]/route.ts`) and the existing
    `ReleaseLayout`/`assertInsideLibrary` (web) or `coverStore.save` (iOS) inside-checks before
    any bytes are written to a real path; this plan adds no new write path, only a new comparison
    (hash) that gates whether the existing download/re-tag code runs.
  - `coverHash` itself is validated server-side and client-side as a fixed-shape 64-char lowercase
    hex string (`/^[0-9a-f]{64}$/`), so it cannot be used to smuggle a path or command.
  - Cover file size is bounded exactly as today (the existing upload/import size limits in
    `ReleaseService`/`ReleaseCoordinator` are unchanged by this plan); hashing does not require
    loading the whole file differently than it's already loaded for tag-embedding, so no new
    memory/size exposure.
- No secrets are added to the record; `coverHash` is a content hash, not sensitive.

## Tests (per app)

### apps/web

- `apps/web/tests/unit/SyncEngine.test.ts` (existing file, extends the `describe("SyncEngine", ...)`
  block, alongside the existing `it("re-tags a local release in place when the remote copy is
  newer...")` and `it("push uploads missing files then puts the record")` cases):
  - New: "push re-uploads the cover after a replace even though its name didn't change": seed a
    release already in `uploadedFiles`/`pushedUpdatedAt` with `cover.jpg`, change the on-disk
    cover bytes, call `push`, assert the fake API's `createUploads`/`uploadFile` was called for
    `cover.jpg` again and `state.coverHash[release.id]` was updated to the new hash.
  - New: "pull downloads and re-embeds a replaced cover when the remote coverHash differs": seed
    a local release with a cover, seed a remote record with a different `coverHash` and `cover`
    name, run `reconcile`/pull, assert the fake tag writer was called with the newly downloaded
    cover bytes for every track and the release's `coverPath`/thumbnail reflect the new file.
  - New: "pull does nothing to the cover when the remote coverHash matches the local one": same
    setup but with matching hashes; assert no download call was made (fake API call count).
  - New: "pull leaves the cover alone for a syncVersion 1 record with no coverHash": construct a
    raw record JSON without a `coverHash` key (simulating an old sender), assert cover-related
    fields/calls are untouched, matching today's behaviour.
- `apps/web/tests/unit/ReleaseService.test.ts` (existing file): extend `applyRemote` coverage with
  the "cover bytes actually change on disk and get re-embedded" case if `applyRemote`'s signature
  changes as described (pass a `newCoverPath` and assert `tags.write` received it for every
  track); keep the existing "text-only edit doesn't touch the cover" case passing unchanged
  (`newCoverPath: null`/omitted).
- New `apps/web/tests/unit/SyncRecord.test.ts` asserting: `toSyncRecord` includes `coverHash`; `SyncRecordSchema`
  accepts both `syncVersion: 1` (no `coverHash` key) and `syncVersion: 2` (with `coverHash`);
  rejects a malformed `coverHash` (wrong length/charset).

### apps/ios

- `apps/ios/LocallyTests/SyncEngineTests.swift` (existing file, extends `struct SyncEngineTests`,
  alongside the existing `it("re-tags a local release in place when the remote copy is newer...")`-
  equivalent `@Test func`): add `@Test func` cases mirroring the web ones:
  - "reconcile downloads and re-embeds a replaced cover when the remote coverHash differs":
    seed `FakeCoverStore`/`InMemoryLibraryStore` with a release and cover, seed `FakeSyncApi`
    with a remote record carrying a different `coverHash`, run `engine.reconcile()`, assert
    `FakeTagWriter` received the new cover bytes for every track and `FakeCoverStore` holds the
    new bytes for that id.
  - "reconcile leaves the cover alone when the remote coverHash matches the local one": assert no
    extra download call on the `FakeSyncApi`.
  - "reconcile leaves the cover alone for a record with no coverHash (syncVersion 1)": construct a
    `SyncRecord` with `coverHash: nil` explicitly, assert unchanged behaviour.
  - "push sends the cover's hash and it matches the pushed bytes": assert the record built inside
    `push`/`uploadFiles` carries a `coverHash` equal to a manually computed sha256 of the seeded
    cover bytes.
- `apps/ios/LocallyTests/ReleaseCoordinatorSyncHookTests.swift` and/or a coordinator-focused test
  covering `applyRemoteUpdate` directly (grep for the existing test file that exercises
  `applyRemoteUpdate` beyond the sync-hook file, since `ReleaseCoordinatorSyncHookTests.swift`'s
  existing `@Test func`s are about push-triggering hooks, not receive; re-check
  `ReleaseCoordinatorUpdateTests.swift`/`ReleaseCoordinatorTests.swift` for the right home before
  adding): add a case asserting `applyRemoteUpdate` re-tags every track with newly supplied cover
  data when given a non-nil `newCoverData`/equivalent parameter, and leaves tags' cover untouched
  when it is `nil`.
- `apps/ios/LocallyTests/SyncRecordTests.swift` (existing file): add cases for encode/decode of
  `coverHash` (present, `null`, and absent-from-JSON decoding to `nil`), and for the
  `syncVersion` default now being `2`.

### apps/api

- Tests live in `apps/api/tests/unit/` (vitest). Add `apps/api/tests/unit/types.test.ts`, or
  extend `ReleaseSyncService.test.ts`, to assert `releaseRecordSchema` accepts a `syncVersion: 1` body without `coverHash`, accepts a
  `syncVersion: 2` body with a valid `coverHash`, and rejects a malformed `coverHash`.

## Out of scope

- Deleting or clearing a local cover when the remote record's `coverHash` is `null` but the local
  release has one (e.g. a cover was removed entirely on one device with no replacement). Both
  receive paths (`ReleaseService.applyRemote`, `ReleaseCoordinator.applyRemoteUpdate`) leave the
  local cover alone in this case; there is currently no "remove cover" action in either app's UI,
  so this has no observable trigger today, but it should be called out explicitly if that action
  is ever added.
- Any change to `spec/metadata.md`'s cover description (line 17, line 44); those describe the
  on-disk/tag representation, which is unaffected by adding a sync-only hash field.
- Any change to how covers are named, stored, or embedded; `cover.<ext>` naming and the
  square/original crop dialog are untouched.
- Deduplicating identical cover bytes across releases, or any other storage optimisation using the
  hash; `coverHash` here is used purely as a change signal between two copies of the same release.
- The unrelated `#19` iOS crash in `SyncEngine.backfillUnpushed` and the HTTPS-only/token-reset
  items from `#11`/`#12`; this plan does not touch those paths.

## Rollout order

1. Ship the schema loosening alone, first, everywhere a `syncVersion` literal is checked, with no
   client yet sending `2` and no receiver yet acting on `coverHash`:
   - `apps/api/src/shared/types.ts:49` union literal change, deployed (or, until apps/api is
     deployed per `STATUS.md`/#3, landed and running in every local dev/test environment that
     exercises real pushes).
   - `apps/web/src/server/sync/SyncRecord.ts:47` union literal change.
   - iOS needs no schema change here (its `syncVersion` is an unconstrained `Int` already), but
     add the optional `coverHash` field to `SyncRecord.swift` in this same step so a build from
     this point on can decode a `coverHash` key without crashing, even before it acts on it.
   This step alone must be fully out (all three: api, web, ios builds people actually run) before
   step 2, so that no client ever receives a `syncVersion: 2` record it cannot parse.
2. Ship the behaviour: `toSyncRecord`/`SyncEngine` push changes on web and ios (compute and send
   `coverHash`, bump the sent `syncVersion` to `2`, fix the web `uploadedFiles` re-upload gap and
   the ios hash computation), together with the receive-side changes (`ReleaseService.applyRemote`,
   `ReleaseCoordinator.applyRemoteUpdate`) in the same change, since a sender-only or
   receiver-only partial rollout would either send hashes nobody acts on (harmless) or expect
   hashes that never arrive (harmless, falls back to "leave cover alone", same as `syncVersion: 1`
   today). Step 2 therefore has no strict ordering between web and ios, but both must land
   after step 1 is fully deployed.
3. Update `spec/sync.md` in the same change as step 2 (or immediately before it, since it is a
   documentation-only change with no runtime effect) to describe `syncVersion: 2` and `coverHash`
   as the current contract.
4. Update `STATUS.md` if this lands while `STATUS.md`'s "In progress"/"Known issues" sections
   still reference the Sep 27 security review work, since this plan's changes are unrelated to
   that review and should not be folded into its bullet.
