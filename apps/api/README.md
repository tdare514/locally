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
`TOKEN_PEPPER`, `CRON_SECRET` and a database URL are required in production — with
`NODE_ENV=production`, the server refuses to start if any of them is
unset, rather than warning and falling back to an insecure default (outside
production it still just logs a loud warning). `FILE_STORE=blob` and
`MAILER=resend` are likewise fail-closed: the server refuses to start
without `BLOB_READ_WRITE_TOKEN` or `RESEND_API_KEY` respectively, in any
environment, instead of silently falling back to local storage or the
console mailer.

## Observability and cost alerts

Every response carries an `x-request-id` header (the proxy generates one per request and
`src/server/http/observe.ts` forwards it through). When a request fails (status >= 400), the
route logs exactly one JSON line — level `info` for other 4xx, `warn` for 401/403/413/429, `error`
for 5xx — with `requestId`, `route`, `method`, `status`, `durationMs` and `userId` (or `null`);
never the email address, code, token, or request body/headers. In Vercel, open the deployment's
**Runtime Logs** and search for the request id (also returned to the client in the response
header) to correlate a client-reported failure with its server-side log line.

The daily cleanup cron (`GET /v1/internal/cleanup`) additionally logs one `storage_total` line
each run — `{ level, event: "storage_total", totalStoredBytes, alertBytes }` — at `warn` once
total stored bytes (sum of the `files` table) reach `STORAGE_ALERT_BYTES` (default 50 GiB), else
`info`. This is a signal to watch, not an enforced cap — set `STORAGE_ALERT_BYTES` to your real
budget and watch for the `warn` line in Runtime Logs.

To catch runaway spend beyond what these logs surface:

1. **Vercel Spend Management.** Dashboard → **Settings** → **Billing** → **Spend Management** →
   set a budget and a notification threshold for this project/team.
2. **Blob usage and egress.** Dashboard → **Storage** → the Blob store → check usage and egress
   graphs periodically, especially after raising `STORAGE_ALERT_BYTES` or seeing a `warn` line.

## Deploying to Vercel

The production service runs on Vercel with a Turso (libSQL) database, a
private Vercel Blob store and Resend for the sign-in email (#3). The live
origin is `https://locally-sync-api.vercel.app` (Vercel project
`locally-sync-api`); the Mac app's default `sync.baseUrl` and the iOS
release build's `productionBaseURL` both point at it.

1. **Project.** Import the repo into Vercel with **Root Directory**
   `apps/api`; the framework preset is Next.js. `vercel.ts` adds the daily
   cleanup cron, the build command that migrates the database, and the
   ignored-build-step skip rule.
2. **Database.** Add Turso from the Vercel Marketplace
   (`vercel integration add tursocloud/database`); it sets
   `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, which the app reads when
   `DATABASE_URL` is unset. Production refuses to start with neither
   set. Migrations under
   `drizzle/` run in the Vercel build: `buildCommand` in `vercel.ts` runs
   `npm run db:migrate` before `next build`, the build log shows a `migrate:`
   line, and a failed migration fails the deploy so the previous deployment
   keeps serving. Each cold start only verifies the schema is current. A local
   production start (`npm run build && npm start`) needs
   `DATABASE_URL=… npm run db:migrate` first; `DB_MIGRATE_ON_START=true`
   restores runtime migration if the build can't reach the database.
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
Keep it that way: the migrate step skips when no database is configured, which
is what stops a preview build from touching the production schema.

**Operations.** A redeploy of the current production commit (dashboard
**Redeploy**, or `vercel redeploy <url>`) now builds, so an env change can be
applied that way. Pushes that touch only other apps in the monorepo are still
skipped by the ignored-build-step. To redeploy an older commit, which the skip
rule may still cancel, use `vercel deploy --prod --archive=tgz` from a repo
root linked to the project.

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
  client.ts               # createDb()/migrateDb()/assertMigrated(): libSQL client + Drizzle; dev migrates on first request, production only verifies
drizzle/                  # SQL migrations generated by `drizzle-kit generate` (checked in)
scripts/migrate.mjs       # `npm run db:migrate`: applies drizzle/ once per deploy (Vercel build)
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
vercel.ts                   # daily cron -> /v1/internal/cleanup, build command (runs scripts/migrate.mjs), ignore rule
tests/unit/**                # vitest; fakes for every interface, :memory: DB, temp dirs
tests/support/**             # test-only service graph builder + fixtures
```

See `AGENTS.md` at the repo root for the full monorepo layout, and
`SECURITY.md` for this app's threat model.

## Running checks

```bash
npm run check   # next typegen && tsc --noEmit && eslint && vitest run
```
