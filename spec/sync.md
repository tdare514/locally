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
case). A file name (`tracks[].file`, `cover`) is a plain child name of at most 255 UTF-8 bytes (the
filesystem limit, counted in bytes, not characters). The list and the limit are in
`spec/sync-file-names.json`, and each app's tests assert its own constants equal it. The API
refuses any other name with a 400, except that a name over 255 bytes already stored on that release
is accepted again on a re-push of it (records saved before the byte limit, #87); a new over-long name
is refused. Both clients skip such a record when it arrives
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

A record may carry `releaseDate` (#221, `docs/plans/221-release-date.md`): the release date when it is more
precise than a year, `YYYY-MM` or `YYYY-MM-DD`, and a real calendar date (no month 13, no 30 February;
29 February only in a leap year). The key is omitted when only the year is known, never written as null or as
a bare year. When it is present, `year` is non-null and equals its first four characters, so a reader that
knows only `year` still has the right year:

```json
{ "year": "2024", "releaseDate": "2024-05-17" }
```

The API answers a 400 for any other shape, an impossible date, a `year` that disagrees, or a `releaseDate`
beside a null `year`, and stores and returns the key exactly. `syncVersion` stays 2. Effect on clients:
older clients ignore the key and show the year (and, as with `discNumber`, drop it if they re-push a record;
the date falls back to its year, accepted because only the owner's own devices sync and they update together).
The Mac adds it in step 2 of the plan and the iPhone in step 3. On pull, a client that can't parse a
`releaseDate`, or whose year disagrees with `year`, applies the record with `year` alone: the date is dropped,
the rest of the record is kept, and it is never a reason to skip a record or fail a page.

A record may carry `sharedFrom` (#328): this release was imported from a received share. Its shape is exactly
`{ "shareId": "<lowercase UUID>", "allowReshare": true|false }`, the share it came from and whether that share allows
resharing. The key is omitted on any other release, never written as null:

```json
{ "sharedFrom": { "shareId": "6f1c2a40-8d3e-4b7a-9c55-0e2f1a7b3d90", "allowReshare": false } }
```

The API answers a 400 for any other shape (a missing or extra key, a non-UUID or upper-case `shareId`, a non-boolean
`allowReshare`, null), and stores and returns the key exactly. `syncVersion` stays 2. Effect on clients: older clients
ignore the key (and drop it if they re-push a record, accepted because only the owner's own devices sync and they
update together). Clients set it when they import a claimed share.

A `tracks[]` entry may carry `localId` (#303): the `spotify:local:` id the Mac stored when it adopted the file,
a string that starts with `spotify:local:` and is at most 1,000 characters (anything else is a 400). The key is
omitted when there is none, never written as null, and only the Mac sends it, for adopted tracks. The sync
service matches a Spotify local-file play to the track by this id, part by part (NFC artist, album and title,
seconds within 2). **Clients MUST carry it through unchanged** when they re-push a record: the iPhone in #308
and the Mac in #307. Until they do, a client that drops it makes the server fall back to matching on the
release title, artist and track title and duration, so an edited title or a "feat." credit can miss. Older
servers strip the key (zod's default), and older clients ignore it.

A record may carry `source`: `"adopted"` for a release the Mac adopted in place from the owner's own
audio files (`docs/plans/245-adopt-local-files.md`, decision 6), or absent for Locally's own releases. The
key is omitted when absent, never written as null. An adopted release syncs details only: `tracks[].file`
is the file's own name and `bytes` its size, no upload rows are made for tracks, and only the cover is
uploaded. The API accepts only `"adopted"` for `source` and answers any other value with a 400 (the same
closed list as `origin` and `platform` today); the value is stored and returned exactly. Effect on
clients: older clients ignore the key (and, as with `discNumber`, drop it if they re-push a record; accepted,
because only the owner's own devices sync and they update together). The Mac handles it in #248 and the
iPhone in #250. A client that reads a `source` it doesn't recognise should treat the record as an ordinary
one and must not fail a pull page. The API rules: `GET /v1/files/missing` checks only the cover of an
adopted record, never its tracks; `POST /v1/releases/:id/files` for an adopted release accepts only the
record's cover name, and a track name (or any other name) is a 400.

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
  A bad `releaseDate` has no `invalid-*` fixture, because clients apply such a record with its year; the
  API's refusals are in its own tests.

Any change to the record, or to what a reader accepts, updates the fixtures in the same change,
so that a record defined differently in one app fails that app's tests instead of failing a
sync at runtime.

## API (`apps/api`, JSON, `Authorization: Bearer <device token>` except auth)

| Method and path | Body / query | Returns |
| --- | --- | --- |
| POST `/v1/auth/code` | `{ email }` | `{ ok: true }`; sends a six-digit code, valid 10 minutes, 5 tries |
| POST `/v1/auth/verify` | `{ email, code, deviceName, platform: "mac" \| "ios", installId? }` | `{ token, user: { id, email }, device: { id, name } }`; a new device unless an earlier row of the same account is revived (below). A code works once, even for two simultaneous requests. `installId` is an optional UUID that names one install (#210 for a Mac, #337 for an iPhone); a malformed one is a 400, and it is ignored for any other platform. Revival is one atomic UPDATE: the row gets the new token (the old one stops working at once), `revokedAt` is cleared, and it keeps or gains the `installId`. It never crosses users or platforms. The ID is a hint inside one account: another account's `installId` never matches anything. **Mac** (so a Mac that signs out and back in keeps one device and its play counts are not summed twice, #175, #210): only a revoked Mac is revived, in this order: the same `installId`; otherwise one with no stored `installId` and the same `deviceName` (rows made before the field); otherwise a new device. A Mac that sent no `installId` takes any revoked Mac of that name. A revoked Mac with a different stored `installId` is never taken by name, so two Macs that share a hostname keep separate devices. An active Mac is never taken over. **iPhone** (#337): revived by `installId` only, never by name, since many phones share a name such as "iPhone". It may take over its own row for the same user even while that row is still active (a phone that signed out offline never revoked it). A phone with no `installId` always gets a new device. Effect per client: the Mac sends its ID from #210 on and keeps it across sign-out, sign-in and a change of sync host; older Mac builds send none and keep the same-name rule. The iPhone keeps its `installId` in Application Support beside its play counts, so a reinstall is a new install, a new device and fresh counts, and the old and new devices add up correctly. It keeps it across sign-out. The iPhone also binds each session to its `installId` (a `session-binding` file written at sign-in); a stored token whose binding is missing or different (a session from before install IDs, or a token that outlived a reinstall) is unbound: the phone revokes it best-effort, clears its credentials and pushed markers (not its counts), pushes and syncs nothing, and asks to sign in again |
| GET `/v1/me` | | `{ user, device, quota: { usedBytes, limitBytes }, devices: [...], devicesHasMore, resyncRequestedAt }`; `devices` holds at most the 50 most recently created devices (newest first); `devicesHasMore` is true when older ones were left out; `resyncRequestedAt` is the ISO time of the account's last `POST /v1/files/resync-request`, or `null` if it never made one; `publicSharesEnabled` is `false` unless the server's `PUBLIC_SHARES_ENABLED` is `true` (#181, clients hide the Link option when false) |
| DELETE `/v1/devices/:id` | | revokes that device's token |
| DELETE `/v1/me` | `{ email }` (must match the account) | `{ ok: true }`; deletes the account, its devices, releases, files and shares; blobs are removed by the cleanup cron within a day; every device token becomes invalid |
| GET `/v1/releases?sinceVersion=N&limit=N` | `limit` (optional, integer, 1 to 200; above 200 clamps to 200, below 1 or non-integer is a 400 like a bad `sinceVersion`; default 200) | `{ releases: [record + version], nextVersion, hasMore }` (tombstones included). Releases come back in ascending `version` order, at most `limit` of them, and the page stops early once its serialized records reach 2 MiB; a page always holds at least one release when any exist (a single record is at most 1 MiB by the PUT body cap, so one always fits under Vercel's 4.5 MB response limit). `hasMore: true` means more releases exist above the last one returned, and `nextVersion` is then the `version` of the last release in this page; `hasMore: false` means the page reached the end, and `nextVersion` is the user's counter, exactly as today (it can be above the last row's version, because a rewritten release moves to a new version and its old number disappears). In both cases `nextVersion` is the value to send as `sinceVersion` next, and it never runs ahead of a release this response left out (the #28 invariant). |
| PUT `/v1/releases/:id` | the record (at most 500 tracks) | `{ version }`; 409 if the stored `updatedAt` is newer; stored files the record no longer references are deleted |
| DELETE `/v1/releases/:id` | | tombstone; `{ version }` |
| GET `/v1/collections?sinceVersion=N&limit=N` | `limit` as for releases (1 to 200, default 200) | `{ collections: [record + version + serverUpdatedAt], nextVersion, hasMore }`, tombstones included, with exactly the paging rules of `GET /v1/releases`; see "Collections" |
| PUT `/v1/collections/:id` | the collection record (at most 1,000 items) | `{ version, pruned }`; 409 if the stored `updatedAt` is newer; 409 `too_many_collections` for a new live one beyond 1,000 |
| DELETE `/v1/collections/:id` | | tombstone; `{ version }` |
| POST `/v1/releases/:id/files` | `{ files: [{ name, bytes, contentType }] }` | `{ uploads: [{ name, url, method, headers }] }`; enforces quota, 200 MB per file, and that `contentType` matches the name's extension; for an adopted release (`source: "adopted"`) only the record's cover name is accepted, any other name is a 400 |
| GET `/v1/releases/:id/files/:name` | | `{ url, expiresAt }` download URL |
| GET `/v1/files/missing` | | `{ releases: [{ id, missing: [names], recordUpdatedAt }], checkedAt, truncated? }`; the caller's live releases with files that are not stored; `truncated` is `true` only when a cap cut the check short; see "Missing files" |
| POST `/v1/files/resync-request` | none | `{ resyncRequestedAt }` (ISO); records that this account asked its devices to re-send files; see "Missing files" |
| PUT `/v1/plays` | `{ counts: [{ releaseId, trackId, count, source?, days?: [{ day, count }] }] }`, 1 to 500 entries | `{ accepted, ignored }`; see "Play counts" |
| GET `/v1/releases/:id/plays` | | `{ tracks: [{ trackId, total, devices: [{ deviceId, name, platform, count, current }] }] }`; 404 for a release that isn't the user's or is tombstoned |
| POST `/v1/shares` | `{ releaseId, trackIds?, recipients, visibility, allowReshare, expiresInDays }` | 201 `{ share, notOnLocally, link }`; see "Shares" |
| GET `/v1/shares?role=sent\|received&cursor&limit` | `limit` 1 to 100 (default 50) | `{ shares: [SentShare \| ReceivedShare], nextCursor }` |
| DELETE `/v1/shares/:id` | | `{ ok: true }`; revokes the share and every reshare below it |
| GET `/v1/shares/:id/files/:name` | | `{ url, expiresAt }`, a 5-minute signed URL (recipient) |
| POST `/v1/shares/:id/claim` | | `{ claimedAt }` (recipient, idempotent) |
| POST `/v1/shares/:id/hide` | | `{ ok: true }` (recipient; dismisses it from the tray) |
| POST `/v1/shares/:id/reshare` | `{ recipients, visibility, allowReshare, expiresInDays }` | as create (recipient) |
| POST `/v1/links/claim` | `{ token }` | `{ share: ReceivedShare }` |
| GET `/s/:token`, `/s/:token/files/:name`, `/s/:token/zip` | none, no auth | the public page (HTML), a 302 to a signed URL, a streamed zip |

Rules: every path is scoped to the token's user; a release id belongs to the user that first
wrote it; tombstones keep their files for 30 days then a cron deletes the objects; codes and
tokens are stored hashed; auth endpoints are rate-limited per email and per IP; the two missing-files routes are rate-limited
device (6 an hour each) and per user (24 an hour each), 429 beyond; JSON request
bodies are capped at 1 MiB (400 when exceeded). The daily cron (`GET /v1/internal/cleanup`) also
drains `pending_deletes` (blobs of deleted accounts), oldest first.

## Shares (#146)

Send a release, or some of its tracks, to named people and optionally to anyone with a link
(`docs/plans/146-sharing.md`). Built in `apps/api` in #181; the Mac and iPhone clients come in #182 and #183.
A share points at the **root owner's stored files** (no copy, no storage cost). JSON is camelCase and times are
ISO 8601 UTC strings, as for records.

**Types**

```json
Snapshot = { "kind": "single"|"album", "title", "artist", "year": string|null, "releaseDate"?: "YYYY-MM[-DD]",
             "genre": string|null, "cover": string|null, "coverHash": string|null,
             "tracks": [{ "id", "title", "trackNumber", "discNumber"?, "file", "bytes", "durationSec"? }] }
SentShare = { "id", "releaseId", "trackIds": [id]|null, "visibility": "private"|"public", "allowReshare": bool,
              "expiresAt": ISO|null, "revokedAt": ISO|null, "createdAt": ISO, "snapshot": Snapshot,
              "recipients": [{ "email", "claimedAt": ISO|null }], "hasLink": bool, "parentShareId": id|null, "downloads": int }
ReceivedShare = { "id", "from": { "email" }, "trackIds": [id]|null, "allowReshare": bool, "canReshare": bool,
                  "expiresAt": ISO|null, "createdAt": ISO, "claimedAt": ISO|null, "snapshot": Snapshot }
```

`Snapshot` is the release record's own fields at share time, with the names and types of "Record" above (`releaseDate`,
`discNumber` and `durationSec` are omitted when absent, never null; `coverHash` is `null` for a record without one), and
`tracks` filtered to the shared track ids when the share is of some tracks. A recipient imports from the snapshot, not
from the live release, so a later edit does not change what was shared. `canReshare` is `allowReshare` and depth below 3.
`downloads` counts the files served for the share, through the recipient route, the public routes and the zip.

**Routes** (device-token auth except `/s/*`; the table above has the one-line forms)

- `POST /v1/shares`, body `{ releaseId, trackIds?, recipients, visibility, allowReshare, expiresInDays }`: `trackIds` is
  1 to 500 ids of that release's tracks (omitted or `null` is the whole release; an id that is not the release's is a
  400); `recipients` is 0 to 50 emails; `expiresInDays` is `null`, `7` or `30` (omitted is `null`). Emails are
  trimmed, lower-cased and de-duplicated, and the caller's own is ignored. Existing accounts become recipients; unknown
  ones are returned in `notOnLocally` (not an error, and nothing is held for them). Reply 201
  `{ share, notOnLocally, link }`. A **private share where no recipient resolves is not created**: 200 with `share: null`.
  `link` is the full public URL `<origin>/s/<token>`, returned **only here** and only for a public share. Errors: 404 for a
  release that is not the caller's live release; 409 `{ "error": "adopted" }` for a release with `source: "adopted"` (its
  audio is not on the server); 403 `{ "error": "public_links_disabled" }` for `visibility: "public"` while the server's
  `PUBLIC_SHARES_ENABLED` is not `true`; 403 `{ "error": "use_reshare" }` for a release whose record has `sharedFrom`
  (it was imported from a share; checked before any recipient lookup, nothing is inserted). A client sharing such a
  release calls `POST /v1/shares/:shareId/reshare` with `sharedFrom.shareId` instead, and hides Share when
  `sharedFrom.allowReshare` is false; 400 for anything malformed.
- `GET /v1/shares?role=sent|received&cursor=<opaque>&limit=1..100`: `{ shares, nextCursor }`, newest first, `nextCursor`
  `null` on the last page. `sent` holds the caller's own shares (`SentShare`), revoked and expired ones included.
  `received` holds `ReceivedShare`s that are **live**: not revoked, not expired, not hidden, and no revoked or expired
  ancestor. A claimed share stays listed with `claimedAt` until the recipient hides it.
- `DELETE /v1/shares/:id` (owner): `{ ok: true }`; revokes it and every reshare below it.
- `GET /v1/shares/:id/files/:name` (recipient): `{ url, expiresAt }`, a signed URL valid 5 minutes for that one blob.
  `name` must be the snapshot's `cover` or one of its tracks' `file`; anything else is a 404. Records a download.
- `POST /v1/shares/:id/claim` (recipient): `{ claimedAt }`, idempotent (a repeat returns the first time).
  The client then imports the share into its library (tagged from the snapshot).
- `POST /v1/shares/:id/hide` (recipient): `{ ok: true }`; dismisses it from the tray. The share still works for the
  file and claim routes.
- `POST /v1/shares/:id/reshare` (recipient), body `{ recipients, visibility, allowReshare, expiresInDays }`, reply as
  create. Makes a child share owned by the caller, with the same release, tracks, snapshot and stored files. 403
  `{ "error": "reshare_not_allowed" }` unless the parent has `allowReshare` and the child's depth stays at most 3.
  A child's expiry never outlives its parent's (a longer or missing request is cut to the parent's).
  Create and reshare share one allowance per user.
- `POST /v1/links/claim`, body `{ token }`: `{ share: ReceivedShare }`. Adds the caller as a recipient of that public
  share (or un-hides it). 404, identical, for an unknown, revoked, expired or disabled link, and for the share's own
  sender. `token` is the part after `/s/` of a link.
- Public, no auth: `GET /s/:token` (HTML page), `GET /s/:token/files/:name` (302 to a 5-minute signed URL; `name` as above),
  `GET /s/:token/zip` (one store-only zip of the shared track files, streamed and never stored; 413 if the files total over
  4 GB). Every `/s/*` answer for an unknown, revoked, expired or disabled link, or for a name not in the share, is the same
  404 page, byte for byte.

**Rules**

- Every recipient route checks the recipient row **and** the share's state (revoked, expired, any revoked or expired
  ancestor); owner routes check the owner. Another user gets 404 on every route (the cross-user matrix covers them).
- Deleting a release (`DELETE` or a `PUT` with `deleted: true`) revokes its shares and their reshares. Deleting an account
  removes its shares and the reshares below them, with their recipients, links and download rows, and its own recipient
  rows, in the account-deletion transaction. Blobs follow the normal prune.
- **Tokens** are 256-bit random, base64url. Only `sha256(token)` is stored and looked up. A token is never logged: the
  request logger records `/s/[token]` as the route pattern, and the rate limiter keys on the hash.
- **Rate limits** (429 beyond, per hour): create and reshare 60 per user; `/v1/links/claim` 30 per user; `/s/*` 60 per
  client IP and 300 per link. An unknown token is charged to its own hash like a real one.
- **The page** is server-rendered by `apps/api` with `Content-Security-Policy: default-src 'none'; img-src 'self'
  <signed-URL origin>; style-src 'self'` (no script, no inline style; one stylesheet at `/share-assets/share.css`),
  `X-Robots-Tag: noindex`, `<meta name="robots" content="noindex">`, `Referrer-Policy: no-referrer` and no Open Graph audio.
  Every snapshot field is HTML-escaped. It shows the cover, title, artist, tracks, a Download link (the zip) and a "Claim in
  Locally" section.
- **Kill switch:** `PUBLIC_SHARES_ENABLED` (default off; only the exact value `true` turns it on). Off, every `/s/*` and
  `/v1/links/claim` answer is the 404 above and a public create is the 403 above.
- **Monitoring:** every served file is a `share_downloads` row (share, name, time, `via` of `recipient` or `link`, bytes).
  The daily cron logs one `share_egress` JSON line with the last 24 hours' total bytes and downloads and the top 10 shares
  by downloads and by bytes, at warn level from `SHARE_EGRESS_ALERT_BYTES`. Monitoring only, no caps in the beta.
- Effect on clients: none until #182 and #183 use these routes. Older clients ignore the new `/v1/me` field.

## Spotify link (#303)

Behind `SPOTIFY_CLIENT_ID` (#305): when it is unset, all four routes answer 404. The server runs its own
PKCE grant with scope `user-read-playback-state` only; its tokens never pass through a client. Nothing
samples these links: see "Spotify sampler" below. No existing route or record changes, so
`apps/web` and `apps/ios` are unaffected until they adopt these.

| Method and path | Body / query | Returns |
| --- | --- | --- |
| POST `/v1/spotify/link` | `{ timeZone }` (IANA name; 400 if invalid) | `{ authorizeUrl }` for `accounts.spotify.com/authorize` (S256, single-use `state`, valid 10 minutes); 10 an hour per user, 429 beyond |
| GET `/v1/spotify/callback` | Spotify's `code` or `error`, and `state`; no auth | A fixed HTML page, `no-store`, CSP `default-src 'none'`, `Referrer-Policy: no-referrer`; 200 "Spotify is linked to Locally. You can close this tab." or 400 "Spotify wasn't linked. Close this tab and try again from Locally." It echoes nothing from the request. A state works once |
| GET `/v1/spotify/link` | | `{ linked: false }` or `{ linked: true, since, lastSampleAt, problem }` (`since` and `lastSampleAt` in epoch ms, `lastSampleAt` and `problem` may be `null`) |
| DELETE `/v1/spotify/link` | | 204; deletes the stored tokens; idempotent |

Account deletion removes the link, and the daily cleanup removes expired link requests.

### Spotify sampler (#303, #306)

| Method and path | Body / query | Returns |
| --- | --- | --- |
| POST `/v1/internal/spotify-sample` | none; `Authorization: Bearer <SAMPLER_SECRET>` (not a device token, not `CRON_SECRET`) | `{ sampled, counted, skipped, nextInMs }` (numbers and a boolean only; no names or ids; `nextInMs` is 10000 while any linked user is playing and 30000 otherwise). 401 for a missing or wrong bearer (compared in constant time); 404 when `SPOTIFY_CLIENT_ID` is unset. A run takes a 50 s lease; a second call inside it answers 200 `{ sampled: 0, counted: 0, skipped: true, nextInMs: 10000 }` |

A run's writes are fenced by its lease (a run whose lease was taken writes nothing), and the route's `maxDuration` is 45 s. A Cloudflare Worker cron (`apps/api/trigger/`; Hobby crons run once a day) calls it every 10 s while any linked user is playing and every 30 s otherwise, as `nextInMs` asks. A run reads `GET /v1/me/player` for
each linked user with no `reconnect` or `notOnTesterList` problem and no back-off (at most 25 at once), resolves
a playing `spotify:local:` uri to one of the user's live releases and counts it once per play, at 30 s or 90% of
a short track, using Spotify's `progress_ms` because it sees a sample every 10 s at best. The link's `problem` is
`reconnect` (the refresh token was refused), `notOnTesterList` (Spotify answered 403 "not registered") or
`rateLimited` (429, with a back-off of at least 60 s, cleared by the next success).

**`platform: "cloud"`.** Plays are stored under one `devices` row per user, named "Spotify (online)", created
by the first count and reused after an unlink and re-link. Its token can never authenticate. The API never accepts
`"cloud"` from a client (`origin` and `platform` in verify stay `mac` or `ios`); it appears only as `platform` in
`GET /v1/releases/:id/plays` (and so in the Mac's and iPhone's per-device lists), and is hidden from
`GET /v1/me`'s `devices` (and its `devicesHasMore`). Both clients already read `platform` as a plain string, so
no client change is needed to show it; its plays are in `GET /v1/plays/summary` like any device's.

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
- **Source (#340).** An entry may carry `source`: `"spotify"` or `"locally"`, where the play was
  counted. Absent means `"spotify"`; any other value (including `null` or a different case) is a
  400. The server keeps counts apart per source: `max(stored, sent)` applies per (device, track,
  source), and per (device, track, source, day) for day buckets, so a Spotify count and a Locally
  count for one track never overwrite each other. An entry's `days` carry the entry's source.
  Reads sum every source, so `total`, a device's `count`, `plays` and `devicePlays` are the same
  numbers as before for existing data (every row stored before #340 is `spotify`). Each
  `tracks[]` and `allTime[]` entry of `GET /v1/plays/summary` also carries
  `bySource: { spotify, locally }` (both numbers always present); `plays` is their sum. The
  cloud sampler writes `spotify`.
- **Effect on clients (#340).** Shipped clients send no `source` (= `spotify`) and read the same
  totals, and they ignore `bySource`. The Mac (#338) and the iPhone (#337) will send `locally` for
  plays inside Locally. The UI still shows one total; the split is kept so a breakdown can come
  later.
- The iPhone pushes its counts too (#337), with `source: "locally"` on every entry, because it only counts plays in Locally's own player.
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
- An adopted record (`source: "adopted"`) is the exception: only its `cover` is checked (under the same
  `coverHash` rule), never its tracks.
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
  self-heal and the Mac "Waiting on your phone" state are the plan's steps 2 and 3. The Mac also
  self-heals its own library's releases the same way (#218): on reconcile, at most every 6 hours, or
  at once when `/v1/me` reports a newer `resyncRequestedAt`, it asks `GET /v1/files/missing` and
  sends the listed files again. The Resync button on the Mac heals at once.

## Collections (#339)

Named mixtapes of releases and tracks in the owner's order (plan `docs/plans/339-collections.md`). Fixtures:
`spec/fixtures/collections/` (`valid.json`; `missing-track.json`, a track id its release lacks, valid on the wire;
`unknown-kind.json`, stored unchanged; `invalid-known-item.json`, a 400).

```json
{
  "syncVersion": 1,
  "id": "9c1e2f40-6b3a-4d7e-8a51-2f0c9d4b7e13",
  "name": "Late drives",
  "items": [
    { "kind": "release", "releaseId": "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90" },
    { "kind": "track", "releaseId": "7a0d4c52-1e3b-4f68-8a9d-2c5b7e1f4a63", "trackId": "c41e8b27-6d95-4a30-b1f2-9e7a3c5d8f04" }
  ],
  "origin": "mac",
  "originDevice": "Toby's MacBook",
  "createdAt": "2026-10-23T20:00:00Z",
  "updatedAt": "2026-10-23T20:00:00Z",
  "deleted": false
}
```

- **Routes:** `GET /v1/collections`, `PUT /v1/collections/:id` (reply `{ version, pruned }`) and
  `DELETE /v1/collections/:id` (a tombstone; reply `{ version }`), in the API table above. The body `id` must equal the URL id.
- **Ownership:** a collection id belongs to the user that first wrote it. Another user's id answers 404 on every route.
- **Tombstones keep no items:** a tombstone (a `DELETE`, or a `PUT` with `deleted: true`) is stored and returned with `items: []`.
- **Last writer wins on the whole record,** as for releases: 409 when the stored `updatedAt` is newer (an equal one is
  accepted, so a retry is idempotent). The client pulls and re-applies. No merge is attempted.
- **Item kinds:** `release` is `{ kind, releaseId }` and `track` is `{ kind, releaseId, trackId }`, both strict: a
  malformed known item (a missing or extra key, a bad UUID) is a 400. Any other `kind` matching `^[a-z][a-z0-9-]{0,15}$`,
  as an object of at most 1 KiB of JSON, is stored and returned unchanged. A `kind` that doesn't match is a 400.
- **Duplicates:** the same `release` item twice, or the same `track` item (same release and track) twice, is a 400. A
  track item from a release that is also a release item is allowed.
- **Limits:** `name` 1 to 100 characters after trimming (stored trimmed), no control characters; at most 1,000 items; at most
  1,000 live collections per user (a new live one beyond answers 409 `{ "error": "too_many_collections" }`; tombstoned ones
  don't count; the count is read before the write, so creations at the same instant can pass it by a few); a record of at most 256 KiB
  of JSON (over that is a 400); at most 1,200 collection writes (PUT and DELETE) per user per hour, past that a 429, which
  clients skip quietly and retry next reconcile; the 1 MiB body cap.
- **Versions** come from the same per-user counter as releases (`user_counters`). `GET` pages the collections table with
  the releases rules: at most `limit` rows and 2 MiB, `hasMore`, `nextVersion` as the last row's version while more remain,
  otherwise the user's counter.
- **A deleted release leaves its collections:**
  - When a release is tombstoned (`DELETE`, or a `PUT` with `deleted: true` that wins), the same batch drops that release's
    `release` and `track` items from each of the user's live collections that has them, and bumps that collection's
    `version`, `updatedAt` (now) and `serverUpdatedAt`, next to the revoking of its shares. A collection written in the same
    instant, after that batch read its list, still loses the item but keeps its version (no version is ever shared); clients
    already hide items whose release is gone, and that collection's next `PUT` drops the item for good.
  - A collection `PUT` drops items that name one of the user's tombstoned releases, in the same batch as the write, and
    `pruned` is how many it dropped. A client with `pruned > 0` pulls that collection rather than keep its own copy. Items naming a
    release the server doesn't know yet are kept.
- **Account deletion** removes the user's collections in the deletion transaction.
- **Effect on clients:** none until they call these routes. A 404 for `/v1/collections` means an older API, skipped quietly.
  Release records, plays and shares don't change.

## Storage and providers

Behind interfaces so local development needs no accounts:

| Concern | Interface | Local (dev, tests) | Production |
| --- | --- | --- | --- |
| Database | Drizzle ORM over libSQL | a SQLite file | Turso (libSQL), provisioned through the Vercel Marketplace |
| Files | `FileStore` | a folder on disk served by the API with signed paths | Vercel Blob, private, direct client uploads |
| Email | `Mailer` | prints the code to the API log | Resend through the Vercel Marketplace |

One dialect (libSQL) everywhere keeps the schema and tests identical between laptop and cloud.

- Unfinished uploads are dropped after a day and count against quota until then.
- Objects with no record are removed.
- Files you upload are kept while their release exists. An upload that never finished is cleared within two days. A deleted release's files are removed after 30 days. Deleting your account removes everything at once.

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
