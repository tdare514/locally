# Stream tracking: Spotify plays of Locally tracks, per device, with a total (#102)

## Summary

Count how many times each Locally track is played in Spotify and show it per device in both apps:
"This Mac 12 · iPhone 14 7 · Total 19". Spotify keeps no usable count for local files, so Locally
counts plays itself.

- **Mac (works today):** the Mac app reads what Spotify is playing through Spotify's AppleScript
  dictionary every few seconds and counts a play once a Locally track has played for 30 seconds.
  The app keeps running after its window closes so counting continues.
- **Sync:** each device pushes its own absolute per-track counts. The server keeps the highest
  value it has seen per device and track, so a push can be retried or arrive late without double
  counting. The total is the sum over devices.
- **iPhone:** iOS gives no app access to another app's playback in the background. A spike tests
  whether Spotify's Web API reports local files played on the phone. Only if it does does a follow-up
  plan add a server-side source for phone plays. Until then the iPhone shows counts but adds none.

## Findings this plan rests on (11 Oct 2026)

- `osascript` against Spotify 1.x on macOS returned, for a Locally track that was playing:
  `player state` = `playing`, `player position` = `29.17` (seconds),
  `id` = `spotify:local:Destroy+Lonely:%3C%2F3+%28Unreleased%29:l8r+dude:128`, `name`, `artist`,
  `album`, `duration` = `128832` (**milliseconds**, although `Spotify.sdef` says seconds), and
  `played count` = `0` (not usable).
- The local id is `spotify:local:<artist>:<album>:<title>:<seconds>`; each segment is URL-encoded
  with `+` for a space, and empty tags give empty segments (`spotify:local:::Title:200`).
- stats.fm filters out local files ("Spotify doesn't provide any info about these"); a third-party
  write-up says Spotify never logs local-file plays server-side, so the data export won't have them.
- Spotify Web API since February 2026: a development-mode app needs an owner with Premium, allows
  at most 5 users and one client ID per developer; extended quota needs a registered organisation
  with 250k monthly users. Recently-played reportedly skips local files. Whether `/me/player`
  returns local files is untested (the spike answers it).
- `tell application "Spotify"` launches Spotify when it isn't running. The tracker must check first.
- Spotify caches local-file metadata (STATUS.md known issue), so after an edit it can keep
  reporting the old tags until it restarts. Such plays don't match a Locally track and are not
  counted. Accepted limitation.

## Owner decisions

Recommended options first; the plan below assumes them. Approving this plan's PR approves them.

1. **Background:** Locally stays running after its window closes (normal Mac behaviour, reopened
   from the Dock) and gets an "Open at Login" item in the app menu. Rejected alternative: a separate
   launch agent, which would need its own copy of the library lookup and sync client.
2. **What the server stores:** per-device, per-track play counts only. No timestamps, no play
   events, no catalog (non-Locally) tracks. Rejected alternative: play events with times, which
   would allow listening history charts but is more personal data to hold and delete.
3. **Opt-in, offered at onboarding:** counting is off until the user turns it on. The Mac app asks
   once, with a "Count your Spotify plays?" card in the empty-library onboarding (and once on the
   library home for people who already have a library); Settings keeps the toggle. Turning it on
   runs the first check, which makes macOS ask "Locally wants to control Spotify". The iPhone
   onboarding gets no step while the phone can't count (owner request, 11 Oct; #110).
