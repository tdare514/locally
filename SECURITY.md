# Security model

This app runs a local Node server that writes to the user's disk (tagged music files,
a settings file, a library index) and shells out to `ffmpeg`/`open`. It's designed to
be used from a single browser on the same machine, but it still has to defend against
a browser that can reach it — other tabs, other sites, and other hosts on the LAN.

## Threat model and mitigations

### Cross-site request forgery (CSRF) from other browser tabs

A malicious page open in another tab could try to `fetch("http://localhost:3000/api/...")`
to make the server import files, delete releases, or repoint the library dir.

**Mitigation**: `src/proxy.ts` rejects any mutating request (`POST`/`PUT`/`PATCH`/`DELETE`
under `/api/`) whose `Origin` (or, failing that, `Referer`) is not exactly this server's
own origin — scheme, host *and* port, derived from the already-verified `Host` header.
Browsers always attach `Origin` on cross-site mutating requests, so a same-origin fetch
from this app's own page passes; a page on another loopback port (say a dev server on
`localhost:5173`), a missing or unparsable header, and the literal `null` origin are all
rejected with 403.

### DNS rebinding / LAN exposure

An attacker-controlled DNS name could resolve to `127.0.0.1` after the browser's initial
same-origin check, or the dev server could be exposed to other devices on the LAN.

**Mitigation**: two layers. `src/proxy.ts` checks the `Host` header on every request
and rejects anything that isn't `localhost`/`127.0.0.1`/`[::1]`, regardless of what DNS
resolved — that is the DNS-rebinding defence. The network defence is that the server only
listens on `127.0.0.1` (`next dev -H 127.0.0.1` / `next start -H 127.0.0.1` in
`apps/web/package.json`), so nothing else on the LAN can reach the port at all. Both are
needed: a non-browser client can forge any `Host` header it likes, so the header check
alone would not keep a LAN attacker out if the port were reachable.

### Path traversal via user-controlled names

Artist/album/track names, cover filenames, and the `reveal` path all come from the
client and end up in filesystem paths. Without sanitisation, `../../etc` in an artist
name could escape the library directory.

**Mitigation**: every user-derived segment is sanitised by
`src/server/releases/ReleaseLayout.ts` (`sanitizeSegment`, `folderFor`, `trackFileName`,
`coverFileName`) before it becomes part of a path, and every write/delete/reveal target
is additionally checked with `FileSystem.isInside` (`src/server/fs/NodeFileSystem.ts`)
against the current library directory before use — see `ReleaseService.delete` and
`src/app/api/reveal/route.ts`.

### File names in sync records

A release record fetched from the sync service names its files (`tracks[].file`, `cover`)
and ids, and both clients use those names as path components: the Mac downloads to
`<dir>/<file>` and `ReleaseService.importSynced` reads them back; the iPhone does the same in
`SyncEngine` and `ReleaseCoordinator.importSynced`. A `../x` there would write, and via the
replace-on-download, destroy, a file outside the download directory.

**Mitigation**: names are accepted only when they are plain child names — no separators, not
`.`/`..` or any leading-dot name, no control characters, at most 255 bytes — and refused
rather than repaired, because they have to match an object the service already stores. On the
Mac that rule lives in `SyncRecordSchema` (`apps/web/src/server/sync/SyncRecord.ts`), which
guards both the wire and the persisted pending records, and again in
`ReleaseService.importSynced`; on iOS in `ReleaseLayout.isPlainFileName`, applied before every
download and every read. Both are followed by the same `isInside` check as every other path.

### Malicious uploads

An uploaded "cover.jpg" could actually be an arbitrary file (script, executable, huge
blob) that gets written to disk and later served back with an attacker-chosen
content-type.

**Mitigation**: `src/server/http/validation.ts` enforces an extension allowlist, size
caps (`MAX_COVER_BYTES` = 10MB, `MAX_AUDIO_BYTES` = 500MB), and sniffs the actual leading
bytes of image uploads (`sniffImageMime`) rather than trusting the filename or the
browser-supplied MIME type. The cover GET route serves a content-type derived from the
file's own extension, not from user input.

### Command injection via ffmpeg/open

Filenames and paths derived from user input are passed to external processes.

