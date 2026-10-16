# #221: a release date, not just a year

## Why

Owner, 16 Oct 2026: "let's not just do release year, let's do release date, in case the user wants to edit
the date themselves, or the track already comes with some sort of date."

Today a release has `year`, four digits or null, in the shared model (`spec/metadata.md`), in the sync
record (the API checks `^\d{4}$`), in the Mac's index and in the iPhone's store. Files carry it as mp3
`TYER` (both apps) and `TDRC` (iPhone), and m4a `©day`. A date already in a file is cut to its year on
import.

## Decision

A release date can be a **year**, a **year and month**, or a **full day**: `YYYY`, `YYYY-MM` or
`YYYY-MM-DD`. It is optional, as the year is today.

- **Model (both apps).** `year` stays exactly as it is. A new optional `releaseDate` holds the date when
  it is more precise than a year: `YYYY-MM` or `YYYY-MM-DD`, a real calendar date (no month 13, no
  30 February; 29 February only in a leap year). It is absent when only the year is known. Whenever it is
  present, `year` equals its first four characters. Both apps set the two together from one value, so
  they cannot drift. No migration: the Mac's index and the iPhone's store gain one optional field, and
  every existing release reads as "year only".
- **One value in code.** Each app gets one small type or module (`ReleaseDate`) that parses a typed or
  tagged value into `{ year, month?, day? }`, validates it, and gives back `year`, `releaseDate` and the
  display text. Everything that reads or writes a date goes through it.
- **Display.** In view mode the date reads in the device's locale, at its own precision: "17 May 2024",
  "May 2024", "2024" (en-GB). Lists, sorting and the Stats page keep using `year`.

## Contract change (spec/sync.md, spec/metadata.md)

