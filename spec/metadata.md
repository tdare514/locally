# Shared metadata model

Both apps (apps/web on the Mac, apps/ios on the phone) write the same information into audio
files and keep the same index shape, so a file tagged by one is understood by the other and shows
identically in Spotify's Local Files.

## Release

| Field | Type | Notes |
| --- | --- | --- |
| id | UUID string | stable key; never derived from title |
| kind | `single` \| `album` | a single has exactly one track |
| title | string | album title; for a single defaults to the track title |
| artist | string | album artist and, unless a track overrides, track artist |
| year | string or null | four digits |
| genre | string or null | free text |
| coverPath | path or null | `cover.jpg` or `cover.png` beside the tracks |
| folderPath | path | where the tracks live |
| tracks | Track[] | ordered by trackNumber |
| createdAt, updatedAt | ISO 8601 | |

## Track

| Field | Type | Notes |
| --- | --- | --- |
| id | UUID string | |
| title | string | |
| trackNumber | int, 1-based | position in the whole release: unique and continuous, the file key (`ReleaseLayout.trackFileName`), unchanged by discs |
| discNumber | int 1-99, optional | which disc of a multi-disc release; absent on a single-disc release. The key is omitted, never written as null |
| filePath | path | the file as imported; never renamed on edit in either app, because Spotify playlists reference local tracks by path |
| originalName | string | name the user imported |
| durationSec | number or null | |

## Tags written into files

| Meaning | mp3 (ID3v2.4) | m4a (iTunes atoms via AVMetadataItem) |
| --- | --- | --- |
| title | TIT2 | ©nam |
| artist | TPE1 | ©ART |
| album artist | TPE2 | aART |
| album | TALB | ©alb |
| track | TRCK `N/TOTAL` (per disc when discs are set) | trkn (N, TOTAL) per disc |
| disc | TPOS `D/DISCS`, only when discs are set | disk (D, DISCS) |
| year | TDRC (TYER on the Mac's node-id3) | ©day |
| genre | TCON | ©gen |
| cover | APIC type 3 front cover, jpeg or png | covr |

Per-disc track numbers. `trackNumber` is the release-wide position and never restarts, so the number
written into a file's track tag is derived: the track's 1-based position among the tracks with the same
disc, ordered by `trackNumber`, and TOTAL is the count of tracks on that disc. Discs `[1,1,1,2,2]` give
TRCK `1/3`, `2/3`, `3/3`, `1/2`, `2/2`. DISCS is the highest `discNumber` in the release. A track with no
`discNumber` counts as disc 1 once any track in the release has one. When no track has a `discNumber`,
the track tag is `trackNumber/total` exactly as before and no TPOS or `disk` is written.

Import. When the imported files carry a disc tag, `discNumber` is prefilled from it and the files are
ordered by (disc, the file's own track number); continuous `trackNumber` values are then assigned in that
order. Files without disc tags import as before. Editing disc numbers in the UI is not built yet.

## File layout and naming

- Mac library: `<libraryDir>/<Artist>/<Album>/<NN> - <Title>.mp3` plus `cover.*`. Duplicate
  artist/album pairs get ` (2)`, ` (3)` suffixes on the album folder.
- iOS Spotify folder: flat, `<Artist> - <Album> - <NN> - <Title>.<ext>` because Spotify's iOS folder
  is scanned flat and the user sees the names in Files. Same sanitising rules as the Mac.
- Sanitising a segment (both apps, in this order):
  1. Missing input is the empty string.
  2. Remove control characters U+0000-U+001F and U+007F.
  3. Remove invisible reordering characters U+061C, U+200B-U+200F, U+202A-U+202E, U+2066-U+2069,
     U+FEFF.
  4. Remove `/ \ : * ? " < > |`.
  5. Strip leading and trailing dots and whitespace (JavaScript `\s`: U+0009-U+000D, U+0020,
     U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF).
  6. Cap the length: keep whole grapheme clusters from the start while the result stays within 200
     Unicode code points and 239 UTF-8 bytes (255 less 16 reserved for an extension or ` (n)`).
     A cluster that would cross either limit is dropped with everything after it.
  7. Strip trailing dots and whitespace again.
  8. An empty result becomes `Unknown`.

  Shared cases live in `spec/fixtures/filenames/`; both apps' tests run them.

## Formats

- Mac: anything ffmpeg reads in; always writes mp3 320 kbps (Spotify desktop reads mp3/mp4 only).
- iOS: mp3 and m4a pass through untouched; wav, flac, aiff are converted to AAC m4a 256 kbps
  (iOS has no mp3 encoder). Spotify iOS reads mp3 and m4a.
