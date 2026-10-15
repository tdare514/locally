# #119: releases whose files never reached the server

## Problem

The Mac's "From your phone" tray shows releases whose records are on the server but whose audio and cover
never arrived. Send to Spotify fails forever with "Your phone hasn't finished uploading this song yet".
The only fix today is signing the phone out and back in (#34 clears its per-release markers).

Two server-side facts shape the plan:

1. A `files` row is written when an upload **ticket is issued** (`ReleaseFilesService.createUploads`), not
   when the upload completes. Clients upload straight to Blob, so the server never learns that an upload
   finished. "Row exists" does not mean "file stored".
2. `createDownload` 404s only when there is **no row**. A row whose blob never landed still gets a signed
   URL, which then 404s at Blob. Both cases are "missing" to a user.

So "missing" has to be decided against storage, not rows alone.

## Owner decisions (15 Oct, on #119)

- Switch from "still uploading" to "files never reached the server" as soon as a reconcile finds the files
  still missing, or after 1 hour, whichever comes first.
- The Mac tray marks such a release **"Waiting on your phone"** instead of letting the owner open an error.
  That state has a **"Resync Mac and phone"** action that fixes it.

## Contract change: one new read endpoint

`GET /v1/files/missing` (authenticated, the caller's own account only)

```json
{ "releases": [ { "id": "…", "missing": ["01 - Intro.mp3", "cover.jpg"], "recordUpdatedAt": "…" } ],
  "checkedAt": "…" }
```

- It covers the caller's **live** releases only (no tombstones). For each one, it lists the names the
  record references (each track `file` plus `cover.<ext>` when `coverHash` is set) that are not stored.
- **Stored** means a `files` row exists **and** its blob exists. Blob existence comes from one paged
  `FileStore.listKeys(prefix)` over the user's storage prefix (Vercel Blob `list({ prefix })`, about 1000
  keys a page). The local store lists its directory. It never runs a HEAD request per file.
- Releases with nothing missing are left out, so a healthy account returns `{ "releases": [] }`.
- **Rate limit:** 6 per hour per user (shared limiter #20). Blob list is a priced operation, and this is a
  repair path, not a hot path.
- Shipped clients never call it, so it's fully backward compatible. No change to records or pulls.
- `FileStore` gains `listKeys(prefix): AsyncIterable<string>`, with both implementations covered by tests.

## Phone: self-heal (apps/ios)

- On reconcile, **at most once every 6 hours** (stored timestamp), and also when the server sends the
  resync nudge below, call `GET /v1/files/missing`.
- For each listed release the phone owns locally, clear that release's "server holds" markers (#27) for
  the missing names only, and queue a re-push through the outbox (#19). The existing partial-upload logic
  then uploads just those files. No sign-out needed.
- Releases the phone doesn't have (pushed from elsewhere, or deleted locally): log them and leave them.
  The Mac shows them as described below.

## The "Resync Mac and phone" nudge

The Mac can't reach the phone directly. It asks through the server:

- `POST /v1/files/resync-request`: no body. It sets `resyncRequestedAt` on the caller's account
  (one column, migration included). Same rate limit.
- `GET /v1/me` returns `resyncRequestedAt`. The phone already calls `/v1/me` on reconcile. When the value
  is newer than its last missing-files check, the phone runs the self-heal now, ignoring the 6-hour spacing.
- Old phones ignore the field. Nothing breaks, and the Mac copy tells the owner what to do.

## Mac: honest states (apps/web)

On each reconcile that has "From your phone" releases pending, and at most every 10 minutes, call
`GET /v1/files/missing`. Keep a per-release `firstSeenMissingAt` in sync state.

| Condition | Tray state | Copy |
| --- | --- | --- |
| Not in the missing list | normal | (Send to Spotify works) |
| Missing, first seen on this reconcile, record younger than 1 h | **Uploading** | "Still arriving from your phone…" (quiet, no error) |
| Missing on a later reconcile, **or** record older than 1 h | **Waiting on your phone** | "This song's files never reached the server." Button: **Resync Mac and phone** |

- **Resync Mac and phone** runs the Mac's reconcile now, sends `POST /v1/files/resync-request`, and shows:
  "Asked your phone to send it again. Open Locally on your iPhone to finish." When the files land, the
  next reconcile drops the release from the missing list and the tray returns to normal.
- In the waiting state, the release can't be opened into the old error. `acceptFromPhone` keeps its 404
  mapping as a fallback, but the tray never offers Send in that state.

## Security

- Both new routes use the existing device-token auth. Queries are scoped by `userId`, and the blob
  prefix is the caller's own (`storageKeyFor` prefix). Add these to the cross-user matrix (#33): user B gets
  an empty list and can't nudge user A.
- The response holds only file names the caller already owns. No signed URLs.
- Rate limits sit on both routes, through the shared limiter.

## Speed

- The server does one SQL query (live releases plus their file rows) and one paged blob list per call,
  bounded by the 6-per-hour limit.
- The phone checks at most every 6 h unless nudged. The Mac checks at most every 10 min, and only while
  the tray has pending items.

## Tests

- **API:** missing = no row; missing = row but no blob; stored = both; tombstones excluded; the cover is
  included only with `coverHash`; cross-user isolation; the rate limit; `listKeys` for both stores; the
  migration.
- **Web:** the state table above, driven by a fake clock (first seen, later reconcile, older than 1 h).
  Resync calls both endpoints, and the copy renders. A release is never openable in the waiting state.
- **iOS:** self-heal clears only the missing names' markers and queues one re-push. The 6-hour spacing,
  bypassed by a newer `resyncRequestedAt`. A release the phone doesn't own is left alone.

## Rollout

1. API (endpoint, `listKeys`, column and migration). Deploys on merge.
2. iOS self-heal. Fixes the owner's 6 stuck releases on the next sync after install.
3. Mac tray states and Resync.

Each step is its own PR with its app's check. Steps 2 and 3 depend on 1, and are independent of each other.