4. **Signing (#70):** until the app is Developer ID signed, every new unsigned build can ask for
   that permission again, because macOS ties it to the app's signature. Accept that for developer
   builds; don't offer tracking to other people before #70.

## Contract change (`spec/sync.md`)

Additive. The release record and `syncVersion` do not change, so shipped clients are unaffected.
Add a "Play counts" section and two rows to the API table:

| Method and path | Body / query | Returns |
| --- | --- | --- |
| PUT `/v1/plays` | `{ counts: [{ releaseId, trackId, count }] }`, 1 to 500 entries | `{ accepted, ignored }` |
| GET `/v1/releases/:id/plays` | | `{ tracks: [{ trackId, total, devices: [{ deviceId, name, platform, count, current }] }] }` |

Rules:

- `count` is this device's absolute lifetime count for that track: an integer from 0 to 1,000,000.
  The server stores `max(stored, sent)` per (device, track), so a retried, repeated or out-of-order
  push never double counts and a count never goes down.
- The device is always the token's device. A body never names a device or user.
- An entry whose `releaseId` is not a live (non-tombstoned) release of this user is ignored and
  counted in `ignored`; the rest of the batch is applied. `releaseId` and `trackId` are UUIDs
  (`uuidSchema` in `src/shared/types.ts`, as for release and track ids); `trackId` is not checked
  against the record's tracks.
- GET returns 404 for a release that isn't the user's (same as every release route) and an empty
  `tracks` list for a release with no plays. `current` is true for the requesting device. Devices
  are listed with their stored name and platform even when revoked, because their plays still
  count. `total` is the sum over all devices.
- Fixtures: `spec/fixtures/plays/valid-*.json` and `invalid-*.json` for the PUT body (a separate
  folder, because readers of `spec/fixtures/sync/` parse every file there as a release record).
  The API and the web client test them.

## API (`apps/api`)

- **Table `play_counts`:** `user_id`, `device_id`, `release_id`, `track_id`, `count` (integer),
  `updated_at`. Primary key (`device_id`, `track_id`); index (`user_id`, `release_id`). Migration
  through `npm run db:generate`.
- **`PlaysService`** in `src/server/plays/`: `push(userId, deviceId, counts)` and
  `forRelease(userId, releaseId, requestingDeviceId)`. One `db.batch` per push: upsert with
  `ON CONFLICT (device_id, track_id) DO UPDATE SET count = max(count, excluded.count)`, guarded so
  only live releases of `userId` are written (ownership check in the same statement's `WHERE`, or
  read-then-write inside the batch with the precondition repeated).
- **Routes:** `src/app/v1/plays/route.ts` (PUT) and `src/app/v1/releases/[id]/plays/route.ts`
  (GET). zod schemas in `src/shared/`. Existing 1 MiB body cap applies.
- **Account deletion:** `AccountService.deleteAccount` deletes the user's `play_counts` rows in its
  existing transaction.
- **Tombstones:** play counts for a tombstoned release are not served (GET 404s like the release)
  and the daily cleanup deletes them, alongside the tombstoned files. Upsert and tombstone paths are
  not changed.
- **Tests:** max-merge (push 5, then 3: stored 5); idempotent re-push; batch with a foreign, a
  tombstoned and an unknown release reports them in `ignored` and applies the rest; the cross-user
  matrix (#33) gets both routes (another account sees 404 on GET and can't write to a release it
  doesn't own); account deletion removes plays; cleanup removes plays of tombstoned releases;
  fixtures parse or are refused.

## Mac tracker (`apps/web`)

All new code under `src/server/plays/`, behind interfaces with fakes, like the rest of the server.

- **`SpotifyNowPlaying`** (interface) and **`OsascriptNowPlaying`** (impl). One `execFile` of
  `/usr/bin/osascript -l JavaScript -e <fixed script>` with an argument array, no user input in the
  script. The script checks `Application("Spotify").running()` first and returns JSON:
  `{ running:false }` or `{ running:true, state, positionSec, id, durationMs }`. A JXA reference to
  Spotify does not launch it; verify by quitting Spotify and polling: Spotify must stay closed.
  Error `-1743` (not authorised to send Apple events) maps to a `permission-denied` status.
- **`PlayCounter`** (pure, no I/O). Input: samples `{ at, running, state, id, positionSec, durationMs }`.
  Rules:
  - Only ids starting `spotify:local:` count; anything else resets the session and is never stored.
  - A session is one continuous play of one id. A new session starts when the id changes, or when
    the position goes back by more than 3 seconds (repeat, replay, seek back).
  - While `state` is `playing`, listened time grows by the position delta since the previous sample,
    but only when `0 < delta <= wall-clock gap + 2s`; a forward seek adds nothing.
    Paused, stopped or not-running samples add nothing and break the wall-clock chain.
  - A session counts once, when listened time reaches `min(30, 0.9 × duration)` seconds.
- **`LocalTrackResolver`** (pure): decodes the id (split after `spotify:local:` into artist,
  album, title, seconds; per segment replace `+` with a space, then `decodeURIComponent`) and finds
  the Locally track whose tags match, per `spec/metadata.md`: `album` = release title, `artist` =
  the track's artist when it overrides, else the release artist, `title` = track title, and
  `|durationSec - seconds| <= 2` when `durationSec` is known. Compare after NFC normalisation and
  trimming. Exactly one match counts; none is ignored (not a Locally track); several are ignored
  and logged once.
- **`PlayCountStore`** (interface) and **`FilePlayCountStore`**: `plays.json` next to
  `settings.json`, zod-validated, atomic write, owner-only mode, like `FileSyncStateStore`. Shape:
  `{ version: 1, tracks: { [trackId]: { releaseId, count, pushed } } }`. A local release delete
  removes its tracks' entries.
- **`PlayTracker`**: polls every 5 seconds while the "Count my Spotify plays" setting is on,
  feeds samples to `PlayCounter`, resolves counted ids at count time against the current library
  (so later edits don't orphan the count) and increments the store. Started from `container.ts`
  like `syncEngine.startPolling()`; a settings change starts or stops it. Timer `unref`ed.
- **Settings:** `trackPlays: boolean` (default `false`) through `SettingsStore`, `settingsUpdate.ts`
  and `settingsView.ts`; a toggle in the Settings UI with one line of explanation. Status
  (`off`, `on`, `spotify-not-running`, `permission-denied`) comes back from a new local
  `GET /api/plays/status`. Permission denied shows: "Locally isn't allowed to see what Spotify is
  playing. Allow it in System Settings ▸ Privacy & Security ▸ Automation."
- **Connect playback guard:** depends on the spike. If the Mac's AppleScript reports a track that
  is actually playing on another device, the tracker must not count it as this Mac's. If no signal
  can tell the two apart, document the limitation in the Settings line.

## Mac sync and display (`apps/web`)

- `SyncApi` gains `pushPlays(counts)` and `releasePlays(releaseId)`. `SyncEngine.reconcile`
  pushes every entry whose `count > pushed`, at most 500 per request, and records `pushed` on
  success. Failures leave entries pending for the next reconcile (offline, signed out, 5xx),
  so a Mac that was offline catches up when it is back.
- Local `GET /api/plays?releaseId=` returns the merged view for the release page: other devices
  from the server, this Mac as `max(local count, server count for this device)`, total as the sum.
  Signed out: this Mac only.
- Release page: each track shows its total; a disclosure or popover lists the per-device counts
  ("This Mac 12", "iPhone 14 7"). Nothing shown while tracking was never on and no device has plays.
- Sign-out and account deletion clear `pushed` markers (counts stay local), so a new account
  receives them on the next reconcile, matching the existing per-release sync markers (#34).

## Background running (`apps/web/electron`)

- `window-all-closed` no longer quits; `activate` (Dock click) reopens the window; ⌘Q quits.
- App menu gets an "Open at Login" checkbox backed by `app.setLoginItemSettings`. When the app was
  opened at login (`app.getLoginItemSettings().wasOpenedAtLogin`), it starts without a window.
  Check the behaviour against the installed Electron version's docs.
- Services are built lazily on the first request. After `waitForServer`, `main` makes one
  `GET /api/sync/status` request so the sync timer and the play tracker start even with no window.
- `electron-builder.yml` `mac.extendInfo` adds `NSAppleEventsUsageDescription`:
  "Locally reads what Spotify is playing to count plays of your tracks."
- No new place to write; the server keeps `HOSTNAME=127.0.0.1` (ADR 0003).

## iPhone display (`apps/ios`)

- `SyncApi` gains `releasePlays(releaseId:)`; the release view fetches it when signed in and shows
  each track's total with a per-device breakdown. Offline or signed out: nothing shown. Strings in
  `Resources/Copy.swift`. The phone adds no counts in this plan.

## iPhone counting (spike, then maybe a follow-up plan)

The spike answers two questions with observed responses:

1. With Spotify open on the Mac and a Locally track playing on the iPhone, what does the Mac's
   AppleScript report? (Decides the Connect playback guard above.)
2. Do `GET /me/player` and `GET /me/player/currently-playing` return a local file played on the
   iPhone, with `is_local`, its `spotify:local:` uri, `progress_ms` and `device.type`? Does
   recently-played include it?

If (2) works, a follow-up plan adds a server-side poller that counts plays on non-Mac devices
only, so the Mac's plays aren't counted twice. It needs the owner's Spotify developer app and is
limited to 5 users in development mode, which makes it a personal feature, not a product one,
unless the app gets extended quota.

## Security and privacy

- AppleScript runs a fixed script through `execFile` with an argument array; nothing from Spotify
  or the user is put into the script (global invariant: no shell strings).
- The tracker reads only the current track and stores only counts for tracks in the Locally
  library. Other listening is never written anywhere.
- Server: device from the token only; every query scoped by `userId`; release ownership checked on
  write; counts capped; account deletion and tombstone cleanup remove plays.
- `plays.json` is owner-only, like the other config files.
- The privacy text (#36) must state that play counts per device are stored when the user turns
  counting on and signs in, and are deleted with the account.

## Work units

| Unit | Issue | Depends on | Touches |
| --- | --- | --- | --- |
| Spike: what Spotify reports for iPhone plays | #103 | nothing | `docs/research/stream-tracking.md` |
| API: play counts contract and endpoints | #104 | plan approved | `spec/sync.md`, `spec/fixtures/plays/`, `apps/api/**` |
| Mac app: background running and Open at Login | #105 | plan approved | `apps/web/electron/**`, `apps/web/electron-builder.yml` |
| Mac app: play tracker | #106 | plan approved, #103 question 1 | `apps/web/src/server/plays/**`, settings, `container.ts` |
| Mac app: push counts, per-device breakdown | #107 | #104, #106 | `apps/web/src/server/sync/**`, release page |
| Mac app: offer counting once at onboarding | #110 | #106 | `LibraryView.tsx`, settings flag |
| iPhone: show per-device counts | #108 | #104 | `apps/ios/**` |

#103, #104 and #105 can run in parallel. Every unit updates `STATUS.md`, so stage it explicitly
and expect to rebase that file.
