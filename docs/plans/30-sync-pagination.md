# Sync: paginate release and device listings (#30)

## Summary

`GET /v1/releases?sinceVersion=N` and the `devices` list inside `GET /v1/me` return every
matching row. A large library, or a device that has been offline for a long time, gets one
response of unbounded size and time, and on Vercel a function response above 4.5 MB fails
outright. Fix: the server always caps a release page (by row count and by bytes) and says so
with a new `hasMore` field; `nextVersion` becomes "the cursor for the next request", which old
clients already treat it as, so they keep working and simply catch up over several reconciles.
New clients loop until `hasMore` is false. The device list in `/me` is capped and flagged the
same way; no client pages through it, because no client shows it.

## Current behaviour

- `ReleaseSyncService.listSince` (`apps/api/src/server/releases/ReleaseSyncService.ts`, ~line 58)
  selects every row with `version > sinceVersion` for the user, ordered by `version`, and the
  user's counter in the same `db.batch`; it returns `nextVersion = counter.version`.
- The route (`apps/api/src/app/v1/releases/route.ts`) parses only `sinceVersion`.
- `AuthService.listDevices` (`apps/api/src/server/auth/AuthService.ts`, ~line 177) returns every
  device the user ever had, revoked ones included, newest first. `GET /v1/me` embeds it. iOS
  calls `/me` at the end of every reconcile (for quota), so this list is fetched every 30 s.
- Web: `SyncEngine.pullOnce` (`apps/web/src/server/sync/SyncEngine.ts`, ~line 236) makes one
  `listReleases(lastVersion)` call, processes the records, then `bumpLastVersion(nextVersion)`
  (a max, never lowers). `SyncApi.listReleases` (`apps/web/src/server/sync/SyncApi.ts`, ~line
  161) decodes `{ releases, nextVersion }`.
- iOS: `SyncEngine.reconcile` (`apps/ios/Locally/Services/SyncEngine.swift`, ~line 286) makes one
  `api.releases(sinceVersion:)` call and sets `account.lastVersion = page.nextVersion`.
  `SyncApi.releases` (`apps/ios/Locally/Services/SyncApi.swift`, ~line 173) decodes the same two
  keys; `FakeSyncApi` in `apps/ios/LocallyTests/Fakes.swift` (~line 327) mimics it.

## Contract change (spec/sync.md)

### `GET /v1/releases`

Query: `sinceVersion=N` (unchanged, default 0) and a new optional `limit` (integer, 1 to 200;
values above 200 are clamped to 200, below 1 or non-integer are a 400 like a bad
`sinceVersion`).

Response: `{ releases: [record + version], nextVersion, hasMore }`.

- The server returns releases with `version > sinceVersion` in ascending `version` order, at
  most `min(limit, 200)` of them (200 when `limit` is absent), and stops early once the page's
  serialized records reach **2 MiB**. A page always holds at least one release when any exist
  (a single record is at most 1 MiB by the PUT body cap, so one always fits under Vercel's
  4.5 MB response limit).
- `hasMore: true` means more releases exist above the last one returned. `nextVersion` is then
  the `version` of the last release in this page.
- `hasMore: false` means the page reached the end. `nextVersion` is the user's counter, exactly
  as today (it can be above the last row's version, because a rewritten release moves to a new
  version and its old number disappears).
- In both cases `nextVersion` is the value to send as `sinceVersion` next, and it never runs
  ahead of a release this response left out (the #28 invariant, restated in
  `apps/api/AGENTS.md`).

Replace the table row and add one sentence to "Pull / reconcile": "Repeat the request with
`sinceVersion = nextVersion` until `hasMore` is false, saving `nextVersion` after each page is
applied."

### `GET /v1/me`

`devices` holds at most the **50** most recently created devices (newest first, as today), and a
new `devicesHasMore: boolean` is true when older ones were left out. No device-listing
endpoint is added: neither client renders the list, and a device-management screen, when one is
built, gets its own paged route then.

### Why the server pages even when the client sends no `limit`

