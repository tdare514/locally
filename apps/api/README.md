# Sync API

The hosted sync service from `spec/sync.md`: accounts (email + six-digit code),
release records with last-writer-wins sync, and private file storage for
tracks/covers. Used by `apps/web` (the Mac app) and `apps/ios` (the phone
app) to mirror each other's libraries. Next.js 16 App Router, API routes
only — no pages, no UI.

## Requirements

- Node.js 20+

Everything else (database, file storage, mail) defaults to a local,
account-free implementation, so there is nothing else to install.

## Run

```bash
cd apps/api && npm install
npm run dev
```

This starts the API on **all interfaces** at port 4000
(`next dev -H 0.0.0.0 -p 4000`), backed by:

- a local SQLite file at `apps/api/data/dev.db` (migrated automatically on
  first request — no separate migrate step needed),
- a local folder at `apps/api/data/files` standing in for object storage,
  served through this same app's `/v1/internal/local-*` routes with
  HMAC-signed, expiring URLs,
- a console mailer: the six-digit sign-in code is printed to this terminal
  instead of emailed.

No env vars are required. Copy `.env.example` to `.env.local` to override
any of them; see that file for what each one does.

## Reaching it from the Mac app and the phone during development

Both `apps/web` and the iOS app need to reach this API over the LAN, not
just from `localhost`, because:

- the iOS app runs on a physical phone (or simulator on the same Mac) and
  talks to the API over Wi-Fi, and
- **`PUBLIC_BASE_URL` is baked into every local-storage upload/download URL**
  this API hands out (`FILE_STORE=local`, the dev default) — a phone can't
  resolve `localhost` to your Mac, so if this is left at its default, file
  uploads/downloads from the phone will fail to connect even though the API
  calls themselves succeed.

To fix that:

1. Find your Mac's LAN address (`ipconfig getifaddr en0` on most Macs).
2. Set `PUBLIC_BASE_URL=http://<that address>:4000` in `apps/api/.env.local`.
3. Restart `npm run dev`.
4. Point the Mac app and the iOS app's sync settings at
   `http://<that address>:4000` as well.

Since `next dev -H 0.0.0.0` already listens on every interface, no other
change is needed — only the URLs handed to clients (`PUBLIC_BASE_URL`) and
the URLs clients are configured to call need to use the LAN address instead
of `localhost`.

In production (`FILE_STORE=blob`), file URLs come straight from Vercel Blob
and `PUBLIC_BASE_URL` no longer affects them, only remaining relevant for a
handful of internal display purposes.

## Environment variables

See `.env.example` for the full list with descriptions. Every one of them
has a working default for local development; only `AUTH_PEPPER`,
`TOKEN_PEPPER`, and `CRON_SECRET` are required in production — with
`NODE_ENV=production`, the server refuses to start if any of the three is
unset, rather than warning and falling back to an insecure default (outside
production it still just logs a loud warning). `FILE_STORE=blob` and
`MAILER=resend` are likewise fail-closed: the server refuses to start
without `BLOB_READ_WRITE_TOKEN` or `RESEND_API_KEY` respectively, in any
environment, instead of silently falling back to local storage or the
console mailer.

## Deploying to Vercel

The production service runs on Vercel with a Turso (libSQL) database, a
private Vercel Blob store and Resend for the sign-in email (#3).

1. **Project.** Import the repo into Vercel with **Root Directory**
   `apps/api`; the framework preset is Next.js. `vercel.ts` adds the daily
   cleanup cron, nothing else.
2. **Database.** Create a Turso database and set `DATABASE_URL` to
   `libsql://<db>-<org>.turso.io?authToken=<token>`. Migrations under
   `drizzle/` run automatically on the first request of each instance, so a
   deploy needs no separate migrate step.
3. **Files.** Create a Blob store (Storage → Blob) and connect it to the
   project; that sets `BLOB_READ_WRITE_TOKEN`. Set `FILE_STORE=blob`.
4. **Mail.** Verify a sending domain in Resend, then set `MAILER=resend`,
   `RESEND_API_KEY` and `MAIL_FROM` (an address on that domain).
5. **Secrets.** Set `AUTH_PEPPER`, `TOKEN_PEPPER` and `CRON_SECRET` to
   separate long random strings (`openssl rand -base64 48`). Vercel sends
   `CRON_SECRET` as the cron's bearer token.
6. **Origins.** Set `PUBLIC_BASE_URL` to the production origin
   (`https://<project>.vercel.app` or a custom domain). The default
   `ALLOWED_ORIGINS` already covers the Mac app's loopback origin.

Set every variable for the Production environment only; preview deployments
without them fail closed at startup rather than running with dev defaults.

Rate limits on the auth routes are kept in the same database
(`DbRateLimiter`, table `rate_limits`), so they hold across every serverless
instance; the cleanup cron prunes windows older than a day.

After the first deploy, smoke-test before pointing the clients at it:

```bash
curl -s https://<origin>/v1/auth/code -H 'content-type: application/json' -d '{"email":"you@example.com"}'
```

## Project layout

```
src/db/
  schema.ts              # Drizzle schema: users, auth_codes, devices, releases, files, user_counters
  client.ts               # createDb()/migrateDb(): libSQL client + Drizzle, runtime migrations
drizzle/                  # SQL migrations generated by `drizzle-kit generate` (checked in)
src/shared/
  types.ts                # wire contract: zod schemas + inferred types, shared with route handlers
  errors.ts                # ValidationError/UnauthorizedError/NotFoundError/ConflictError/RateLimitError
src/server/
  config/
    env.ts                 # reads process.env once, with every default
  auth/
    AuthService.ts          # issue/verify sign-in codes, device tokens, authenticate(), revoke
  releases/
    ReleaseSyncService.ts   # list-since-version, last-writer-wins upsert, tombstone
  files/
    FileStore.ts            # interface: createUpload/createDownload/delete
    LocalFileStore.ts        # dev/test: signed URLs into apps/api/data/files
    VercelBlobFileStore.ts   # prod: Vercel Blob, signed URLs via issueSignedToken/presignUrl
    ReleaseFilesService.ts   # bridges the `files` DB table and a FileStore
  quota/
    QuotaService.ts          # SUM(files.bytes) vs account limit; per-file cap
  mail/
    Mailer.ts                # interface: sendCode
    ConsoleMailer.ts          # dev: logs the code
    ResendMailer.ts           # prod: sends through Resend
  ratelimit/
    RateLimiter.ts            # interface: sliding-window consume()
    InMemoryRateLimiter.ts     # dev/single-instance default
  cleanup/
    CleanupService.ts         # the daily cron's work: old tombstones' files, expired codes
  http/
    bearer.ts, responses.ts, validation.ts, authContext.ts, cors.ts, clientIp.ts
  container.ts               # getServices(): builds and memoises the graph above
src/app/v1/**/route.ts     # thin HTTP handlers built on the services above
src/proxy.ts                # CORS for the Mac web app (see spec/sync.md)
vercel.ts                   # daily cron -> /v1/internal/cleanup
tests/unit/**                # vitest; fakes for every interface, :memory: DB, temp dirs
tests/support/**             # test-only service graph builder + fixtures
```

See `AGENTS.md` at the repo root for the full monorepo layout, and
`SECURITY.md` for this app's threat model.

## Running checks

```bash
npm run check   # next typegen && tsc --noEmit && eslint && vitest run
```