The record gains one optional key, following the `discNumber` precedent (`spec/sync.md`, "A `tracks[]`
entry may carry `discNumber`"):

```json
{ "year": "2024", "releaseDate": "2024-05-17" }
```

- `releaseDate` is `YYYY-MM` or `YYYY-MM-DD`, a real calendar date. It is omitted when only the year is
  known, and never written as null or as a bare year.
- When it is present, `year` must be non-null and equal its first four characters. The API answers 400
  otherwise, and for an impossible date.
- `syncVersion` stays 2. A client that doesn't know the key ignores it, and strips it if it re-pushes the
  record. As with `discNumber`, that is accepted because only the owner's own devices sync and they update
  together; the date falls back to its year, nothing breaks.
- Pull: a record whose `releaseDate` a client can't parse, or whose year disagrees, is applied with
  `year` alone (the date is dropped, the rest of the record is kept). It is never a reason to skip a
  record or fail a page.

`spec/metadata.md`: the Release table gains `releaseDate`, the tag table's year row becomes "release date",
and the `year` notes point here.

## Tags

What Spotify reads is measured (#223, `spec/metadata.md`): for mp3 it takes the year from `TYER` only and
ignores `TDRC`; for m4a it takes the year from `©day`, and a full `2001-02-03` there worked. Spotify shows
only the year. Apple Music and most other players read `TDRC` and `©day`.

| | Year only | Year and month, or full day |
| --- | --- | --- |
| mp3 `TYER` | `2024` | `2024` (Spotify's year) |
| mp3 `TDRC` | `2024` | `2024-05` or `2024-05-17` |
| m4a `©day` | `2024` | `2024-05` or `2024-05-17` |

- **Mac** (node-id3 0.2.9, writes an ID3v2.3 header with `NodeID3.update`): `year` writes `TYER`, and
  `recordingTime` writes `TDRC` into the same tag. node-id3 maps v2.4 frames into a v2.3 tag, as Mp3tag
  does (`ID3Helpers.js`), and the reader (`music-metadata`) reads it back. The build checks this with a
  read-back test. `TDAT` is not written: Spotify ignores it, and `TDRC` carries the day for everyone else.
- **iPhone**: `ID3TagWriter` already writes `TDRC` and `TYER` (#234); `TDRC` takes the full date.
  `M4ATagWriter` writes the full date to `©day`.
- When a date is shortened to a year, `TDRC` and `©day` are rewritten with the bare year, so no stale day
  is left behind.
- **Import prefill.** Read the most precise date the file has: mp3 `TDRC` (or `TYER` with `TDAT`), m4a
  `©day`. On the Mac that is `music-metadata`'s `common.date`, falling back to `common.year`. Keep a
  leading `YYYY`, `YYYY-MM` or `YYYY-MM-DD` that `ReleaseDate` accepts (so `2024-05-17T07:00:00Z` gives
  `2024-05-17`); anything else falls back to the year, or to nothing.

## UI (both apps)

The "Year" field becomes **Release date**. It sits where Year sits today: in the Year and Genre row on
iPhone (#220: date on the left, genre on the right, stacked from XX Large), and in the same places on the
Mac (import, the release page, bulk edit).

- Input: typed, and a year alone is a complete answer. The default control is three short boxes for
  day, month and year in the locale's order (GOV.UK "date input" pattern), where the year is required and
  month and day are optional (a day needs a month). The build session checks Mobbin for date-of-release
  inputs and shows the owner this and one alternative (a single text field with a calendar button that
  opens a date picker) as screenshots before building it out. The owner picks.
- Placeholder copy follows #220 ("Enter release date"); labels in sentence case; no dashes in copy.
- An impossible date shows an inline message under the field ("That date doesn't exist") and blocks Save,
  like the other field errors.
- Bulk edit on the Mac sets the whole date for every selected release.
- VoiceOver reads the formatted date ("17 May 2024"), and each box is labelled "Day", "Month", "Year".

## Compatibility

- Old records and old clients: no `releaseDate`, so every release shows its year as today.
- An old client receiving a new record ignores the key and keeps the year. If it edits and re-pushes the
  record, the date drops back to the year (accepted, see above).
- The API must deploy first. Today's record schema drops unknown keys, so a client that sent
  `releaseDate` before step 1 deploys would lose it silently.

## Security

No new endpoint, no new file. `releaseDate` is a short string validated by a regex and a calendar
check on the API and on both clients. It is never used in a file name or a path.

## Tests

- **API:** accepts `YYYY-MM` and `YYYY-MM-DD`; rejects a bare year in `releaseDate`, `2024-13`,
  `2023-02-29`, a year that disagrees, and `releaseDate` with a null year; a record without the key
  still round-trips unchanged; the stored record returns the key on pull.
- **`ReleaseDate` (both apps):** parse, validate (leap years included), display at each precision in
  en-GB and en-US, `year` and `releaseDate` derived together, an ISO timestamp from a tag cut to its
  day.
- **Sync (both apps):** the key round-trips; a record without it applies as year-only; a bad or
  disagreeing `releaseDate` on pull keeps the record with its year.
- **Tags (both apps):** each row of the table above, written then read back; shortening a date to a
  year leaves no day in `TDRC` or `©day`; tags Locally doesn't own are kept (#235).
- **UI:** a year alone saves; a full date saves and reads back formatted; an impossible date blocks
  Save with the message; Dynamic Type at XXXL on iPhone (#226).

## Rollout

1. **API** (apps/api): accept, validate and store `releaseDate`; update `spec/sync.md` and
   `spec/metadata.md`. Deploys on merge.
2. **Mac** (apps/web): `ReleaseDate`, the index field, the sync record, tags, import prefill, the
   release page, import and bulk edit.
3. **iPhone** (apps/ios): `ReleaseDate`, the store field, the sync record, both tag writers, import
   prefill, the import screens and the release page.

Each step is its own PR with its app's check. Steps 2 and 3 depend on 1, and are independent of each
other. Steps 2 and 3 are visible design changes: design skills and Mobbin first, `docs/design.md` first,
and a Codex review before merge.

## Session briefs (for the builds)

Step 1:

```
Model: sonnet (a written contract change in one schema plus tests and two spec edits)
Read only: docs/plans/221-release-date.md, apps/api/src/shared/types.ts (release record schema ~50-80),
  the API's release record tests (rg -n "year" apps/api/tests), spec/sync.md (Record), spec/metadata.md (Release, tags)
Do not touch: apps/web, apps/ios
Verify: cd apps/api && npm run check
Done when: the API tests in "Tests" pass, and spec/sync.md and spec/metadata.md describe releaseDate as above
```

Step 2:

```
Model: sonnet per part (model and sync, tags and import, UI), design judged by the session model
Read only: docs/plans/221-release-date.md, apps/web/src/shared/types.ts, apps/web/src/server/sync/SyncRecord.ts,
  apps/web/src/server/audio/Id3TagService.ts, apps/web/src/server/audio/TagService.ts,
  apps/web/src/server/http/validation.ts, apps/web/src/server/releases/ReleaseService.ts (year only),
  apps/web/src/components/ReleaseView.tsx, apps/web/src/components/import/ImportRecord.tsx,
  apps/web/src/components/BulkEditDialog.tsx, docs/design.md
Do not touch: apps/api, apps/ios, the user's real library
Verify: cd apps/web && npm run check
Done when: a date typed on the Mac saves, syncs with releaseDate, lands in TYER and TDRC, and an imported
  file's full date prefills; older releases still show their year; Codex has no blocking findings
```

Step 3:

```
Model: sonnet per part (model and sync, tags and import, UI), design judged by the session model
Read only: docs/plans/221-release-date.md, apps/ios/Locally/Domain/Models.swift, apps/ios/Locally/Domain/SyncRecord.swift,
  apps/ios/Locally/Services/LibraryStore.swift (the year property), apps/ios/Locally/Services/ID3TagWriter.swift,
  apps/ios/Locally/Services/M4ATagWriter.swift, apps/ios/Locally/Services/FileImporter.swift,
  the Year and Genre row (rg -n YearGenreRow apps/ios), docs/design.md
Do not touch: apps/api, apps/web
Verify: cd apps/ios && xcodegen generate && xcodebuild test (the repo's simulator destination)
Done when: a date typed on the iPhone saves, syncs with releaseDate, lands in TDRC/TYER or ©day, and an
  imported file's full date prefills; older releases still show their year; Codex has no blocking findings
```