The issue allows either "page only when the client sends `limit`" or "page always, large enough
that old clients degrade gracefully". This plan pages always, because an opt-in cap leaves the
unbounded response in place for every old client and for anyone calling the API directly, which
is the problem the issue exists to remove. It is safe because old clients already do the right
thing with a smaller `nextVersion` (see below).

## Compatibility and migration

No schema change, no migration, no `syncVersion` bump (the record shape is untouched).

| Client | Behaviour against the new server |
| --- | --- |
| Web and iOS as shipped today | Ignore `hasMore`, store `nextVersion`, and fetch the next page on the next reconcile (iOS every 30 s and on foreground; web on its timer and "Sync now"). Nothing is skipped; a library above 200 releases, or above 2 MiB of records, arrives over several reconciles instead of one. |
| New web and iOS | Send `limit=200` and loop within one reconcile. |
| New clients against an old server (local dev API, or a deploy not yet updated) | `hasMore` is absent; treat it as `false`. The old server returns everything with `nextVersion` = counter, so one iteration completes, as today. |
| `/me` consumers | `devicesHasMore` is additive. The web `MeResult` type gains an optional field; iOS does not decode `devices` at all. |

Deploy order: the API first (old clients stay correct), then the clients in any order.

## Security implications

- The byte and row caps bound per-request memory, CPU and response size, closing a cheap
  amplification: today one authenticated `GET` with `sinceVersion=0` makes the function load
  and serialize the user's whole library. Rate limiting on this route is unchanged.
- `limit` is parsed with zod through `parseParam` like `sinceVersion`, clamped server-side, and
  never interpolated into SQL (Drizzle `.limit()`).
- Scoping is unchanged: every query still filters on the token's `userId`. The cursor is a plain
  version number the client already held, not an opaque token, so there is nothing to forge or
  sign; a client passing a cursor it should not have only sees its own rows above that number.
- Client loops need a guard against a misbehaving or hostile server (see below) so a response
  with `hasMore: true` and a non-advancing `nextVersion` cannot spin forever.

## Affected components

### spec/sync.md

The changes in "Contract change" above: the `GET /v1/releases` row, the `/me` row, the
"Pull / reconcile" sentence.

### apps/api

- `ReleaseSyncService.listSince(userId, sinceVersion, limit)`: in the same `db.batch`, select
  `limit + 1` rows ordered by `version` and the counter. Walk the rows accumulating
  `JSON.stringify(row.record).length`; stop before the row that would take the page past 2 MiB
  (but always keep the first), or at `limit`. `hasMore` is true when rows were left out (the
  `+1` row exists or the byte budget cut the page). `nextVersion` = last kept row's version when
  `hasMore`, else counter. Constants `RELEASE_PAGE_MAX = 200`, `RELEASE_PAGE_MAX_BYTES = 2 MiB`
  exported for tests. `ListSinceResult` gains `hasMore`.
- `apps/api/src/app/v1/releases/route.ts`: parse `limit` with a zod schema
  (`z.coerce.number().int().positive()`, then `Math.min(value, 200)`), default 200.
- `AuthService.listDevices`: `.limit(51)`, return the first 50 plus `hasMore`; `GET /v1/me`
  and `MeResponse` in `apps/api/src/shared/types` gain `devicesHasMore`.
- `apps/api/AGENTS.md`: extend the #28 sync-invariants bullet with "a page may stop early;
  `nextVersion` is then the last returned row's version and `hasMore` is true".

### apps/web

- `SyncApi.listReleases(sinceVersion, limit)`: append `&limit=`; decode `hasMore` as
  `body.hasMore === true` (absent means false); return it in `ListReleasesResult`.
  `MeResult` gains optional `devicesHasMore`.
