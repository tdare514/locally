# Sync between the Mac app and the iOS app

Decided 27 Sep 2026 (revised the same day): a small hosted sync service with accounts, run by
us. The first draft used a shared iCloud Drive folder; it was dropped because customers cannot
be assumed to pay for iCloud storage. The record shape and the reconcile rules from that draft
carry over unchanged; only the transport is different.

## Shape of the system

```
apps/api      the sync service: accounts, release records, file storage. Deployed on Vercel.
apps/web      the Mac app: signs in, pushes what it tags, pulls what the phone tagged.
apps/ios      the phone app: same, the other way round.
```

- **Accounts** are email plus a six-digit code sent by email. No passwords, no third-party
  identity provider (Sign in with Apple needs a paid developer account; this works on a free
  team and on the web). A successful code exchange returns a **device token**; each
  device has its own, revocable from the account. A token unused for a year expires and
  returns 401 like a revoked one; the client signs in again with a new email code (the account
  itself never expires or locks). `lastSeenAt` is refreshed at most
  once a day, so it is accurate to the day.
- **Release records** are the `release.json` document below, stored per user with a version
  number. Last writer wins by `updatedAt`.
- **Files** (tracks, covers) are stored in private object storage. Clients upload directly to
  storage with a short-lived upload URL from the API, and download with a short-lived download
  URL, so audio never passes through the API function (Vercel functions cap request bodies at
  4.5 MB).
- **Quotas**: every account gets 1 GB of storage free. Paid plans raise it later; the limit is
  a per-user number in the database, nothing more, so the purchase work can flip it.

## Record

Identical to the shared metadata model plus sync fields. `tracks[].file` names the stored
object; the name never changes after upload (Spotify playlists depend on file names on both
devices, and both apps re-tag in place). `tracks[].file` and `cover` end in one of `mp3`,
`m4a`, `jpg`, `jpeg`, `png` (case-insensitive: the name's last `.`-suffix, compared in lower
case). The API refuses any other name with a 400. Both clients skip such a record when it arrives
in a `GET /v1/releases` page (the rest of the page is still applied and the cursor advances past
it), and never use any file name in it; a structurally broken record, such as one missing a field,
still fails the whole page.

```json
{
  "syncVersion": 2,
  "id": "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90",
  "kind": "album",
  "title": "Night Drive",
  "artist": "Chromatics",
  "year": "2024",
  "genre": null,
  "cover": "cover.jpg",
  "coverHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "tracks": [
    { "id": "…", "title": "Intro", "trackNumber": 1, "file": "01 - Intro.mp3", "bytes": 5120000, "durationSec": 61.2 }
  ],
  "origin": "mac" | "ios",
  "originDevice": "Toby's MacBook",
  "createdAt": "2026-09-27T20:00:00Z",
  "updatedAt": "2026-09-27T20:00:00Z",
  "deleted": false
}
```

