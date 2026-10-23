# #332: Locally on its own, on every device, and knowing where each release lives

## What the owner wants (23 Oct)

- Locally is a standalone app on each device: "do everything on the phone and everything on the Mac without needing
  both devices, because what if somebody doesn't have a Mac?"
- What's on the phone shows in Locally, and so does what's on the Mac. When the same thing is on both, Locally says so:
  "which devices it's on".
- **Decisions:**
  - **Phone adoption:** a review page first, like the Mac.
  - **Moving music:** yes, on request. "Put it on this iPhone" for a Mac-only release, and the reverse. The audio passes
    through the sync service, counts against storage, and is deleted from the service once delivered.
  - **The devices line and panel:** "On {device name}" for one device, and a shorter form for several (variants go to
    the owner). Tapping it raises a translucent panel from the bottom, like joining a Spotify Jam, listing each device
    with its icon and name. A swipe down or a tap closes it.

## What we measured (the spike, 23 Oct, on the owner's iPhone 14)

- Spotify on the iPhone plays only local files that are physically in `On My iPhone › Spotify`, at any depth.
  - It does **not** copy Mac local files to the phone. A new file added on the Mac stayed red on the phone, even in a playlist.
  - The owner's `Spotify/Synced files` folder is one they fill by hand. Locally's own imports sit at the top level.
- Locally's existing security-scoped bookmark is that `Spotify` folder, so the phone can read everything Spotify can play.
- A file copied to the phone is byte-identical to the Mac's (`G2 [final].mp3`, same SHA-256). It therefore has the same tags
  and the same `spotify:local:` id, so **`localId` identifies the same song on both devices**. File names can differ
  (case, extension), so names are never used to match.

## The model

- **A release is one thing, wherever it is.** It keeps one release id across devices.
  - Locally-made releases already do this.
  - An adopted release found on a second device whose tracks' `localId`s match a release already synced is **linked** to
    that release, never adopted twice (see "Adopting on a second device").
- **Holdings:** which devices hold a release's audio. Each device reports what it holds, and every device reads everyone's.
  - "Holds" means every track file of the release is present and readable on that device.
  - A device holding only some tracks reports them as partial.
