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
| trackNumber | int, 1-based | |
| filePath | path | current file, renamed on edit only on the Mac; the iOS app keeps names fixed |
| originalName | string | name the user imported |
| durationSec | number or null | |

## Tags written into files

| Meaning | mp3 (ID3v2.4) | m4a (iTunes atoms via AVMetadataItem) |
| --- | --- | --- |
| title | TIT2 | ©nam |
| artist | TPE1 | ©ART |
| album artist | TPE2 | aART |
| album | TALB | ©alb |
| track | TRCK `N/TOTAL` | trkn (N, TOTAL) |
| year | TDRC (TYER on the Mac's node-id3) | ©day |
| genre | TCON | ©gen |
| cover | APIC type 3 front cover, jpeg or png | covr |

## File layout and naming

- Mac library: `<libraryDir>/<Artist>/<Album>/<NN> - <Title>.mp3` plus `cover.*`. Duplicate
  artist/album pairs get ` (2)`, ` (3)` suffixes on the album folder.
- iOS Spotify folder: flat, `<Artist> - <Album> - <NN> - <Title>.<ext>` because Spotify's iOS folder
  is scanned flat and the user sees the names in Files. Same sanitising rules as the Mac.
- Sanitising a segment: strip `/ \ : * ? " < > |`, trim, strip trailing dots and spaces, fall back
  to `Unknown`.

## Formats

- Mac: anything ffmpeg reads in; always writes mp3 320 kbps (Spotify desktop reads mp3/mp4 only).
- iOS: mp3 and m4a pass through untouched; wav, flac, aiff are converted to AAC m4a 256 kbps
  (iOS has no mp3 encoder). Spotify iOS reads mp3 and m4a.
