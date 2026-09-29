# Plan: migrate the sync database once per deploy, and let redeploys through (#90)

`apps/api` only. No change to `spec/*`, the sync contract, or either client. Changes how
production deploys, so the owner approves this plan before it is implemented, and watches the
first deploy after it lands (see "Rollout").

## Facts checked on 29 Sep 2026

Vercel project `locally-sync-api` (scope `test11-0a6a`, the account the CLI signs in to as
`tdare514`), read with `vercel project inspect` and `vercel env ls`:

- Root Directory `apps/api`, framework preset Next.js, Build Command left at the default
  ("`npm run build` or `next build`"), Node.js 24.x. `vercel.ts` carries the cron and the
  `ignoreCommand`; there is no `buildCommand` yet.
- Every variable is set for **Production only**. Preview and Development have none.
  `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are plain ("Config") variables, so they are
  available to the build step as well as at runtime. `AUTH_PEPPER`, `TOKEN_PEPPER`,
  `CRON_SECRET`, `MAILER`, `FILE_STORE` and `RESEND_API_KEY` are sensitive ("Secret"); the
  migration does not need any of them.
- Vercel documents `VERCEL_GIT_PREVIOUS_SHA` as "the SHA of the last successful deployment; only
  exposed when an Ignored Build Step is configured" and `VERCEL_GIT_COMMIT_SHA` as the commit that
  triggered the deployment. A redeploy of the current production deployment therefore runs the
  ignore command with both equal, `git diff --quiet` finds nothing, and the deployment is
  cancelled. The deployment list showed exactly that (three cancelled Production deployments in
  the last ten minutes, one Ready).
- Drizzle's libSQL migrator keeps `__drizzle_migrations (id, hash, created_at)` and applies every
  journal entry whose `when` is greater than the largest `created_at` already stored. The journal
  (`drizzle/meta/_journal.json`) currently has three entries; the last is `0002_powerful_betty_ross`.

## Design

### 1. Migrate at build time, verify at runtime

**`apps/api/scripts/migrate.mjs`** (new, plain ESM so it runs under `node` without a TypeScript
loader; Vercel builds on Node 24, local `engines` is `>=22`):

1. Resolve the database the same way `src/server/config/env.ts` does: `DATABASE_URL`, else
   `TURSO_DATABASE_URL`; token from `DATABASE_AUTH_TOKEN`, else `TURSO_AUTH_TOKEN`. Comment the
   duplication in both files so the two stay in step.
2. No URL and `VERCEL_ENV=production` → print an error and exit 1 (a production build with no
   database is a misconfiguration; today it would fail on the first request instead).
3. No URL otherwise (CI, preview deployments, a local `npm run build`) → print
   `migrate: no database configured, skipping` and exit 0.
4. Otherwise `createClient` + `drizzle` + `migrate({ migrationsFolder: "drizzle" })`, then print
   the last applied tag and how many entries were applied (read `__drizzle_migrations` before and
   after). Any error → exit 1, which fails the build and keeps the previous deployment serving.

**`package.json`**: add `"db:migrate": "node scripts/migrate.mjs"`. `build` stays `next build`
so CI (#83) and local builds are unchanged.

**`vercel.ts`**: add `buildCommand: "npm run db:migrate && next build"`. The deploy-only step
lives in the deploy-only config file, and `buildCommand` in `vercel.ts` overrides the project
setting and the `build` script, so it does not depend on Vercel's script-precedence rules.
Preview deployments run the same command; with no `TURSO_*` in Preview the script takes the
skip branch, so a preview can never migrate the production database. This holds only while
Preview has no database variables (see "Owner actions").

**`src/db/client.ts`**: add `assertMigrated(db)`. It reads the expected last migration with
`readMigrationFiles` from `drizzle-orm/migrator` (the same journal the migrator uses) and runs
one query, `SELECT max(created_at) FROM __drizzle_migrations`. If the table is missing or the
value is below the journal's last `when`, throw an error naming the expected tag, the applied
value, and `npm run db:migrate`. "At least" rather than "equal": after a rollback the older
code runs against a newer schema and must pass.

**`src/server/config/env.ts`**: add `migrateOnStart: boolean`, true unless
`NODE_ENV === "production"`, overridable with `DB_MIGRATE_ON_START=true|false` (documented in
`.env.example` as the escape hatch if the build step ever cannot reach the database).

**`src/server/container.ts`**: `env.migrateOnStart ? await migrateDb(db) : await assertMigrated(db)`.
Also reset the memoised promise when `buildServices` rejects (`delete g[GLOBAL_KEY]` in a
`catch`) so a transient database error on one cold start does not poison that instance for its
whole life; today a rejected promise is cached forever.

Behaviour by environment after the change:

| Where | Migration | Startup check |
|---|---|---|
| `npm run dev`, vitest (`NODE_ENV` not production) | on first request, as today | none |
| Vercel production build | `npm run db:migrate` in the build, fails the deploy on error | `assertMigrated` on every cold start (one query) |
| Vercel preview build | skipped (no database configured) | `loadEnv` already fails closed without a database |
| Local `next start` | needs `DATABASE_URL=… npm run db:migrate` first | `assertMigrated` |

### 2. Let a redeploy build

`vercel.ts` `ignoreCommand` becomes:

```
test -n "$VERCEL_GIT_PREVIOUS_SHA" && test "$VERCEL_GIT_PREVIOUS_SHA" != "$VERCEL_GIT_COMMIT_SHA" && git rev-parse --verify --quiet "$VERCEL_GIT_PREVIOUS_SHA^{commit}" >/dev/null && git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- .
```

A redeploy of the last successful commit (dashboard **Redeploy** or `vercel redeploy`) now has
equal SHAs, the chain exits 1, and the build runs. Everything else keeps the current behaviour:
pushes touching only other apps are still skipped, the first deploy and the shallow-clone case
(#57) still build. Both variables are documented system variables; no project env var is needed
in the ignore step, so a `FORCE_BUILD` override is not added. Known gap: redeploying an *older*
deployment whose commit is not the last successful one is still judged by the diff and may be
skipped; `vercel deploy --prod` remains the fallback for that case and stays in the README.

### 3. Compatibility rule (new, `apps/api/AGENTS.md`)

Old instances keep serving while the new build migrates, and a rollback runs older code on the
newer schema. So every migration must be compatible with the previous deployment's code: add
tables and nullable columns; never rename, drop, or tighten in the same release as the code that
stops using the old shape. This was already true with runtime migration; it is now written down.

## Security

- Build-time database access uses only the Turso URL and token the runtime already has; no new
  secret, no new exposure. Sensitive variables are untouched.
- Previews cannot reach production: they have no database variables and the script skips without
  one. Adding `TURSO_*` to Preview would give every pull-request build write access to the
  production schema; if previews ever need a database, connect a separate Turso database to
  Preview.
- The script spawns nothing and builds no shell strings; the migrator receives an argument
  object.

## Tests (vitest, no network, temp dirs)

- `tests/unit/migrated.test.ts`: `assertMigrated` passes on an in-memory database after
  `migrateDb`; throws on a fresh database (no table); throws after deleting the last row of
  `__drizzle_migrations`; passes when an extra, newer row is present (rollback case).
- `tests/unit/migrateScript.test.ts`: run `node scripts/migrate.mjs` with `execFile` (argument
  array) against `DATABASE_URL=file:<tmpdir>/x.db`: exit 0, the migrations table has as many
  rows as the journal, and a second run applies 0. With no URL and `VERCEL_ENV=preview`: exit 0
  and the skip line. With no URL and `VERCEL_ENV=production`: exit 1.
- `tests/unit/env.test.ts`: `migrateOnStart` defaults and the `DB_MIGRATE_ON_START` override.
- Container: a `buildServices` rejection is not memoised (a second `getServices()` builds again).
- The existing drift check in CI (`npm run db:generate` leaves `drizzle/` clean) is unchanged and
  still guards the journal the script and the guard both read.

## Docs

- `apps/api/README.md`: "Deploying to Vercel" step 2 (migrations run in the build, what the
  build log shows, `db:migrate` for a local production start) and an "Operations" note that a
  redeploy now builds, with `vercel deploy --prod --archive=tgz` kept as the fallback.
- `apps/api/AGENTS.md`: the architecture map line for `src/db` and the compatibility rule above.
- `drizzle.config.ts` comment: migrations apply at build time in production, at first request in
  development.
- `STATUS.md`: replace the "Sync API operations" line under "In progress".

## Rollout

1. Merge; the push touches `apps/api`, so it builds. Watch the build log for the migrate line
   (expected: `up to date, 0 applied, latest 0002_powerful_betty_ross`) and the deployment
   reaching Ready.
2. Send one authenticated request (or wait for the next cron) and check the runtime log has no
   `assertMigrated` error.
3. Run `vercel redeploy <production url>` once: it must build, not cancel.
4. Push a commit that touches only `apps/web` or `apps/ios`: the api deployment must still be
   cancelled by the ignore step.

Rollback: revert the commit, or set `DB_MIGRATE_ON_START=true` in Production and redeploy
(which now works) to restore runtime migration without a code change.

## Owner actions

- Approve this plan (comment on #90 or merge this document).
- Keep Preview and Development free of `TURSO_*` / `DATABASE_URL` (true today).
- Watch the first deploy after the implementation lands (Rollout steps 1–4).

## Scope and collisions

Files: `apps/api/vercel.ts`, `apps/api/package.json`, `apps/api/scripts/migrate.mjs` (new),
`apps/api/src/db/client.ts`, `apps/api/src/server/config/env.ts`, `apps/api/src/server/container.ts`,
`apps/api/.env.example`, `apps/api/README.md`, `apps/api/AGENTS.md`, `apps/api/drizzle.config.ts`,
tests under `apps/api/tests/unit/`, `STATUS.md`. #83 is merged, so the CI collision named in the
issue is gone. No open issue touches `container.ts` or `vercel.ts`.