`origin` names the platform that wrote the record: `"mac"` or `"ios"` today. **Forward compatibility
(#185):** a client MUST treat any `origin` it doesn't recognise, and any device `platform` it doesn't
recognise (in `/v1/me`, the plays reply), as "another device". Such a record is offered in the inbox
labelled "from another device" (a known one gets its own label: "from your iPhone", "from your Mac",
"from the web"), a device shows as a generic "Device" with its name, and neither is ever a reason to
fail a pull page. A record is a client's own only when `origin` is that client's platform and
`originDevice` is that client's device name. On the wire `origin` is a short lowercase token
(`^[a-z][a-z0-9-]{0,15}$`). The API accepts only `mac` and `ios` for `origin` and `platform` until #186
adds `web`, so shipped clients are tolerant before any such record can exist.

A `tracks[]` entry may carry `discNumber` (integer 1 to 99) on a multi-disc release. The key is omitted
when there is no disc, never written as null. `trackNumber` is still the release-wide position and the
file key; `discNumber` only changes the tags a receiver writes (`spec/metadata.md`). Older clients ignore
the key, and a client that does not know it strips it when it re-pushes a record; that is accepted because
only the owner's own devices sync and they update together.

`coverHash` is the lowercase hex sha256 of the cover's bytes, or `null` when the release has no
cover. It is the only change signal for the cover, since `cover.<ext>` keeps its name when the
image is replaced: a receiver downloads and re-embeds the cover only when the remote `coverHash`
differs from the hash of the cover it already has. `syncVersion` 1 records (from a client that
predates the field) carry no `coverHash` key at all; every receiver treats that as "no signal" and
leaves its cover alone, exactly as before. Servers and clients accept both versions.

Server-side each record also carries `userId`, `version` (integer, bumped on every write) and
`serverUpdatedAt`; clients page by `version`.

### Fixtures

`spec/fixtures/sync/*.json` are example records that the API, web and iOS tests all load. The
file name prefix says what every reader must do with it:

- `valid-*`: every app parses it. Two exceptions are client-only until #186: `valid-album-origin-web.json`
  and `valid-single-origin-unknown.json` (origin `"web"` and `"future-thing"`), which the Mac and the
  iPhone must accept and the API must still reject with a 400.
- `invalid-*`: every app rejects it (the API with a 400; clients skip a record with a refused
  name and fail the page on a structurally broken one, without ever using a file name from it).

Any change to the record, or to what a reader accepts, updates the fixtures in the same change,
so that a record defined differently in one app fails that app's tests instead of failing a
sync at runtime.

## API (`apps/api`, JSON, `Authorization: Bearer <device token>` except auth)

| Method and path | Body / query | Returns |
| --- | --- | --- |
| POST `/v1/auth/code` | `{ email }` | `{ ok: true }`; sends a six-digit code, valid 10 minutes, 5 tries |
| POST `/v1/auth/verify` | `{ email, code, deviceName, platform: "mac" \| "ios" }` | `{ token, user: { id, email }, device: { id, name } }`; a new device, except that a Mac (`platform: "mac"`) whose account has a revoked (signed-out) Mac of the same `deviceName` gets that device's id back: the row is un-revoked and the new token replaces the old one, which stops working, so a Mac that signs out and back in keeps one device and its play counts are not summed twice (#175). With several such rows the most recently seen is taken; an active Mac of the same name and every iPhone are never reused, and another account's devices are never touched. A code works once, even for two simultaneous requests |
| GET `/v1/me` | | `{ user, device, quota: { usedBytes, limitBytes }, devices: [...], devicesHasMore, resyncRequestedAt }`; `devices` holds at most the 50 most recently created devices (newest first); `devicesHasMore` is true when older ones were left out; `resyncRequestedAt` is the ISO time of the account's last `POST /v1/files/resync-request`, or `null` if it never made one |
| DELETE `/v1/devices/:id` | | revokes that device's token |
| DELETE `/v1/me` | `{ email }` (must match the account) | `{ ok: true }`; deletes the account, its devices, releases and files; blobs are removed by the cleanup cron within a day; every device token becomes invalid |
| GET `/v1/releases?sinceVersion=N&limit=N` | `limit` (optional, integer, 1 to 200; above 200 clamps to 200, below 1 or non-integer is a 400 like a bad `sinceVersion`; default 200) | `{ releases: [record + version], nextVersion, hasMore }` (tombstones included). Releases come back in ascending `version` order, at most `limit` of them, and the page stops early once its serialized records reach 2 MiB; a page always holds at least one release when any exist (a single record is at most 1 MiB by the PUT body cap, so one always fits under Vercel's 4.5 MB response limit). `hasMore: true` means more releases exist above the last one returned, and `nextVersion` is then the `version` of the last release in this page; `hasMore: false` means the page reached the end, and `nextVersion` is the user's counter, exactly as today (it can be above the last row's version, because a rewritten release moves to a new version and its old number disappears). In both cases `nextVersion` is the value to send as `sinceVersion` next, and it never runs ahead of a release this response left out (the #28 invariant). |
| PUT `/v1/releases/:id` | the record (at most 500 tracks) | `{ version }`; 409 if the stored `updatedAt` is newer; stored files the record no longer references are deleted |
| DELETE `/v1/releases/:id` | | tombstone; `{ version }` |
| POST `/v1/releases/:id/files` | `{ files: [{ name, bytes, contentType }] }` | `{ uploads: [{ name, url, method, headers }] }`; enforces quota, 200 MB per file, and that `contentType` matches the name's extension |
| GET `/v1/releases/:id/files/:name` | | `{ url, expiresAt }` download URL |
| GET `/v1/files/missing` | | `{ releases: [{ id, missing: [names], recordUpdatedAt }], checkedAt, truncated? }`; the caller's live releases with files that are not stored; `truncated` is `true` only when a cap cut the check short; see "Missing files" |
| POST `/v1/files/resync-request` | none | `{ resyncRequestedAt }` (ISO); records that this account asked its devices to re-send files; see "Missing files" |
| PUT `/v1/plays` | `{ counts: [{ releaseId, trackId, count, days?: [{ day, count }] }] }`, 1 to 500 entries | `{ accepted, ignored }`; see "Play counts" |
| GET `/v1/releases/:id/plays` | | `{ tracks: [{ trackId, total, devices: [{ deviceId, name, platform, count, current }] }] }`; 404 for a release that isn't the user's or is tombstoned |

Rules: every path is scoped to the token's user; a release id belongs to the user that first
wrote it; tombstones keep their files for 30 days then a cron deletes the objects; codes and
tokens are stored hashed; auth endpoints are rate-limited per email and per IP; the two missing-files routes are rate-limited
device (6 an hour each) and per user (24 an hour each), 429 beyond; JSON request
bodies are capped at 1 MiB (400 when exceeded). The daily cron (`GET /v1/internal/cleanup`) also
drains `pending_deletes` (blobs of deleted accounts), oldest first.

## Play counts

Per-device play counts for a release's tracks, so a client can show how often each track was
played and on which device. Additive: the release record and `syncVersion` do not change, and
the shipped web and iOS clients are unaffected. The Mac app pushing and displaying counts is
#107; the iPhone display is #108.

- `count` is this device's absolute lifetime count for that track: an integer from 0 to
  1,000,000. The server stores `max(stored, sent)` per (device, track), so a retried, repeated
  or out-of-order push never double counts and a count never goes down.
- The device is always the token's device. A body never names a device or user (a body with an
  unknown key, such as `deviceId`, is a 400).
- An entry whose `releaseId` is not a live (non-tombstoned) release of this user is ignored and
  counted in `ignored`; the rest of the batch is applied. `accepted` is the number of entries
  applied. `releaseId` and `trackId` are UUIDs, as for release and track ids; `trackId` is not
  checked against the record's tracks.
- GET returns 404 for a release that isn't the user's or is tombstoned (same as every release
  route) and an empty `tracks` list for a release with no plays. `current` is true for the
  requesting device. Devices are listed with their stored name and platform even when revoked,
  because their plays still count. `total` is the sum over all devices.
- Play counts of a tombstoned release are never served and are deleted by the daily cleanup,
  on the same 30-day schedule as the release's files; deleting the account deletes them at once.
- **Day buckets (#193, #201).** An entry may carry an optional `days: [{ day, count }]`: this
  device's absolute count for that track on one calendar day. `day` is the client's local date as
  a strict `YYYY-MM-DD` that is a real date (2026-02-30 is a 400); the server never converts it.
  `count` is an integer from 0 to 1,000,000. The server stores `max(stored, sent)` per
  (device, track, day), the same rule as `count`, so pushes stay absolute and idempotent. Limits:
  at most 400 days per entry, no duplicate day within an entry, at most 2,000 day rows per
  request (a client with more splits them across requests); any breach, a malformed day, or a day later than tomorrow (server UTC date + 1, for clock skew)
  is a 400 and nothing is applied. A day more than 400 days before the server's UTC date is
  silently dropped (not stored, not an error), so a client at the edge of its own window is never
  refused. Days of an entry whose release isn't a live release of this user are ignored with the
  entry. Entries without `days` behave exactly as before; old clients send none and are
  unaffected, and their plays count toward all-time only.
- **`GET /v1/plays/summary?from=YYYY-MM-DD&to=YYYY-MM-DD[&cursor=<trackId>]`.** Device-token auth,
  scoped to the caller's user and their live (non-tombstoned) releases. Both dates are real
  dates, `from <= to`, at most 400 days inclusive, and `to` is no later than tomorrow (UTC);
  anything else is a 400. Rate limit 60 requests per hour per user (429). Response:
  `{ tracks: [{ trackId, releaseId, plays, devicePlays, lastPlayedDay }], allTime: [{ trackId, releaseId, plays, devicePlays }], nextCursor }`.
  `tracks` sums the day buckets in the range over all the user's devices (revoked ones too);
  `lastPlayedDay` is the latest such day with a count above 0; tracks with no plays in the range
  are left out. `allTime` sums `play_counts` over all devices. Paged by track id over tracks that
  have a count row on a live release or a day in the range on a live release: 1,000 track ids per page, ordered by `trackId`, both lists covering the same
  page; `nextCursor` is the last `trackId` of the page when more follow (pass it as `cursor`),
  else null.
- **`devicePlays` (#216).** Every entry of both lists carries `devicePlays`, an integer >= 0: the
  caller's own share of `plays`, computed in the same query (the token's device's day buckets in
  the range, and that device's `play_counts`). Other devices of the user, including the caller's
  own revoked ones, count toward `plays` only. The field is additive. Effect per client:
  - **Mac:** subtracts its own share exactly (`local + max(0, plays - devicePlays)`, for the range
    and for all time) in place of its pushed-marker estimate. An entry without `devicePlays`
    (an older service) keeps the marker rule.
  - **iPhone:** pushes no plays, so its `devicePlays` is 0; it reads `plays` as before.
  - **Shipped clients:** ignore it. The Mac's schema strips unknown keys and the iPhone's
    Decodable ignores them.
- **Retention.** Day buckets are kept 400 days: the daily cleanup deletes `play_days` rows more
  than 400 days before the UTC date, those of tombstoned releases on the 30-day schedule above,
  and account deletion removes them at once (a database trigger on the user row does too, so a
  rolled-back deploy can't leave them behind). All-time counts are kept.
- **Clients.** Shipped clients need no change. The Mac now pushes its changed days and merges the
  summary for other devices' plays (#202); the iPhone reads the summary later for its Stats page.
- Fixtures: `spec/fixtures/plays/valid-*.json` and `invalid-*.json` are example PUT bodies (a
  separate folder from `spec/fixtures/sync/`, whose readers parse every file as a release
  record). The API and the web client test them. Bodies with `days` are in
  `spec/fixtures/plays-days/`: the API and the web client (#202) both test them, so a shipped Mac's
  strict schema isn't asked to accept a field it doesn't know.

## Missing files

For a release whose record reached the server but whose audio or cover did not (an upload that
never finished). Additive: no record or `syncVersion` change, and shipped clients never call either
route. Plan: `docs/plans/119-missing-files.md`.

- `GET /v1/files/missing` covers the caller's live releases only; tombstones are never read. For
  each it checks every `tracks[].file`, plus the record's `cover` name when the record has a
  `coverHash` (a `syncVersion` 1 record has none, so its cover is not checked).
- A name is stored only when a `files` row exists and the object is in storage. A row is written
  when an upload URL is issued, not when the upload finishes, so a row alone proves nothing. The
  server reads every live release with its file rows in one query, then pages once through the
  account's own storage prefix (`users/<userId>/releases/`, about 1000 objects a page). It never
  makes a request per file.
- `releases` holds only releases with at least one name not stored, so a healthy account gets
  `{ "releases": [], "checkedAt": "..." }`. `missing` lists the names in record order, each once.
  `recordUpdatedAt` is the record's own `updatedAt`, so a client can tell which version was
  checked. `checkedAt` is the server time the check started. The response holds file names only,
  never signed URLs.
- The check is bounded. It considers at most 2000 live releases (the most recently written first,
  by `version`) and reads at most 50,000 keys (50 pages) of the listing. When either cap is hit the
  response carries `"truncated": true` (the field is absent otherwise) and the list may be
  incomplete: releases past the cap are not checked, and a name that has a `files` row but was not
  reached by the cut-short listing is left out rather than reported missing, because a partial
  listing cannot show a blob is absent. A name with no `files` row is still reported. A client
  treats `truncated` as informational and may ignore it; an old client never sees it.
- `POST /v1/files/resync-request` takes no body and sets `resyncRequestedAt` on the account to the
  server time. The server contacts no device: a device that sees `GET /v1/me` return a
  `resyncRequestedAt` newer than its last check runs that check now.
- Each route is limited to 6 calls an hour per device, so one device that polls cannot use up the
  others' allowance, and to 24 calls an hour per user across all its devices. A call a device is
  refused for its own limit does not count against the user's 24. Each route is counted on its own.
  A storage listing is a priced call, and this is a repair path.
- Effect on clients: `apps/web` and `apps/ios` keep working unchanged. Neither calls the routes,
  and both ignore the new `/v1/me` field (iOS decodes `/v1/me` into a struct that names only
  `user.email`, `device`, and `quota`; web reads the JSON without a strict schema). The iPhone
  self-heal and the Mac "Waiting on your phone" state are the plan's steps 2 and 3.

## Storage and providers

Behind interfaces so local development needs no accounts:

| Concern | Interface | Local (dev, tests) | Production |
| --- | --- | --- | --- |
| Database | Drizzle ORM over libSQL | a SQLite file | Turso (libSQL), provisioned through the Vercel Marketplace |
| Files | `FileStore` | a folder on disk served by the API with signed paths | Vercel Blob, private, direct client uploads |
| Email | `Mailer` | prints the code to the API log | Resend through the Vercel Marketplace |

One dialect (libSQL) everywhere keeps the schema and tests identical between laptop and cloud.

## What each client does

Both clients keep the same local library they have today; the service is a mirror, not the
source of truth.

- **Sign in** (Settings): email → code → signed in as a device. Signing out revokes the device.
- **Push**: after a successful import, update, cover replace or delete: `PUT` the record first
  (`origin` = this platform; the API only issues upload URLs for a release it knows), then upload
  any new files direct to storage. A record can therefore be visible before its files have
  finished uploading: a client that cannot yet download a listed file leaves that release
  pending and retries on the next reconcile. Failures never fail the user's action.
- **Pull / reconcile** (on foreground, on a timer while the app is open, and on "Sync now"):
  `GET /releases?sinceVersion=<last seen>`. For each record: not in the local library and from
  another device (any `origin` but this platform's own) → offered in the "From your devices" inbox with one action, Send to
  Spotify, which downloads the files into the local Spotify folder (unique names, no
  conversion or tagging; the Mac converts m4a from the phone to mp3 because Spotify desktop
  reads mp3), stores the cover and records the release with the same id. Newer `updatedAt` than
  the local copy → re-tag in place from the record and update the index; if its `coverHash`
  differs from the local cover's, download the cover first and embed the new bytes in every
  track (a cover that cannot be downloaded yet leaves the release pending for the next
  reconcile, like a track). Tombstone → delete locally. Local releases never pushed → push (back-fill after signing in).
  Repeat the request with `sinceVersion = nextVersion` until `hasMore` is false, saving
  `nextVersion` after each page is applied.
- **Conflicts**: last writer wins by `updatedAt`; a `409` from `PUT` means pull first, then
  re-apply the local change on top if it is still wanted. A `PUT` whose `updatedAt` equals the
  stored one is accepted (it bumps the version), so a client can re-send the same record to
  finish a push whose file uploads failed.
- **Account deletion**: the deleting client calls `DELETE /v1/me`, then clears its own token,
  cursor and per-release sync markers exactly as sign-out does; local music files are never
  touched. Other devices learn about the deletion by receiving a 401 on their next reconcile.

## Not in this phase

- Playlists (Spotify has no API for local files).
- Merging libraries that existed on both devices before sign-in: each side's releases are
  pushed as they are, so a song tagged twice is two releases. Settings says so.
- Sharing between accounts, web playback, and anything that needs a paid developer account.
