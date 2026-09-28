# Sync: web and iOS reject record file names with an unsupported extension (#39)

## Summary

The API only accepts a record whose `tracks[].file` and `cover` end in `mp3`, `m4a`, `jpg`,
`jpeg` or `png` (`fileNameSchema` / `SUPPORTED_FILE_EXT` in `apps/api/src/shared/types.ts`).
Neither client checks: web's `SyncRecordSchema` only requires a plain child name
(`isPlainSyncName`), and iOS decodes `SyncRecord` structurally and checks
`ReleaseLayout.isPlainFileName` in `SyncEngine` just before a download. The gap is documented
today by the `invalid-api-*` fixture prefix in `spec/sync.md`, which both client fixture tests
skip. This plan closes it: both clients apply the API's extension rule at the point where a
record is parsed, the one `invalid-api-*` fixture becomes a plain `invalid-*` fixture that all
three fixture tests assert, the prefix goes away, and a web `sync-state.json` that already holds
such a record loses that one entry instead of failing to load.

No API behaviour changes. The API allow-list is the contract; the clients catch up to it.

## Current behaviour

- API: `fileNameSchema` (`apps/api/src/shared/types.ts`, line 12) is
  `z.string().max(200)`, no `/` or `\`, and
  `new RegExp("\\.(mp3|m4a|jpg|jpeg|png)$", "i").test(name)`. It is applied to
  `trackRecordSchema.file`, `releaseRecordSchema.cover` (nullable) and upload request names.
- Web: `SyncRecordSchema` (`apps/web/src/server/sync/SyncRecord.ts`) uses `plainName(...)` for
  `id`, `tracks[].id`, `tracks[].file` and `cover`. `HttpSyncApi.listReleases`
  (`apps/web/src/server/sync/SyncApi.ts`, line 187) parses each pulled record with
  `SyncRecordSchema.parse`, so one bad record throws and `SyncEngine.pullOnce` records it in
  `lastError` without advancing the cursor. `FileSyncStateStore`
  (`apps/web/src/server/sync/FileSyncStateStore.ts`) validates `sync-state.json` with
  `pendingFromPhone: z.record(z.string(), SyncRecordSchema)`; a failed parse of the whole file
  returns `emptySyncState()`, which also throws away `pushedUpdatedAt`, `uploadedFiles` and
  `coverHash`.
- iOS: `SyncRecord` and `SyncTrack` (`apps/ios/Locally/Domain/SyncRecord.swift`) have a
  synthesized `init(from:)` and a hand-written `encode(to:)`. `HttpSyncApi.releases`
  (`apps/ios/Locally/Services/SyncApi.swift`, line 192) decodes `releases: [SyncRecord]`; a
  decoding failure anywhere in the page becomes `SyncApiError.network("Couldn't understand the
  server's response.")`, which `SyncEngine.runReconcile` puts in `status.lastError` without
  advancing `account.lastVersion`. `SyncEngine.downloadFile` (line 809) rejects a non-plain
  name with `LocallyError.importFailed`, which `acceptFromMac` turns into a
  `failedAcceptIds` entry (the release stays pending). Nothing on iOS persists a `SyncRecord`:
  `pendingFromMac` and `failedCoverUpdates` are in-memory `SyncStatus` fields and `SyncOutbox`
  stores release ids, not records.
- Fixtures: `spec/fixtures/sync/invalid-api-bad-extension.json` has one `.wav` track and a
  valid `cover.png`. The API fixture test rejects every `invalid-*` file (including it); the web
  and iOS tests filter `invalid-api-*` out of their reject list and only count it in the
  "prefixes are known" test.

## Contract (spec/sync.md)

This is not a change to the wire format or to what the API accepts; it documents the existing
API rule as a rule for every reader, and retires the `invalid-api-*` prefix.

- "Record" section, after the paragraph that introduces `tracks[].file`: add
  "`tracks[].file` and `cover` end in one of `mp3`, `m4a`, `jpg`, `jpeg`, `png`
  (case-insensitive: the name's last `.`-suffix, compared in lower case). The API refuses any
  other name with a 400, and both clients refuse such a record before using any file name in it."
- "Fixtures" section: delete the `invalid-api-*` bullet. Reword the `invalid-*` bullet to
  "`invalid-*`: every app rejects it (the API with a 400, clients before using any file name in
  it)." Nothing else in the section changes.

Effect on clients: none at runtime for records the API accepted (all of them carry an allowed
extension already). Both clients are updated in this change; an older client build keeps working
against the same API.

## The extension rule, spelled out once

Both clients implement exactly the API's regular expression
`/\.(mp3|m4a|jpg|jpeg|png)$/i`, i.e.:

- the name must contain a `.` followed by one of the five literal extensions and then end;
- matching is case-insensitive over ASCII letters (`.MP3`, `.Mp3`, `.JPEG`, `.Png` pass);
- nothing else is inspected: `a.b.mp3` passes (last suffix wins), `song.mp3.bak`, `song.mp`,
  `song.wav`, `song.flac`, `cover.gif`, `cover.webp`, `song.mp3 ` (trailing space), `mp3`
  (no dot) and `song` fail.

The check is applied only to `tracks[].file` and to `cover` when it is not `null`. Release and
track `id`s are UUIDs with no extension and keep the plain-name rule only. The plain-name rule
(`isPlainSyncName` / `isPlainFileName`) stays exactly as it is; the extension check is added
next to it, never instead of it. The API's 200-character cap is not adopted (clients keep 255);
see "Not in this plan".

### Web spelling (`apps/web/src/server/sync/SyncRecord.ts`)

```ts
/** The extensions the API accepts for `tracks[].file` and `cover` (`SUPPORTED_FILE_EXT` in apps/api). */
export const SYNC_FILE_EXTENSIONS = ["mp3", "m4a", "jpg", "jpeg", "png"] as const;

const SYNC_FILE_EXTENSION_RE = /\.(mp3|m4a|jpg|jpeg|png)$/i;

/** True when `name` ends in one of `SYNC_FILE_EXTENSIONS`, compared case-insensitively, as the API checks it. */
export function hasSyncFileExtension(name: string): boolean {
  return SYNC_FILE_EXTENSION_RE.test(name);
}

const syncFileName = (what: string) =>
  plainName(what).refine(hasSyncFileExtension, `${what} must end in one of: ${SYNC_FILE_EXTENSIONS.join(", ")}`);
```

`SyncTrackSchema.file` becomes `syncFileName("track file")` and `SyncRecordSchema.cover`
becomes `syncFileName("cover").nullable()`. `id` and `tracks[].id` stay `plainName(...)`.

### iOS spelling (`apps/ios/Locally/Domain/SyncRecord.swift`)

```swift
/// The extensions the API accepts for `tracks[].file` and `cover`
/// (`SUPPORTED_FILE_EXT` in apps/api). Mirrors the Mac app's `SYNC_FILE_EXTENSIONS`.
enum SyncFileName {
    static let supportedExtensions = ["mp3", "m4a", "jpg", "jpeg", "png"]

    /// True when `name` ends in `.` + one of `supportedExtensions`, compared
    /// in lower case, exactly as the API's `/\.(mp3|m4a|jpg|jpeg|png)$/i` does.
    static func hasSupportedExtension(_ name: String) -> Bool {
        let lower = name.lowercased()
        return supportedExtensions.contains { lower.hasSuffix("." + $0) }
    }
}
```

A suffix test, not `NSString.pathExtension`, so that its edge cases (a bare `.mp3`, trailing
spaces) agree with the regular expression above.

## Affected components

### spec

- `spec/sync.md`: the two edits under "Contract".
- `spec/fixtures/sync/invalid-api-bad-extension.json` → `git mv` to
  `spec/fixtures/sync/invalid-bad-extension.json`. Content unchanged (one `.wav` track).
- New `spec/fixtures/sync/invalid-cover-bad-extension.json`: a copy of
  `valid-album-with-cover.json` with `"cover": "cover.gif"` and every track name unchanged, so
  the cover path of the rule is asserted by all three apps too, not only by per-app unit tests.
  After this, no `invalid-api-*` fixture remains, so the prefix is dropped everywhere below.

### apps/api (tests only, no source change)

- `apps/api/tests/unit/syncFixtures.test.ts`: in the first test, drop the `invalidApi` split;
  `invalid` is every file starting with `invalid-`, and the assertion is
  `expect(invalid.length).toBeGreaterThan(0)`. The accept/reject `it.each` blocks already use
  the plain `valid-`/`invalid-` prefixes and stay as they are. `npm run check` must still pass:
  the renamed and the new fixture are both rejected by `releaseRecordSchema` today.

### apps/web

- `src/server/sync/SyncRecord.ts`: add `SYNC_FILE_EXTENSIONS`, `hasSyncFileExtension`,
  `syncFileName`, and use it for `tracks[].file` and `cover` as spelled above. Update the
  doc comment above `SyncRecordSchema` to say file names are plain names with an allowed
  extension.
- `src/server/sync/FileSyncStateStore.ts`: parse `pendingFromPhone` entry by entry so a bad
  record is dropped, not the file. Replace the field in `SyncStateFileSchema` with
  `z.record(z.string(), z.unknown()).default({})` transformed through
  `SyncRecordSchema.safeParse`, keeping only entries that parse:

  ```ts
  pendingFromPhone: z
    .record(z.string(), z.unknown())
    .default({})
    .transform((entries) =>
      Object.fromEntries(
        Object.entries(entries).flatMap(([id, raw]) => {
          const parsed = SyncRecordSchema.safeParse(raw);
          return parsed.success ? [[id, parsed.data]] : [];
        })
      )
    ),
  ```

  `get()` is unchanged otherwise: a file that fails the outer schema (or is not JSON) still
  returns `emptySyncState()`. The dropped entry disappears from disk on the next `set()`;
  `get()` stays read-only. `pushedUpdatedAt`, `uploadedFiles` and `coverHash` for that release
  id are left alone (they are independent maps keyed by id). The type of `parsed.data` must
  still satisfy `SyncState` (`Record<string, SyncRecord>`); add an explicit
  `satisfies`/return-type annotation if `tsc` cannot infer it through `fromEntries`.
- `src/server/sync/SyncApi.ts`: no change. `listReleases` keeps its strict
  `SyncRecordSchema.parse`; a record with a bad extension now fails the page and lands in
  `lastError` exactly as a record with a bad plain name does today, and the cursor does not
  advance, so the release is retried on the next reconcile. This is the existing web behaviour
  for a rejected record and the issue does not ask to change it (see "Not in this plan").
- `src/server/sync/SyncEngine.ts`: no change. It never parses records itself.
- `AGENTS.md` (apps/web): in the architecture map line for `SyncRecord.ts`, extend
  "`isPlainSyncName` guard" to "`isPlainSyncName` + `hasSyncFileExtension` guards".

### apps/ios

All in `Locally/Domain/SyncRecord.swift` and `Locally/Services/SyncApi.swift`.
`Locally/Services/SyncEngine.swift` is not touched (issue #38 owns it); `ReleaseCoordinator`
is not touched either.

- `SyncRecord.swift`:
  - Add `SyncFileName` as spelled above.
  - Add a dedicated error so callers can tell "decoded, but refused" from "not a record":

    ```swift
    /// Thrown by `SyncRecord.init(from:)` for a record that has the right shape
    /// but names a file this app will not use (see `SyncFileName`). Distinct from
    /// `DecodingError` so a page decoder can skip the one record and keep the rest.
    struct SyncRecordRejected: Error, Equatable {
        /// `"cover"` or `"tracks[<index>].file"`.
        let field: String
        let name: String
    }
    ```

  - Give `SyncRecord` an explicit `init(from decoder: Decoder) throws` that decodes every key
    exactly as the synthesized one did (`year`, `genre`, `cover`, `coverHash`, `version` with
    `decodeIfPresent`; `durationSec` inside `SyncTrack` is unchanged, `SyncTrack` keeps its
    synthesized `init(from:)`), then validates:

    ```swift
    for (index, track) in tracks.enumerated()
    where !SyncFileName.hasSupportedExtension(track.file) {
        throw SyncRecordRejected(field: "tracks[\(index)].file", name: track.file)
    }
    if let cover, !SyncFileName.hasSupportedExtension(cover) {
        throw SyncRecordRejected(field: "cover", name: cover)
    }
    ```

    The memberwise `init(...)` is untouched: a record built in code (tests, `toSyncRecord`) is
    not validated, only a decoded one. `Codable`, `Hashable` and `encode(to:)` are unchanged.
  - Add the page-element wrapper next to it:

    ```swift
    /// One element of a decoded `GET /v1/releases` page. `record` is `nil` when
    /// `SyncRecord.init(from:)` threw `SyncRecordRejected`, so a single refused
    /// record skips that release instead of failing the whole page; any other
    /// decoding error still propagates and fails the page as before.
    struct SyncRecordPageElement: Decodable {
        let record: SyncRecord?

        init(from decoder: Decoder) throws {
            do {
                record = try SyncRecord(from: decoder)
            } catch is SyncRecordRejected {
                record = nil
            }
        }
    }
    ```

- `SyncApi.swift`, `HttpSyncApi.releases(sinceVersion:limit:)`: the local `Response` decodes
  `releases: [SyncRecordPageElement]` and returns
  `releases: decoded.releases.compactMap(\.record)`. `SyncReleasesPage`, the `SyncApi`
  protocol and `FakeSyncApi` are unchanged (they carry `[SyncRecord]`).
- Behaviour that follows, without a `SyncEngine` edit: a rejected record is skipped for that
  page; `fetchRemoteChanges` still applies every other record and advances
  `account.lastVersion` past it. The release is neither shown in "From your Mac" nor applied,
  and it never sets `lastError` or throws. If the record is later corrected on the server it
  gets a new `version` above the cursor and arrives normally. This satisfies "pending/skipped,
  never fails the whole reconcile"; it is "skipped" rather than "pending" because the record
  never reaches the engine.
- `AGENTS.md` (apps/ios): extend the "Sync record file names and ids are plain child names"
  rule with one sentence: "`tracks[].file` and `cover` must also carry one of the API's
  extensions (`SyncFileName`); `SyncRecord.init(from:)` refuses the record and
  `HttpSyncApi.releases` skips it."
- `xcodegen generate` is not required (no files added or removed); run it anyway before
  `xcodebuild` per the app's AGENTS.md.

## Compatibility and migration

- No `syncVersion` bump, no API change, no schema or storage migration.
- Web `sync-state.json`: a `pendingFromPhone` entry that fails the new schema is dropped on the
  next `get()`; everything else in the file survives. Before this change such an entry (or one
  with a bad plain name) made the whole file unreadable and reset all sync bookkeeping, so this
  is strictly more forgiving. The phone's copy of that release is unaffected; if the record is
  re-pushed with valid names it is offered again.
- iOS keeps no persisted records, so nothing to migrate.
- Own records: web writes `NN - Title.mp3` and `cover.jpg`/`cover.png`
  (`ReleaseLayout.trackFileName`/`coverFileName`); iOS writes `.mp3`/`.m4a` tracks and derives
  the cover name from `CoverStore`'s `jpg`/`png` file. Every record either client produces
  already passes the rule, so nothing a device has pushed becomes unreadable to the other.
- Deploy order: none. Either client can ship first.

## Security implications

- Defence in depth for the invariant "never write outside the library or Spotify folder": a
  name that reaches a download is now guaranteed to be both a plain child name and an
  audio/image extension, on both clients, even if the API's check regressed or a stale local
  state file was edited. It also removes the path by which a stale or hand-edited
  `sync-state.json` could make web accept a name the API would never have issued.
- The extension check is a pure string test on a value the plain-name rule has already
  bounded (no separators, no control characters, at most 255 bytes); no new parsing surface.
- Skipping a rejected record on iOS cannot be used to hide a tombstone: a tombstone's
  `tracks[].file` names still have to pass, and a record the API accepted always does. A
  hostile or broken server that sends a rejected record only loses that record, which is what it
  would lose anyway.

## Tests

### spec fixtures (all three apps)

- `invalid-bad-extension.json` (renamed) and `invalid-cover-bad-extension.json` (new) are
  rejected by `releaseRecordSchema` (api), `SyncRecordSchema` (web) and
  `SyncFixtureTests.clientAccepts` (iOS). All `valid-*` fixtures still parse everywhere.

### apps/api (`npm run check`)

- `tests/unit/syncFixtures.test.ts`: the prefix test no longer mentions `invalid-api-`. No other
  change.

### apps/web (`npm run check`)

- `tests/unit/SyncRecord.test.ts`, new `describe("SyncRecordSchema refuses file names with an
  unsupported extension")`:
  - as a track `file` and as `cover`, each of `01 - Intro.wav`, `01 - Intro.flac`,
    `01 - Intro`, `01 - Intro.mp3.bak`, `01 - Intro.mp`, `cover.gif`, `cover.webp`,
    `cover.jpg ` (trailing space), `mp3` is rejected (`parseSyncRecord` throws);
  - accepted: `01 - Intro.MP3`, `01 - Intro.Mp3`, `01 - Intro.m4a`, `01 - Intro.M4A`,
    `a.b.mp3` as `file`; `cover.jpg`, `cover.JPG`, `cover.jpeg`, `cover.JPEG`, `cover.png`,
    `cover.PNG` and `null` as `cover`;
  - `id` and `tracks[].id` with no extension (a UUID) still accepted (the existing
    `validRecord()` covers it; add one explicit assertion);
  - `hasSyncFileExtension` table: the same names, plus the five extensions in lower and upper
    case.
- `tests/unit/syncFixtures.test.ts`: reject list is every `invalid-*` file; prefix test drops
  `invalid-api-`.
- New `tests/unit/FileSyncStateStore.test.ts`, using the `LOCALLY_CONFIG_DIR` temp-dir pattern
  and `os.homedir` spy from `tests/unit/FileSettingsStore.test.ts` (never the real
  `~/.spotify-local-import`):
  - a `sync-state.json` with two `pendingFromPhone` entries, one with a `.wav` track and one
    valid, plus non-empty `pushedUpdatedAt`/`uploadedFiles`/`coverHash`: `get()` returns only
    the valid entry and all three other maps intact;
  - the same with a `pendingFromPhone` entry that is not an object: dropped, file still loads;
  - missing file → `emptySyncState()`; unparsable JSON → `emptySyncState()`; a file whose
    outer shape is wrong (e.g. `pushedUpdatedAt` is an array) → `emptySyncState()` (pins the
    existing behaviour so the per-entry leniency is visibly limited to `pendingFromPhone`);
  - `set()` then `get()` round-trips a state with one valid pending record.
- `tests/unit/SyncEngine.test.ts`, `SyncApi.test.ts`, `ReleaseService.test.ts`: no new cases.
  Every hand-built record in them already uses `.mp3`/`cover.jpg` names (checked); if
  `npm run check` finds one that does not, fix the test data, not the rule.

### apps/ios (`xcodegen generate`, `xcodebuild` build; `xcodebuild test` when a simulator is available)

- `LocallyTests/SyncRecordTests.swift`:
  - decoding the spec example with `"file": "01 - Intro.wav"` throws `SyncRecordRejected` with
    `field == "tracks[0].file"`, `name == "01 - Intro.wav"`;
  - decoding with `"cover": "cover.gif"` throws `SyncRecordRejected(field: "cover", ...)`;
  - decoding with `"file": "01 - Intro.MP3"` and `"cover": "cover.JPEG"` succeeds, and with
    `"cover": null` succeeds;
  - a structurally broken record (`tracks` missing) still throws a `DecodingError`, not
    `SyncRecordRejected`;
  - `roundTripsThroughEncodeAndDecode` and the v1/v2 `coverHash` tests keep passing unchanged;
  - `SyncFileName.hasSupportedExtension` table: the same accept/reject names as the web list.
- `LocallyTests/SyncReleasesPageDecodingTests.swift` (existing `URLProtocol` stub):
  - a page of three records where the second has a `.wav` track decodes to two releases, the
    given `nextVersion` and `hasMore`, without throwing;
  - a page where one record has a malformed `updatedAt` still throws `SyncApiError.network`
    (today's behaviour for a broken page, kept on purpose).
- `LocallyTests/SyncFixtureTests.swift`: remove the `invalid-api-` filter and the
  `invalidApiCount` term; update the header comment (the client parser now checks extensions
  at decode time, so every `invalid-*` fixture must be rejected). `clientAccepts` keeps its
  decode + `isPlainFileName` shape.
- `LocallyTests/SyncEngineTests.swift`: no change. `FakeSyncApi` hands the engine
  `SyncRecord` values, never JSON, so decode-time rejection is covered by the two suites above.

## Files touched

| File | Change |
| --- | --- |
| `spec/sync.md` | Record sentence on extensions; drop the `invalid-api-*` bullet |
| `spec/fixtures/sync/invalid-api-bad-extension.json` → `spec/fixtures/sync/invalid-bad-extension.json` | rename, content unchanged |
| `spec/fixtures/sync/invalid-cover-bad-extension.json` | new fixture, `cover.gif` |
| `apps/api/tests/unit/syncFixtures.test.ts` | drop `invalid-api-` handling |
| `apps/web/src/server/sync/SyncRecord.ts` | `SYNC_FILE_EXTENSIONS`, `hasSyncFileExtension`, `syncFileName` on `file` and `cover` |
| `apps/web/src/server/sync/FileSyncStateStore.ts` | per-entry `pendingFromPhone` parsing |
| `apps/web/tests/unit/SyncRecord.test.ts` | extension accept/reject cases |
| `apps/web/tests/unit/syncFixtures.test.ts` | drop `invalid-api-` handling |
| `apps/web/tests/unit/FileSyncStateStore.test.ts` | new |
| `apps/web/AGENTS.md` | one-line map update |
| `apps/ios/Locally/Domain/SyncRecord.swift` | `SyncFileName`, `SyncRecordRejected`, `SyncRecord.init(from:)`, `SyncRecordPageElement` |
| `apps/ios/Locally/Services/SyncApi.swift` | `releases` decodes `[SyncRecordPageElement]` and `compactMap`s |
| `apps/ios/LocallyTests/SyncRecordTests.swift` | decode rejection/acceptance cases |
| `apps/ios/LocallyTests/SyncReleasesPageDecodingTests.swift` | mixed page and broken page cases |
| `apps/ios/LocallyTests/SyncFixtureTests.swift` | drop `invalid-api-` handling, comment |
| `apps/ios/AGENTS.md` | one-sentence rule update |

Not touched: anything under `apps/api/src`, `apps/web/src/server/sync/SyncApi.ts`,
`apps/web/src/server/sync/SyncEngine.ts`, `apps/ios/Locally/Services/SyncEngine.swift`,
`apps/ios/Locally/Coordinator/ReleaseCoordinator.swift`, `apps/ios/project.yml`, `STATUS.md`
(no user-visible capability changes; nothing there becomes stale).

## Checks before pushing

- `apps/api`: `npm run check` (fixture test only; proves the rename and new fixture are
  rejected by the API schema).
- `apps/web`: `npm run check`.
- `apps/ios`: `xcodegen generate`, then the `xcodebuild ... build CODE_SIGNING_ALLOWED=NO`
  command from `apps/ios/AGENTS.md`; `xcodebuild test` on a simulator when one is available.
- Land web, iOS, spec and fixtures in one change (one PR), so no app's fixture test is red in
  between: the moment the fixture is renamed, the web and iOS tests demand rejection.

## Order and dependencies

- Independent of #38 by construction: this plan edits `SyncRecord.swift` and `SyncApi.swift`,
  #38 edits `SyncEngine.swift`; rebase either way is clean.
- No dependency on API deploys.

## Not in this plan

- Web `HttpSyncApi.listReleases` skipping a rejected record instead of failing the page (the
  iOS behaviour after this plan). Today web fails the page on a bad plain name too, and the
  issue asks only for the schema and the state file; if the asymmetry matters, raise it as its
  own issue and apply the same "skip the one record" rule with a `safeParse` there.
- Adopting the API's 200-character name cap in the clients (they allow 255).
- Validating `SyncTrack` when decoded on its own (nothing does), or validating records built in
  code (`toSyncRecord`), which both clients already produce with allowed extensions.
- Surfacing a skipped record to the user on iOS (no `lastError`, no log line). A log line can
  be added later where `HttpSyncApi.releases` compacts the page.
