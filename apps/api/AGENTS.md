# Sync API — agent briefing

## What this is

The hosted sync service described in `spec/sync.md`: email-code accounts, revocable device
tokens, versioned release records with last-writer-wins, per-account quota, and private file
storage behind signed, expiring URLs. Next.js App Router, API routes only — no pages, no UI.
Used by `apps/web` (the Mac app) and `apps/ios` (the phone app) to mirror each other's
libraries. `spec/sync.md` is the contract both clients are built against.

## Architecture map

```
src/app/v1/
  auth/code, auth/verify              # email -> code -> device token
  devices/[id]                        # revoke a device
  me                                  # account, device, quota, device list
  releases, releases/[id]             # list-since-version, upsert, tombstone
  releases/[id]/files                 # request upload URLs
  releases/[id]/files/[name]          # request a download URL
  internal/cleanup                    # daily cron: expired codes, tombstoned files
  internal/local-upload|download/[...key]  # dev-only stand-in for signed object storage
src/proxy.ts                          # CORS for the Mac web app
src/server/
  account/       AccountService: delete a user and queue its blobs
  auth/          AuthService: issue/verify codes, mint/revoke device tokens
  releases/      ReleaseSyncService: scoped list/upsert/tombstone, last-writer-wins
  files/         FileStore interface, Local/VercelBlob impls, ReleaseFilesService
  quota/         QuotaService: usage vs per-account limit
  mail/          Mailer interface, Console/Resend impls
  ratelimit/     RateLimiter interface; DbRateLimiter (libSQL-backed, shared across instances)
  cleanup/       CleanupService: the cron's work
  http/          bearer, responses, validation, authContext, cors, clientIp
  config/env.ts  reads process.env once, with every default
  container.ts   getServices(): builds and memoises the graph above
src/db/{client,schema}.ts, drizzle/   # Drizzle over libSQL; migrations run on first request
src/shared/                           # wire contract: zod schemas + errors, shared with routes
tests/support/{fixtures,testServices.ts}  # in-memory/temp-dir service graph for tests
tests/unit/**                         # vitest against that graph
```

## Non-negotiable rules

- **`spec/sync.md` is the contract.** A change to a route, record shape, or error code updates
  the spec first and states the effect on `apps/web` and `apps/ios` in the same change or a
  linked issue.
- **Every query is scoped by the authenticated user.** Routes get `userId` from
  `http/authContext.ts`; never trust a user or device id from the request body.
- **Sync invariants (#28).** Versions are unique and strictly increasing per user; a pull
  returns every release above the cursor, and `nextVersion` never runs ahead of the rows it
  came with; a page may stop early (row or byte cap), and `nextVersion` is then the last
  returned row's version and `hasMore` is true. Any multi-step write (e.g. counter bump +
  release write) runs in one transaction (`db.batch`), with its preconditions repeated in the
  write's `WHERE`.
- **Storage keys are server-generated, never client input.** A file name in a release record or
  a files route is a plain child name (#10): `fileNameSchema` rejects path separators, caps it at
  200 characters and allows only `mp3`, `m4a`, `jpg`, `jpeg`, `png`. Files move only through
  signed, expiring URLs, never through the API function itself.
- **Auth endpoints are rate limited; the cron endpoint requires `CRON_SECRET`** whenever it is
  set, which must be true in production. Don't weaken either without updating `SECURITY.md`.
- **Config comes only from `src/server/config/env.ts`.** No secrets in the repo;
  `.env.example` documents keys without values.
- **Schema changes go through `npm run db:generate`** (drizzle-kit), with the generated
  migration committed under `drizzle/`.
- **Provider swaps** (file store, mailer, rate limiter, db) implement the existing interface and
  are wired in `container.ts`; services depend on interfaces only, never a concrete impl.
- **Account deletion is one transaction plus the `pending_deletes` queue; never delete blobs
  inline in a request.**
- **Tests use `tests/support/testServices.ts`** (in-memory or temp-dir implementations) — no
  network, no real Blob, no real mail.

## Running checks

```bash
npm run check   # next typegen && tsc --noEmit && eslint && vitest run
```

`npm run dev` listens on all interfaces at port 4000 by design, unlike `apps/web` — the phone
needs LAN access. See `README.md` for the `PUBLIC_BASE_URL` LAN setup this requires.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