- **Where a device keeps the audio:**
  - **Mac:** the library folder (Locally's releases), or the adopted file paths (read-only).
  - **iPhone:** the Spotify folder. Everything Locally writes lives in its own folder, `Spotify/Locally/` (#335; the name
    comes from one brand constant and may change). Its releases sit there. Files delivered by "Put it on this iPhone" go in
    `Spotify/Locally/From your Mac/<Artist>/<Album>/`. Adopted files stay where the user put them.

## Contract (spec/sync.md, apps/api)

### Holdings
- `PUT /v1/holdings` (device token) replaces this device's holdings.
  - Body: `{ releases: [{ id: string, complete: boolean }] }`, at most 10,000 entries.
  - Releases the caller doesn't own, or tombstoned ones, are ignored.
  - Clients send it on reconcile only when their set changed (they keep a hash of the last set sent).
  - Rate limit: 30 an hour per device.
- `GET /v1/holdings` → `{ devices: [{ deviceId, name, platform, updatedAt (ISO), releases: [{ id, complete }] }] }`.
  - Every live device of the account appears. Revoked devices and the cloud device are left out.
- **Storage:** a `holdings` table (`device_id`, `release_id`, `complete`, `updated_at`), replaced per device inside a transaction.
  The migration is additive.
- **Clients:**
  - An older client never calls these routes, and a device that never reports holds nothing.
  - The UI only shows "On …" for devices that have reported, and says nothing about the rest.

### Transfers ("Put it on this iPhone", "Put it on this Mac")
- `POST /v1/transfers` `{ releaseId, toDeviceId }` (the caller is usually the receiving device).
  - Answers `{ transfer: Transfer }`.
  - 409 `already_held` if `toDeviceId` holds it completely.
  - 409 `no_holder` if no other device holds it completely.
  - It is created `waiting`, and the server picks the holder: the most recently seen complete holder.
- `Transfer` = `{ id, releaseId, fromDeviceId, toDeviceId, state: "waiting"|"uploading"|"ready"|"delivered"|"failed"|"cancelled", createdAt, updatedAt, files: [{ name, bytes, uploaded: boolean }] }`.
- `GET /v1/transfers` lists the caller's transfers as sender or receiver, newest first, at most 100.
  - The holder sees `waiting` ones to send. The receiver sees `ready` ones to fetch.
- **The holder** (on reconcile, or when its app is open):
  - `POST /v1/transfers/:id/files` `{ files: [{ name, bytes, contentType }] }` → upload URLs, the same shape as release file uploads.
  - The bytes count against quota while stored.
  - It uploads, then `POST /v1/transfers/:id/ready`.
- **The receiver:**
  - `GET /v1/transfers/:id/files/:name` gives a signed 5-minute URL.
  - It writes the file into place, then `POST /v1/transfers/:id/delivered`.
  - The server deletes the blobs after the response (`after()`) and frees the quota.
- **Clean-up:** `DELETE /v1/transfers/:id` cancels, from either side. The daily cron deletes blobs of transfers that are
  undelivered after 7 days and marks them `failed`.
- **Locally-made releases need no transfer.** Their audio is already stored by sync, so "Put it on this iPhone" for one of
  them is today's "Send to Spotify" from the stored files.
  - Transfers are only for adopted releases, whose audio never syncs.
- **Security:**
  - Every route is scoped to the account and in the cross-user matrix.
  - A device can only upload to a transfer it is `fromDeviceId` of, and only fetch one it is `toDeviceId` of.
  - File names come from the release record, checked like release files.

### Records
- No change to the release record.
- `source: "adopted"` and `tracks[].localId` (#245) are what a second device matches on.

## iPhone (apps/ios)

- **localId:** a Swift port of the Mac's `spotify:local:` encoder (`+` for a space, percent-encoding otherwise, length in
  whole seconds). Both apps run shared fixtures in `spec/fixtures/local-id/`.
- **Scan:**
  - Inside `SpotifyFolder.withAccess`, enumerate the folder recursively.
  - Skip files Locally already tracks (its own releases' paths) and the whole `Locally/` folder: it holds Locally's own releases and delivered copies, which are linked on arrival.
  - Read tags with the existing ID3 and M4A readers.
  - Group exactly as the Mac does (#245 decision 4), one folder at a time.
  - Compute `localId`.
  - The scan runs on request ("Find music in your Spotify folder" in Settings) and once after onboarding. It never runs on every launch.
- **Review page:** the Mac's idea in the iPhone's look. Found releases (cover, title, artist, track count, folder) are all
  ticked, with "Already on your Mac" on any whose `localId`s match a synced release. Then Add.
- **Adopt:**
  - A new release is details-only and read-only, with file paths relative to the Spotify folder and its cover in Application Support.
  - It syncs with `source: "adopted"`, uploading only the cover.
  - A matched release links the local paths to the existing release id; no new record is created.
- **Guards:** every write path refuses an adopted release, as on the Mac.
- **Holdings:** after a scan, an import, a send, a delete or a delivery, the phone computes which releases it holds and `PUT`s them on the next reconcile.
- **Plays:** adopted releases play in Locally (#324) from their paths.

## Mac (apps/web)

- **Holdings:** library releases whose files are present, plus adopted releases whose files are readable, `PUT` on reconcile when the set changed.
- **Adopting on a second device:** when the Mac adopts a group whose `localId`s match a synced adopted release (the phone adopted
  it first), it links to that release id instead of creating one. This is the same rule as on the iPhone.
- **Transfers:**
  - As the holder: upload a waiting transfer's files from the adopted paths (read-only), then mark it ready.
  - As the receiver ("Put it on this Mac"): write into the library folder under the normal `ReleaseLayout`, then link it.

## The devices line and panel (both apps)

- **The line,** under the release header, and as a small glyph on library rows:
  - one holder: "On {device name}";
  - several: a short form (the variants below);
  - none reported: no line.
- **The short form for several devices** goes to the owner as variants with screenshots:
  - (a) the device icons side by side;
  - (b) "On iPhone and Mac" (kinds, not names);
  - (c) "On {this device} and 1 more".
- **The panel:**
  - **iPhone:** it rises from the bottom over the lower part of the screen, translucent, blending into the page (no hard box, no backdrop dim).
  - **Mac:** it rises from the bottom of the release pane.
  - **Contents:** each device holding the release, with its icon (iPhone, Mac, web) and name, and "Some tracks" when partial.
  - When this device doesn't hold it, a "Put it on this iPhone" / "Put it on this Mac" button, with the transfer's state shown in place: "Waiting for your Mac to be online", "Sending…", "Added".
  - **Closing:** a swipe down or a tap on the handle (iPhone); Escape, a click outside or the handle (Mac). Reduce Motion gets a fade.
- **Accessibility:** the line is a button with the full list in its label ("On Toby's iPhone and Toby's MacBook Pro"), the
  panel is a labelled region, and focus moves into it and back.

## Standalone audit (every action that needs the other device today)

| Action | Today | After this plan |
| --- | --- | --- |
| Adopt the Spotify folder | Mac only | both (this plan) |
| Play a track | none | both (#324) |
| Count plays while Locally plays | Mac only | both (#324) |
| Count Spotify plays with no Mac running | the online sampler, linked from Mac Settings | **also linkable from iPhone Settings** (step 7, below) |
| Playlists a track is in (#212) | Mac only (Spotify connection on the Mac) | later: the same read through the online link |
| Edit adopted files in place (#285) | Mac plan | iPhone later, once #285 lands |
| Import, edit, share, Stats | both | both |
| Sign up | closed (#36, #58) | unchanged, a launch item |

## Rollout (each an issue with a session brief)

1. **Shared `localId` fixtures, and the iPhone encoder.** Both apps pass the same cases.
2. **API: holdings.** The table, the routes, the spec, the cross-user matrix. It ships an additive migration, so the owner reviews it.
3. **iPhone: scan, review page, adopt, link by `localId`, holdings report.** Blocked by 1 and 2.
4. **Mac: holdings report, and the link-on-adopt rule.** Blocked by 2.
5. **Both: the devices line and panel.** Design first: the variants go to the owner, then Codex reviews. Blocked by 3 and 4.
6. **API and both apps: transfers.** The API routes and migration (the owner reviews them), the Mac as holder and receiver,
   and the iPhone as receiver and holder. Blocked by 5.
7. **iPhone: link Spotify for online play counting from Settings** (`ASWebAuthenticationSession` against the existing
   `/v1/spotify/link`). Independent.

## Tests

- **localId:** shared fixtures cover spaces, `+`, unicode, an empty album, and length rounding.
- **API:** holdings replace and read-back, ignored foreign or tombstoned ids, the cross-user 404s, the transfer state
  machine with its sender and receiver checks, quota while stored, deletion after delivery, and the 7-day clean-up.
- **iPhone:** the scan skips Locally's own paths, grouping matches the Mac's fixtures, adoption is read-only, a second-device
  match links instead of duplicating, holdings are computed, and a delivered file lands in `Locally/From your Mac/` inside the folder.
- **Mac:** link-on-adopt, holdings, and a transfer upload read from adopted paths without writing to them.
