# #89: uploads that never arrived, and files nothing points to

## Why

`POST /v1/releases/:id/files` writes a `files` row, and the row's bytes count against the 1 GB quota, when the API **issues** the upload URL (`ReleaseFilesService.createUploads`). Nothing records that the upload finished, and the daily cleanup only removes files of deleted releases. So:

- an upload that failed or was abandoned counts against quota for ever;
- a stored object whose row is gone (a failed delete, a late upload to a pruned name) is never removed;
- #36's retention text can only say "kept until you delete your account".

#119 (#170) already answers "which of a release's files really are stored", with one paged storage listing per account (`missingFiles`). This plan reuses that listing.

## Decision

The issue offered three options; this plan takes option 1 with a `verified_at` column, plus option 3. Neither changes the contract.

### 1. Verify uploads once a day

- A new nullable column, `files.verified_at` (ms), is set once the object has been seen in storage.
- The daily cron (`GET /v1/internal/cleanup`, 00:00 UTC) gets a pass. It picks users with **unverified rows older than 24 hours**, oldest first, at most 50 users a run. For each of them:
  1. It lists the user's prefix (`users/<userId>/releases/`) once, with the same cap as `missingFiles` (50,000 keys).
  2. Unverified rows older than 24 h whose key **is** listed are marked: `verified_at = now`.
  3. If the listing ran to the end (not capped), unverified rows older than 24 h whose key **is not** listed are deleted. That frees their quota at once.
  4. If the listing hit the cap, nothing is deleted for that user, since a capped listing can't prove absence. It logs one warn line.
- Upload URLs expire long before 24 h, so a row that old with no object can't be mid-upload.

### 2. Sweep objects with no row

- The same listing, when complete, also gives the user's **orphans**: listed keys with no `files` row. They're deleted with `deleteMany`, at most 1,000 a run per user, and counted in the log.
- This is safe without timestamps, for two reasons:
  - A row is always written **before** its upload URL exists (`createUploads`), so a live upload always has a row.
  - Rows are only removed by the release prune, the tombstone cleanup and pass 1, which delete or forgo the object.

  An object with no row is therefore one nothing will ever read.
- Only users listed in pass 1 are swept. A user whose uploads all verified long ago isn't listed again. Orphans there can only come from a failed delete, and `pending_deletes` already retries those.

## What clients see

- No API shape changes.
- A release whose row was deleted in pass 1 shows its file as missing in `GET /v1/files/missing`, as it already does when the object is absent. The phone's self-heal (#171) re-pushes it, which writes a fresh row.
- A Mac's own release with a file that never arrived needs #218 (the Mac re-sends its own missing files), as it does today.
- `spec/sync.md` "Storage" gains three lines:
  - unfinished uploads are dropped after a day and count against quota until then;
  - objects with no record are removed;
  - the retention statement below.

## Retention statement for #36

> Files you upload are kept while their release exists. An upload that never finished is cleared within two days. A deleted release's files are removed after 30 days. Deleting your account removes everything at once.

## Migration

- Add `files.verified_at` (nullable integer) and an index on `(verified_at, created_at)`. The index is partial where SQLite allows, so pass 1 can pick users cheaply.
- No backfill. Every existing row starts unverified, so the first runs list each user with files (50 a run) and mark what's there. For today's handful of accounts that's one run.
- Production migration, so the **owner reviews before merge**.

## Security

- Every key comes from `storageKeyFor`, and every listing uses `userStoragePrefix(userId)`, so one user's pass never reads or deletes another's objects. The cross-user tests gain a case: two users, an orphan in each, a run deletes each user's own orphan only.
- Logs carry the user id and counts, never file names.

## Speed

- Listing is a priced call. It's one per user who uploaded something new since the last run, capped at 50 users and 50,000 keys each.
- Deletes are batched with `deleteMany`. Row updates and deletes are paged by `CLEANUP_PAGE_SIZE`.
- The cron's run time stays bounded by the caps.

## Tests (apps/api, fakes only)

- An upload row older than 24 h with its object is marked verified and is never deleted later.
- One older than 24 h without its object is deleted when the listing is complete, and kept when it was capped.
- A row younger than 24 h is untouched.
- Quota usage drops by the deleted rows' bytes.
- An orphan object is deleted, and an object with a row is not.
- The caps (50 users, 1,000 orphans) hold, and a second run continues where the first stopped.
- Cross-user isolation (above). Idempotent: a second run on the same state changes nothing.

## Session brief (for the build)

```
Model: sonnet (a written plan; one migration; fakes exist)
Read only: docs/plans/89-abandoned-uploads.md, apps/api/AGENTS.md, apps/api/src/server/cleanup/CleanupService.ts, apps/api/src/server/files/ReleaseFilesService.ts (createUploads, missingFiles), apps/api/src/server/files/FileStore.ts, apps/api/src/db/schema.ts, spec/sync.md (Storage)
Do not touch: apps/web, apps/ios
Verify: cd apps/api && npm run check
Done when: the tests above pass, spec/sync.md says the rule and the retention line, and the PR is marked for owner review (production migration)
```
