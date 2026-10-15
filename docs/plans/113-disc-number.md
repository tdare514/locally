# #113: disc number

Multi-disc albums are a known gap in Spotify local files: without a disc tag, disc 2's track 1 sorts
next to disc 1's track 1. This adds an optional disc number to the model, the sync record, and the
tags both apps write.

## The key choice: `trackNumber` stays the release-wide position

`trackNumber` is already the file key. `ReleaseLayout.trackFileName` names files by it,
`rejectDuplicateTrackNumbers` forbids collisions, and Spotify playlists reference files by path. Restarting
it at 1 on each disc would change file names and break that invariant. So:

- `trackNumber` keeps its meaning: the 1-based position in the whole release, unique, continuous. It is
  unchanged everywhere.
- `discNumber` is new, optional, an int from 1 to 99. Absent means a single-disc release, the same as
  today.
- The number written into the file's track tag is derived. It is the track's 1-based position among
  tracks with the same disc, ordered by `trackNumber`. Example: discs [1,1,1,2,2] give TRCK 1/3, 2/3,
  3/3, 1/2, 2/2.
- When the release has no disc numbers, the tags are exactly what they are today: TRCK
  `trackNumber/total` and no TPOS or disk tag.

## Contract (spec/sync.md, spec/metadata.md)

- The track entry in `release.json` gains `discNumber?: int (1..99)`. When it's absent, the key is
  omitted, not written as null.
- Backward compatible: older clients ignore the key. zod's default `object` strips unknown keys, so an
  old client that re-pushes a record drops `discNumber`. That's acceptable because only the owner's own
  devices sync today and they update together. Note it in the spec.
- `apps/api/src/shared/types.ts` `trackRecordSchema`: add `discNumber: z.number().int().min(1).max(99).optional()`.
- Web `validation.ts`: the same optional field on the track schemas. No change to the duplicate check.

## Tags (spec/metadata.md table)

| Meaning | mp3 (ID3v2.4) | m4a |
| --- | --- | --- |
| track | TRCK `N/TOTAL`, where N and TOTAL are per disc when discs are set | trkn (N, TOTAL) per disc |
| disc | TPOS `D/DISCS`, only when discs are set | disk (D, DISCS) |

DISCS is the highest `discNumber` in the release.

- Web (Mac): node-id3 `partOfSet` writes TPOS. Read through music-metadata `common.disk.no` and `.of`.
- iOS: `ID3TagWriter` adds a TPOS text frame, and `M4ATagWriter` adds the `disk` atom next to `trkn`
  in the same binary format.

## Import (both apps)

When imported files carry a disc tag, prefill `discNumber` from it and order tracks by (disc, file track
number), then assign continuous `trackNumber` values. Files without disc tags behave as today.

## UI (minimal in this change)

- Release page and import track list: when any track has a `discNumber` and the release has more than one
  disc, group rows under quiet "Disc 1" and "Disc 2" headings in sentence case, no caps. The grouping is
  presentational only. The order is still `trackNumber`.
- Editing disc numbers in the UI is a follow-up issue that needs a small design. Not in this change.

## Tests

- A pure helper for "derive per-disc track tag numbers", in each app, with the example above.
- A tag write and read round trip for mp3 (both apps) and m4a (iOS).
- API and web validation accept a missing value or 1..99, and reject 0, 100 and 1.5.
- An import prefill from a tagged fixture, if a fixture is cheap to make. Otherwise unit-test the ordering
  helper.

## Security and speed

- Security: one bounded integer field, validated at every boundary (API, web). No new paths or
  inputs.
- Speed: none. The tag work happens at write time only.