- `SyncEngine.pullOnce`: wrap the existing body in a loop that keeps its own `cursor`
  (start at `settings.sync.lastVersion`). Each iteration fetches, processes the page exactly as
  today, saves `syncState`, then `bumpLastVersion(nextVersion)`, so an interruption resumes
  from the last applied page. Continue while `hasMore`. Stop with an error (sets `lastError`,
  keeps what was applied) if `nextVersion <= cursor` while `hasMore`, or after 100 pages in one
  reconcile. The next iteration uses the loop's `cursor = nextVersion`, not a re-read of
  settings; after #37 only pulls write `lastVersion`, and the loop keeps it that way.
- The loop runs inside the existing `running` guard of `reconcile`; no new locking.

### apps/ios

- `SyncReleasesPage` gains `hasMore: Bool`; `SyncApi.releases(sinceVersion:limit:)` sends
  `&limit=` and decodes `hasMore` with `decodeIfPresent ?? false`. Update the `SyncApi` protocol
  requirement and every conformer.
- `SyncEngine.reconcile`: replace the single fetch with a loop using a local `cursor`, same
  rules as web: process each page, then set `account.lastVersion = page.nextVersion` (persisted
  per page), continue while `hasMore`, break and set `status.lastError` on a non-advancing cursor
  or after 100 pages. `backfillUnpushed` stays before the loop, `retryFailedAccepts` and the
  `/me` quota fetch stay after it.
- `FakeSyncApi.releases`: honour `limit`, return `hasMore`, and set `nextVersion` to the last
  row's version when truncated, so tests exercise the real paging rule. Add a switch to make
  the fake misbehave (non-advancing cursor) for the guard test.
- `SyncMeResult` needs no change (it does not decode `devices`).

## Tests

### apps/api (vitest, `npm run check`)

- `ReleaseSyncService.test.ts`:
  - 5 releases, `limit` 2: pages return versions [1,2], [3,4], [5] with `hasMore` true, true,
    false; `nextVersion` 2, 4, then the counter.
  - Rewriting a release between pages: it reappears later at its new version, nothing is
    skipped, and the final `nextVersion` equals the counter.
  - Byte budget: records sized so that three exceed 2 MiB; the page stops at two, `hasMore`
    true. A single record near 1 MiB still comes back alone.
  - Tombstones page like any other row.
  - Empty result: `releases: []`, `hasMore: false`, `nextVersion` = counter (0 for a new user).
- `routes.test.ts`: `limit` absent defaults to 200 (seed 201 rows, expect 200 and
  `hasMore`); `limit=500` clamps to 200; `limit=0`, `limit=-1`, `limit=abc` return 400;
  `/v1/me` with 51 devices returns 50 and `devicesHasMore: true`.

### apps/web (vitest, `npm run check`)

- `SyncEngine.test.ts` with its fake `SyncApi` extended to page:
  - A 450-release remote library pulls completely in one `reconcile()` (three pages) and ends
    with `lastVersion` at the counter.
  - Failure on page 2: page 1 is applied and `lastVersion` equals page 1's `nextVersion`; the
    next reconcile resumes from there.
  - A response without `hasMore` is treated as the last page.
  - A non-advancing `nextVersion` with `hasMore: true` stops the loop and sets `lastError`.

### apps/ios (XCTest via `xcodebuild`, see `apps/ios/AGENTS.md`)

- `SyncEngineTests.swift`: the same four cases against `FakeSyncApi`.
- A decode test for `SyncApi.releases` with and without `hasMore` in the JSON (inject the
  response through a `URLProtocol` stub, or decode the
  `Response` struct directly).

## Order and dependencies

- The spec and the API change can land any time; they are safe for shipped clients.
- The client changes touch `apps/ios/Locally/Services/SyncEngine.swift` and
  `apps/web/src/server/sync/SyncEngine.ts`, so they land after #19, #27 and #26, as the issue
  says, rebased on whatever those leave behind.

## Not in this plan

- A paged `GET /v1/devices` and a device-management UI.
- Pruning revoked devices in the cleanup cron (would also bound the list; separate decision).
- Pushes advancing `lastVersion` on web: fixed separately in #37 (only pulls move the cursor
  now, on both clients). The paged loop must keep that rule: nothing but a pulled page's
  `nextVersion` writes `lastVersion`.
