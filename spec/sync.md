# Sync between the Mac app and the iOS app

Decided 27 Sep 2026. Both apps share one folder in the user's iCloud Drive. No server, no
account, nothing leaves the user's devices except through Apple's own iCloud sync.

## Why a folder, why iCloud Drive

- The Mac app is a local web app; it can read and write any folder, including
  `~/Library/Mobile Documents/com~apple~CloudDocs/`, which macOS syncs.
- The iOS app runs on a free Personal Team, which cannot use an iCloud container. It can,
  however, hold a security-scoped bookmark to any folder the user picks in the Files app,
  including one in iCloud Drive. This is the same mechanism it already uses for Spotify's folder,
  so it is proven on a phone.
- A hosted service would add accounts, storage cost and a privacy story; none of that is needed
  for one person's two devices. It stays an option for a later "paid plans" discussion.

## The folder

Default `iCloud Drive/Locally` (on the Mac: `~/Library/Mobile Documents/com~apple~CloudDocs/Locally`).
Either app creates it. Layout:

```
Locally/
  releases/
    <releaseId>/
      release.json          the record below
      cover.jpg | cover.png the cover, if any
      01 - Title.mp3        one file per track, already tagged, named "<NN> - <Title>.<ext>"
```

Tracks are the finished, tagged files: whatever device made them has already converted and
tagged them, so the other device only copies them into its own Spotify folder. Track file
names inside a release folder never change after they are written (Spotify playlists depend
on names; both apps re-tag in place).

## release.json

The shared metadata model (`spec/metadata.md`) plus sync fields. Written whole, atomically
(temp file then rename).

```json
{
  "syncVersion": 1,
  "id": "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90",
  "kind": "album",
  "title": "Night Drive",
  "artist": "Chromatics",
  "year": "2024",
  "genre": null,
  "cover": "cover.jpg",
  "tracks": [
    { "id": "…", "title": "Intro", "trackNumber": 1, "file": "01 - Intro.mp3", "durationSec": 61.2 }
  ],
  "origin": "mac" | "ios",
  "originDevice": "Toby's MacBook",
  "createdAt": "2026-09-27T20:00:00Z",
  "updatedAt": "2026-09-27T20:00:00Z",
  "deleted": false
}
```

- `id` is the release id on the device that created it; the receiving device keeps the same id
  so edits and deletes match up.
- `updatedAt` rises on every metadata change. A device that sees a newer `updatedAt` than its
  local copy re-tags its own files in place from the record (title, artist, album, year, genre,
  track titles and numbers, cover) and updates its index. It never renames.
- `deleted: true` is a tombstone. The receiving device removes its files and index entry, then
  leaves the tombstone in place (the sync folder keeps tombstones for 30 days, after which
  either app may remove the folder).
- Track files and the cover are written before `release.json`, so a reader that sees the record
  can rely on the files being complete. Partially uploaded iCloud files are handled on the
  reader's side (below).

## What each app does

**Mac app (`apps/web`)**
- Setting `syncDir` (default above; can be turned off). Settings page shows the state.
- On import, update, replace cover and delete: mirror into `syncDir/releases/<id>/` as above
  (`origin: "mac"`). This is a copy; the Mac's own library folder is unchanged.
- A watcher on `syncDir/releases` (polling every 10 s is enough; iCloud changes arrive in
  batches): a new release with `origin: "ios"` not yet in the local index is imported into the
  Mac library and Spotify folder using the existing import path but skipping conversion and
  tagging when the file is already an mp3 (m4a from the phone is converted to mp3 as usual,
  since Spotify desktop reads mp3). Newer `updatedAt` re-tags in place; tombstones delete.
- The sidebar shows "From your phone" rows while a release is being imported.

**iOS app (`apps/ios`)**
- Settings: "Connect your Mac library" opens the folder picker (the user picks
  `iCloud Drive/Locally`); a bookmark is stored like Spotify's. The onboarding does not require
  it.
- On foreground and on the Add a song tab's refresh: read `releases/*/release.json`. Records with
  `origin: "mac"` not in the local index are shown as waiting ("From your Mac"), with one action:
  Send to Spotify. Sending copies the tracks into Spotify's folder (no conversion or tagging
  needed), stores the cover, records the release with the same id. iCloud placeholders are
  downloaded first with `FileManager.startDownloadingUbiquitousItem` inside an
  `NSFileCoordinator` read, with a progress state.
- On every send, edit, cover replace and delete the phone did itself: mirror into the sync folder
  (`origin: "ios"`) the same way.
- Newer `updatedAt` from the Mac re-tags the phone's files in place; tombstones delete.

## Conflicts

Last writer wins by `updatedAt`. Both apps write `updatedAt` from their own clock in UTC; a
one-off difference of seconds does not matter for a single person's devices. A release is only
ever created by one device, so ids never collide.

## Not in this phase

- Playlists (Spotify has no API for local files on either platform).
- Merging two existing libraries: a release that exists on both devices before sync is turned on
  is treated as two releases. The Settings page says so.
- Anything that needs an iCloud container or a paid Developer account.