**Mitigation**: both `src/server/audio/FfmpegConverter.ts` and `src/app/api/reveal/route.ts`
invoke `spawn`/`execFile` with argument arrays, never a shell string built by
concatenating user input — so there is no shell to inject into.

### Request body size

`apps/web/next.config.ts` sets `experimental.proxyClientMaxBodySize` to 4 GB so an album of
large lossless files can be uploaded through the Next proxy in one request. The proxy buffers
that body in memory, which is acceptable only because the server is loopback-only and
single-user. Streaming/chunked upload is tracked in #12.

### Outbound sync client and token storage

The Mac app is also an HTTP client of `apps/api`: `src/server/sync/SyncEngine.ts` and
`SyncApi.ts` talk to the sync service over the base URL and device token in
`settings.sync`. The device token is an opaque bearer token, stored alongside the base URL
in the local settings file managed by `FileSettingsStore`
(`~/.spotify-local-import/settings.json`), and sent only to that configured base URL as an
`Authorization: Bearer` header. Requiring HTTPS for non-loopback base URLs and clearing the
token when the base URL changes are tracked in #11.

## apps/api

Unlike `apps/web`, this is a multi-tenant network service (the hosted sync backend
from `spec/sync.md`), so its threat model is different: it has to defend against
other accounts, not just other browser tabs.

### Authentication: no passwords, hashed everything

Accounts are email + a six-digit code, never a password. `src/server/auth/AuthService.ts`:

- Codes are 6 digits, expire after 10 minutes, allow at most 5 wrong guesses, and are
  invalidated the moment a newer one is issued. Only `sha256(code + AUTH_PEPPER)` is
  stored (`auth_codes.codeHash`) — never the code itself.
- A successful code exchange mints an opaque 32-byte random device token. Only
  `sha256(token + TOKEN_PEPPER)` is stored (`devices.tokenHash`) — never the token
  itself. Losing the database does not hand out anyone's password or token.
- A device token unused for a year (365 days) expires (`TOKEN_IDLE_TTL_MS` in `AuthService`), so a
  token on a lost or sold device stops working even if nobody revokes it. The account is
  unaffected: the user can sign in again with an email code at any time. `lastSeenAt` is
  refreshed at most once a day to avoid a write per request.
- `AUTH_PEPPER`/`TOKEN_PEPPER` are required in production; `src/server/config/env.ts`
  falls back to a fixed, insecure development value outside production (with a loud
  startup warning), but with `NODE_ENV=production` refuses to start at all if either,
  or `CRON_SECRET`, is unset — this can't fail silently or ship insecure on a real
  deployment.
- Revoking a device (`DELETE /v1/devices/:id`) is scoped to the caller's own `userId`,
  so one account can never revoke another's device.

### Per-user scoping on every query

Every table that isn't global (`devices`, `releases`, `files`) carries a `userId`
column, and every read/write in `AuthService`, `ReleaseSyncService`,
`ReleaseFilesService`, and `QuotaService` filters by it. A release id is looked up
without a `userId` filter exactly once — to detect whether it belongs to someone
else — and if it does, the response is a plain 404, identical to "doesn't exist":
`spec/sync.md` requires that a release id's ownership never leak across accounts
(see `ReleaseSyncService.getOwned`/`upsert`/`tombstone`).

### Input validation

- Release ids and device ids are UUIDs, validated with zod (`shared/types.ts`)
  before ever reaching a query.
- File names (track files, covers) are validated against path separators, a
  200-character limit, and an extension allowlist (`mp3`, `m4a`, `jpg`, `jpeg`,
  `png`) — see `fileNameSchema`. This applies both to file names embedded in a
  release record and to the two file routes' own `name` inputs.
- Every request body is parsed through a zod schema (`server/http/validation.ts`);
  a schema mismatch or unparseable JSON becomes a `ValidationError` (400) with a
  message safe to show the client, never a raw zod/parse error.
- Request bodies are capped at 1 MiB (`MAX_JSON_BODY_BYTES`), checked against both
  the declared `content-length` and the actual body, before JSON parsing.
- A release record's `tracks` array is capped at 500 entries.
- A file's declared `contentType` must match the one both clients derive from its
  extension (`server/files/contentTypes.ts`); `ReleaseFilesService.createUploads`
  rejects a mismatch before it ever reaches quota checks or storage.

