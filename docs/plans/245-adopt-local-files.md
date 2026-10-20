# #245: adopt the Spotify local files already on the Mac (details only)

## Why

The owner (16 Oct): "Locally doesn't need to play… it just needs to be able to track." Today the
library and the stats only know releases made in Locally. The owner's real listening is the music
Spotify already reads on the Mac: `~/Documents/Spotify Music`, 1,417 mp3 and 150 m4a files in 77
folders, 8.6 GB. Adopting it puts that music in Locally's library on the Mac and the iPhone, and lets
its plays count (#106 on the Mac today; phone plays through the Spotify connection, #239 and #228).

## What is true today

- **Identity.** Spotify knows a local track as `spotify:local:artist:album:title:seconds`, built from the
  file's own tags (TPE1/©ART, TALB/©alb, TIT2/©nam) and its length. Playlists hold that id, and the
  Mac's play tracker matches it (`apps/web/src/server/plays/LocalTrackResolver.ts`: album against the
  release title, then artist and title, then length within a tolerance). Change a tag and the id
  changes, which breaks playlists (14 Oct notes).
- **The Mac library** is `library.json` in the library folder (`JsonLibraryRepository`), and
  `ReleaseService.assertInsideLibrary` refuses any path outside that folder, for reads and writes.
- **Sync** pushes a record, then uploads every track and the cover. A record that arrives on another
  device and isn't in its library goes to the "From your devices" inbox, whose one action, Send to
  Spotify, downloads the files. `GET /v1/files/missing` (#170) lists records whose files aren't stored.
  `PUT /v1/plays` counts only the user's live releases.
- So adopting by importing would copy and re-tag 8.6 GB (wrong), and syncing adopted releases as they
  are would upload 8.6 GB, flood the phone's inbox with about 250 releases it can't send, and make every
  one "missing".

## Decisions (the owner confirms these on the plan's pull request)

1. **In place, read-only.** Locally never writes, moves, renames, re-tags or deletes an adopted file,
   and never writes inside a chosen folder (covers go to Locally's own data). An adopted release can't
   be edited in v1, because an edit changes Spotify's id. "Remove from Locally" only forgets it.
   Editing with a playlist warning is later.
2. **Folders.** The owner adds the folders Spotify reads, in Settings. Locally suggests
   `~/Documents/Spotify Music` when it exists. Subfolders are scanned. Locally's own library folder is
   never scanned, and a file already in the library is skipped.
3. **Formats.** mp3, m4a and audio-only mp4 (what Spotify plays). Anything else is counted and listed
   as skipped. That covers all 1,567 of the owner's audio files.
4. **Grouping** (one folder at a time, so the owner's Masters / Unmastered / OG Files stay apart):
   - files with the same album artist (TPE2/aART, else the most common TPE1/©ART) and album form one
     release; it's an album when it has two or more tracks, otherwise a single;
   - a file with no album tag is a single, titled from its title tag or else its file name;
   - track order from the track tag, then the file name; discs from TPOS/disk;
   - year from TYER, TDRC or ©day; genre from TCON/©gen; the cover from the first file with embedded
     art.
5. **Matching plays.** Each adopted track stores `localId`, the `spotify:local:` id Spotify builds from
   its tags (Spotify's encoding: `+` for a space, percent-encoding otherwise, length in whole seconds).
   The resolver matches adopted tracks by exact `localId` first, which also handles files with no album
   tag (an empty album segment, which today's rule can't match), then falls back to today's rule.
   A play that matches two copies (the same song in two folders) counts once, for the first in library
   order.
6. **Details only.** An adopted release syncs as a record with `"source": "adopted"`. Only its cover is
   uploaded. Its audio is already where it's needed (on the Mac, and on the phone through Spotify).
   Uploading the audio on request is later.
7. **On the iPhone** an adopted record goes straight into the library as a details-only release: never
   the inbox, no Send, no Edit, a short "In your Mac's Spotify folder" line. Its plays and stats show
   like any release.
8. **New files.** "Check for new files" in Settings scans again: new groups go to the review, and a
   file that disappeared marks its track missing (shown, never deleted).

## The record (`spec/sync.md`)

- Optional `source` on a release record: `"adopted"`, or absent for Locally's own releases. A client
  that doesn't know the key ignores it (the owner's devices update together, as with `discNumber`).
- `tracks[].file` is the file's own name and `bytes` its size. No upload rows are made for tracks.
- API: validation accepts `source`; it's stored with the record; `GET /v1/files/missing` checks only the
  cover of an adopted record; `POST /v1/releases/:id/files` for an adopted release accepts only the
  cover name.

## Mac

- **Settings:** `adoptRoots: string[]` in the settings file.
- **Scanner** (`apps/web/src/server/adopt/`): realpath each root; walk it without following a symlink
  out of the root; skip hidden files and the library folder; read tags with the existing tag reader
  (`TagService`); read the length; group (decision 4); compute each `localId`. The result is a
  proposal: groups with their tracks and paths, plus skipped counts by extension. The last proposal is
  kept in Locally's app data so the review survives a restart.
- **Adopt:** each accepted group becomes a release with `adopted: true`, `folderPath` its folder,
  `coverPath` `<app data>/adopted-covers/<release id>.jpg` (the embedded art, extracted), and tracks with
  absolute `filePath`, `durationSec` and `localId`.
- **Guards:** one `assertWritable(release)` used by every write path (re-tag, cover replace, delete
  files, accept, Send) refuses an adopted release. A sibling of `assertInsideLibrary` allows reads inside
  `adoptRoots` only, after realpath.
- **Sync:** an adopted release pushes its record with `source: "adopted"` and uploads only its cover.
  `uploadedFiles` treats its tracks as never-uploaded by design, so the back-fill doesn't retry them.
- **Routes:** `POST /api/adopt/scan` (start a scan of the saved roots and return the proposal with
  progress), `GET /api/adopt/proposal`, `POST /api/adopt` (ids of the accepted groups),
  `DELETE /api/releases/:id?forget=1` (remove an adopted release from Locally).
- **UI** (the design entry is written in `docs/design.md` first):
  - Settings › "Your Spotify folders": the folders, Add folder, Check for new files.
  - A review page: summary ("214 releases, 1,567 tracks; 3 files skipped"), then each proposed release
    (cover, title, artist, track count, folder) with a tick, all ticked; then Adopt.
  - The library shows adopted releases like the rest, marked with a small folder glyph labelled "In
    your Spotify folder" (the line itself is on the release page; #249's design entry). Their
    release page is the view mode with no Edit, plus Remove from Locally.

## iPhone

- A pulled record with `source: "adopted"` becomes a details-only release in the library: no files, no
  inbox entry, the cover from the server, the release page in view mode with no Edit. The self-heal
  (#171) skips it (the server won't list its tracks as missing anyway).

## Volume and security

- About 250 releases. The existing push back-fill and 200-record pull pages cope; the first push is paced
  by the back-fill as today.
- Reading outside the library folder is new. Reads only, only inside the chosen roots after realpath, no
  symlink escape, never a write. Add it to `SECURITY.md`, with tests for `..`, symlinks pointing out of a
  root, and a root removed after adoption.

## Build issues

| Issue | What | Depends on | Area |
| --- | --- | --- | --- |
| A (#246) | Spec and API: `source: "adopted"` | none | `spec/sync.md`, `apps/api` |
| B (#247) | Mac: folders setting and the scanner | none | `apps/web/src/server/adopt/`, settings store |
| C (#248) | Mac: adopt, guards, details-only sync, play matching, routes | #246, #247 | `apps/web/src/server/**`, `apps/web/src/app/api/adopt/` |
| D (#249) | Mac: Settings folders, review page, adopted releases in the library (design first) | #248 | `docs/design.md`, `apps/web/src/components/**` |
| E (#250) | iPhone: details-only adopted releases | #246 | `apps/ios` |

A, B and E can run at the same time. C needs A and B; D needs C's routes. B and C both touch the
settings store: B adds the field, C reads it, so C starts after B merges. C owns `apps/web/src/server`
and the routes; D owns the components and `docs/design.md`.

## Not in this plan

Uploading audio for adopted releases; editing an adopted release (playlist-safe, with a warning);
adopting files that are only on the iPhone; more than one library (#7).
