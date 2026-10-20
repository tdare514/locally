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
| year | TDRC and TYER (the iPhone writes both, #234; the Mac's node-id3 writes TYER) | ©day |
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
order. Files without disc tags import as before. Both apps edit discs as contiguous ranges (#222): a track's number opens "Start disc N here" (that track and the rest of its range become the next disc) or, on the first track of a later disc, "Join disc N"; discs renumber by range from the first track's disc, and joining back to one disc numbered 1 clears the disc numbers.

## Tag set: what Spotify and Apple Music read (#223, 16 Oct 2026)

Method. Eleven probe files, every tag set to a marker that names it ("P3 Composer"), in mp3 ID3v2.3 and
v2.4, m4a and flac, with covers of 300, 1400 and 3000 px, were dropped into a folder Spotify desktop
watches. What Spotify parsed was read from its own local-files index (`local-files.bnk`: title, artist,
album, album artist, length, track, disc, year, date added, path), and the covers from its Local Files
list on screen. Spotify desktop 1.3.5.3058 on macOS. Apple Music's fields are its scripting dictionary's
track properties (`sdef Music.app`). Spotify on iPhone: see "On the iPhone" below.

| Field | mp3 frame | m4a atom | Spotify Mac reads | Spotify shows | Apple Music | Locally today | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| title | TIT2 | ©nam | all formats | list, now playing | yes | written | keep, show |
| artist | TPE1 | ©ART | all formats | list (under the title) | yes | written | keep, show |
| album | TALB | ©alb | all formats | list (Album column) | yes | written | keep, show |
| album artist | TPE2 | aART | mp3 only (not m4a, not flac) | nowhere | yes | written, = artist | keep, hidden (an editable album artist waits for the artist list, #224) |
| track number | TRCK | trkn | all formats | nowhere (list order is Spotify's own) | yes | written | keep, show (Locally's row numbers) |
| disc number | TPOS | disk | mp3 only | nowhere | yes | written when set | keep, show (editing is #222) |
| year | TYER (see below) | ©day | mp3 TYER only; m4a ©day; not flac | nowhere | year, release date | Mac TYER; iPhone mp3 TDRC and TYER (#234), m4a ©day | keep, show; full dates are #221 |
| genre | TCON | ©gen | no | nowhere | yes | written | keep, show (Locally's library and search, Apple Music) |
| cover | APIC type 3 | covr | all formats | list and now playing, 300 to 3000 px all shown | yes | written, 1500 px max | keep, show; 1500 px stays |
| composer | TCOM | ©wrt | no | no | yes | kept on both apps (iPhone since #235) | keep hidden |
| grouping | GRP1 | ©grp | no | no | yes | as composer | keep hidden |
| work, movement | TIT1, MVNM, MVIN | ©wrk, ©mvn, ©mvi, ©mvc | no | no | yes | as composer | keep hidden |
| BPM | TBPM | tmpo | no | no | yes | as composer | keep hidden |
| comment | COMM | ©cmt | no | no | yes | as composer | keep hidden |
| lyrics | USLT | ©lyr | no | no | yes | as composer | keep hidden (a later in-app player could show them) |
| compilation | TCMP | cpil | no | no | yes | as composer | keep hidden |
| sort title, artist, album, album artist | TSOT, TSOP, TSOA, TSO2 | sonm, soar, soal, soaa | no | no | yes | as composer | keep hidden |
| label, copyright, ISRC | TPUB, TCOP, TSRC | LABEL, cprt, ISRC | no | no | no field (kept in the file) | as composer | keep hidden |

"Keep hidden" means Locally never shows or edits the tag, and never removes it: a file keeps whatever
the person's other tools put there. The Mac's writer merges (`NodeID3.update`); the iPhone's two writers carry
every frame or atom they don't own into the new tag (#235): an mp3's v2.3 or v2.4 frames, grouped,
compressed and encrypted ones included (converted to v2.4's layout), and an m4a's items, freeform
`----` atoms included. Only a frame marked "discard when the tag is altered" or a malformed one is
dropped, and an mp3 whose old tag is over 32 MiB is refused rather than re-tagged. Nothing else is dropped. Rating, play count,
favourite, EQ, start and stop times are Apple Music library data, not tags, so they are out of scope;
Locally counts plays itself.

Year in mp3. Spotify reads the year only from a TYER frame, and reads it whatever the tag's version
(TYER inside a v2.4 tag works) and whether or not a TDAT day-and-month frame sits beside it. It ignores
TDRC, even a bare "2001". So an mp3 writer puts the year in TYER, and where it also wants a full date
(#221) writes TDRC with the full date beside it (Apple Music and other players read TDRC).

On the iPhone. The owner AirDropped the probes into On My iPhone › Spotify and played P1 (300 px cover)
and P3 (3000 px cover) in Spotify on an iPhone 14 (iOS 26.6.1), playing on the phone itself. Both covers
showed full size in now playing and on the lock screen, with the title and the artist (no album). Played
from the phone as a remote for the Mac, the same covers showed. The iPhone's own reading of album artist,
disc and year wasn't separately measured; it has no readable index.

Edits. Changing a probe's title in place reached Spotify desktop's index in about 30 seconds, as a new
entry for the same file (the old entry stays in the index). Whether the list shows the new title without
removing and re-adding the file is not confirmed, so Locally's "keeps the old name until it rescans" line
stays.

Sign-off. Proposed by #223; the owner signs off on the pull request that adds this section.

Formats. Spotify desktop also indexes flac: title, artist, album, track number and length, and shows its
cover, but not its album artist, disc or year. That doesn't change Locally's outputs (mp3 on the Mac,
mp3 or AAC m4a on the iPhone).

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

- Mac: anything ffmpeg reads in; always writes mp3 320 kbps (Spotify desktop plays mp3/mp4; it also indexes flac with fewer tags, see "Tag set").
- iOS: mp3 and m4a pass through untouched; wav, flac, aiff are converted to AAC m4a 256 kbps
  (iOS has no mp3 encoder). Spotify iOS reads mp3 and m4a.