### Storage keys are never client input

`POST /v1/releases/:id/files` accepts a file *name*, never a storage path. The
actual storage key (`users/<userId>/releases/<releaseId>/<name>`) is built
server-side in `ReleaseFilesService`/`storageKeyFor`, from the authenticated
`userId`, the already-ownership-checked `releaseId`, and the already-validated
`name` — a client can never point storage at another user's or release's path.
A successful `PUT /v1/releases/:id` (not a tombstone) also prunes any previously
registered file no longer referenced by the record's tracks/cover
(`ReleaseFilesService.pruneUnreferenced`), so a track dropped from a release
doesn't linger in storage or against quota. Tombstoned releases' files are
cleaned up separately, on a delay, by `CleanupService`.

### Signed URLs for file transfer

Clients upload and download file bytes directly against object storage, never
through the API function itself (`spec/sync.md`: Vercel functions cap request
bodies at 4.5 MB). In production this is Vercel Blob's own signed-URL mechanism
(`VercelBlobFileStore`, via `issueSignedToken`/`presignUrl`, each scoped to one
pathname/content-type/size and expiring in 5 minutes). In local development
(`LocalFileStore`), the same contract is implemented for real: an HMAC-SHA256
signature keyed off `TOKEN_PEPPER` with domain separation (never the pepper bytes
directly, and upload signatures can never verify as download signatures or vice
versa), verified with `crypto.timingSafeEqual` and an expiry check before either
`/v1/internal/local-upload/*` or `/v1/internal/local-download/*` touches disk. An
upload's signature also covers the declared byte count, so a client can't shrink
`bytes` to slip past the quota check and then PUT a larger body than it declared —
`writeFromRequest` streams the body and aborts once it exceeds that verified
maximum, writing nothing to disk.

### Rate limiting

`POST /v1/auth/code` and `POST /v1/auth/verify` are both rate-limited per email
and per IP with an in-memory sliding window (`server/ratelimit/`), on top of the
per-code 5-attempt cap inside `AuthService.verify` itself.

### CORS

`src/proxy.ts` adds CORS headers only for origins in `ALLOWED_ORIGINS` (default:
any `localhost`/`127.0.0.1` port, for the Mac web app in development). The iOS
app is not a browser and is unaffected either way. Auth here is a bearer token
the client attaches explicitly — never an ambient credential like a cookie — so
there is no CSRF surface to guard the way `apps/web`'s `proxy.ts` has to.

### The cron endpoint

`GET /v1/internal/cleanup` (deletes old tombstones' files and expired auth codes)
requires `Authorization: Bearer <CRON_SECRET>` whenever `CRON_SECRET` is set,
which must be true in production (`loadEnv` refuses to start without it there).
The comparison is `crypto.timingSafeEqual` on the header against the expected
value, not `!==`. It's deliberately left open when unset, which only happens in
local development (`.env.example` leaves it blank on purpose), so it can be
exercised directly with curl.

### Env vars

See `apps/api/.env.example` for the full list (`DATABASE_URL`, `AUTH_PEPPER`,
`TOKEN_PEPPER`, `FILE_STORE`, `BLOB_READ_WRITE_TOKEN`, `MAILER`,
`RESEND_API_KEY`, `MAIL_FROM`, `CRON_SECRET`, `ALLOWED_ORIGINS`,
`PUBLIC_BASE_URL`), each with a working, insecure-by-design local default.
`loadEnv` (`src/server/config/env.ts`) fails closed rather than silently
degrading: `FILE_STORE=blob` without `BLOB_READ_WRITE_TOKEN`, or
`MAILER=resend` without `RESEND_API_KEY`, throws instead of falling back to
`LocalFileStore`/`ConsoleMailer` — the latter would otherwise print sign-in
codes to production logs. With `NODE_ENV=production`, a missing
`AUTH_PEPPER`, `TOKEN_PEPPER`, or `CRON_SECRET` throws too, instead of just
warning.

## Reporting

`apps/web` is a local single-user tool with no network service beyond localhost.
`apps/api` is a small hosted multi-tenant service. If you find an issue in either,
open an issue in this repository describing the reproduction steps.
