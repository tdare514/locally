# #87: one file-type list and one name-length rule across the three apps

## Why

A sync record's file names (`tracks[].file`, `cover`) are checked three times, by hand-copied rules that have drifted:

| | Extensions | Length |
|---|---|---|
| API `apps/api/src/shared/types.ts` `fileNameSchema` | `SUPPORTED_FILE_EXT` | at most **200 UTF-16 units** |
| Mac `apps/web/src/server/sync/SyncRecord.ts` | `SYNC_FILE_EXTENSIONS` | at most **255 UTF-16 units** |
| iPhone `apps/ios/Locally/Domain/ReleaseLayout.swift` `isPlainFileName`, `SyncRecord.swift` | `supportedExtensions` | at most **255 UTF-8 bytes** |

Two things go wrong:
- **Long multibyte names.** A name of 100 CJK characters (about 300 bytes) passes the API and the Mac, but the iPhone skips the record (#39), so the release never reaches the phone.
- **Adding a file type.** If the API gains `flac`, the copies don't follow.

## Decision

- **One rule, stated once:** a sync file name is a plain child name, at most **255 UTF-8 bytes**, the filesystem limit. It ends in one of `mp3`, `m4a`, `jpg`, `jpeg` or `png`, compared case-insensitively.
- **One source:** `spec/sync-file-names.json` = `{ "extensions": [...], "maxNameBytes": 255 }`. `spec/sync.md` points to it. Each app keeps its own constants (no code generation), and a test in each app reads the JSON and asserts its constants are equal. A drift fails CI in that app.
- **Each app checks bytes:**
  - API: `new TextEncoder().encode(name).length <= 255`, replacing `.max(200)`.
  - Mac: the same.
  - iPhone: already does.

## Compatibility

- **What loosens:** names of 201 to 255 bytes that are ASCII-ish. The API accepted up to 200 units before, and shipped Macs and iPhones already accept up to 255, so old clients keep working.
- **What tightens:** names of at most 200 units but over 255 bytes, which only multibyte text can reach. The API will refuse them, and the Mac will skip them on pull. The iPhone already refuses them, so these releases never reached the phone anyway.
  - Since #85, both apps' filename sanitising caps a segment at 239 UTF-8 bytes, so neither app makes such names any more.
  - The only risk is a release named on the Mac **before #85** with a long multibyte title. Its next push would get a 400.
  - **Build note:** the production count was not run (no production access in the build); the compatibility branch below is built in regardless.
  - Before tightening, the build step runs one read-only production query for live releases with a file name over 255 bytes, and reports the count to the owner. If it's not zero, the API keeps accepting an over-long name that is **already stored** on that release (a re-push of the same name), and refuses only new ones.

## Fixtures (`spec/fixtures/sync/`)

- `valid-name-multibyte-at-limit.json`: a track file of exactly 255 UTF-8 bytes in multibyte characters.
- `invalid-name-multibyte-one-byte-over.json`: 256 bytes.
- `valid-ext-<ext>.json` for each extension, in mixed case once (`.MP3`).

All three apps already run every `spec/fixtures/sync/*` file, so these cases run everywhere.

## Tests

- In each app, the fixture tests above, and the constants-equal-the-JSON test.
- In the API, a request test: a 256-byte name is a 400, and 255 bytes is accepted. If the compatibility branch is needed, a re-push of a stored over-long name is accepted.

## Session brief (for the build)

```
Model: sonnet (a written plan across three apps' validators)
Read only: docs/plans/87-sync-name-rules.md, spec/sync.md, spec/fixtures/sync/, apps/api/src/shared/types.ts, apps/web/src/server/sync/SyncRecord.ts, apps/ios/Locally/Domain/SyncRecord.swift, apps/ios/Locally/Domain/ReleaseLayout.swift, and each app's existing sync-fixture test
Do not touch: anything outside sync-record validation and its tests
Verify: cd apps/api && npm run check; cd apps/web && npm run check; apps/ios xcodegen generate, build and test on one simulator (shut down after)
Done when: the three apps read the same rule from spec/sync-file-names.json in tests, the new fixtures pass everywhere, and the production count is reported in the PR
```
