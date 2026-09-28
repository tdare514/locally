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
devices, and both apps re-tag in place).

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

- `valid-*`: every app parses it.
- `invalid-*`: every app rejects it (the API with a 400, clients before using any file name).
- `invalid-api-*`: the API rejects it. Clients only ever receive records the API accepted, so
  their parsers are not required to reject these (today they don't check file extensions).

Any change to the record, or to what a reader accepts, updates the fixtures in the same change,
so that a record defined differently in one app fails that app's tests instead of failing a
sync at runtime.

## API (`apps/api`, JSON, `Authorization: Bearer <device token>` except auth)

| Method and path | Body / query | Returns |
| --- | --- | --- |
| POST `/v1/auth/code` | `{ email }` | `{ ok: true }`; sends a six-digit code, valid 10 minutes, 5 tries |
| POST `/v1/auth/verify` | `{ email, code, deviceName, platform: "mac" \| "ios" }` | `{ token, user: { id, email }, device: { id, name } }` |
| GET `/v1/me` | | `{ user, device, quota: { usedBytes, limitBytes }, devices: [...] }` |
| DELETE `/v1/devices/:id` | | revokes that device's token |
| GET `/v1/releases?sinceVersion=N` | | `{ releases: [record + version], nextVersion }` (tombstones included) |
| PUT `/v1/releases/:id` | the record (at most 500 tracks) | `{ version }`; 409 if the stored `updatedAt` is newer; stored files the record no longer references are deleted |
| DELETE `/v1/releases/:id` | | tombstone; `{ version }` |
| POST `/v1/releases/:id/files` | `{ files: [{ name, bytes, contentType }] }` | `{ uploads: [{ name, url, method, headers }] }`; enforces quota, 200 MB per file, and that `contentType` matches the name's extension |
| GET `/v1/releases/:id/files/:name` | | `{ url, expiresAt }` download URL |

Rules: every path is scoped to the token's user; a release id belongs to the user that first
wrote it; tombstones keep their files for 30 days then a cron deletes the objects; codes and
tokens are stored hashed; auth endpoints are rate-limited per email and per IP; JSON request
bodies are capped at 1 MiB (400 when exceeded).

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
  the other platform → offered in the inbox as "N from your Mac / phone" with one action, Send to
  Spotify, which downloads the files into the local Spotify folder (unique names, no
  conversion or tagging; the Mac converts m4a from the phone to mp3 because Spotify desktop
  reads mp3), stores the cover and records the release with the same id. Newer `updatedAt` than
  the local copy → re-tag in place from the record and update the index; if its `coverHash`
  differs from the local cover's, download the cover first and embed the new bytes in every
  track (a cover that cannot be downloaded yet leaves the release pending for the next
  reconcile, like a track). Tombstone → delete locally. Local releases never pushed → push (back-fill after signing in).
- **Conflicts**: last writer wins by `updatedAt`; a `409` from `PUT` means pull first, then
  re-apply the local change on top if it is still wanted. A `PUT` whose `updatedAt` equals the
  stored one is accepted (it bumps the version), so a client can re-send the same record to
  finish a push whose file uploads failed.

## Not in this phase

- Playlists (Spotify has no API for local files).
- Merging libraries that existed on both devices before sign-in: each side's releases are
  pushed as they are, so a song tagged twice is two releases. Settings says so.
- Sharing between accounts, web playback, and anything that needs a paid developer account.
