import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { authCodes, files, pendingDeletes, rateLimits, releases } from "../../db/schema";
import type { FileStore } from "../files/FileStore";

const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;
const PENDING_DELETE_PAGE_SIZE = 200;

export interface CleanupResult {
  deletedFiles: number;
  deletedAuthCodes: number;
  deletedRateLimits: number;
  /** Blobs of deleted accounts removed from `pending_deletes` this run (see `AccountService`). */
  drainedPendingDeletes: number;
  /** Total bytes across every remaining `files` row (a cost guardrail, not a deletion count). */
  totalStoredBytes: number;
}

/**
 * The daily cron target (`GET /v1/internal/cleanup`, see `spec/sync.md`):
 * drains `pending_deletes` (blobs of deleted accounts, oldest first),
 * deletes the storage objects of tombstoned releases once they're older than
 * 30 days, prunes expired auth codes so that table doesn't grow forever, and
 * prunes `rate_limits` rows (see `DbRateLimiter`) whose window is more than a
 * day stale — a window that old is never read again, since every limiter's
 * `windowMs` is well under 24h. Tombstone rows themselves are kept (clients
 * may not have seen them yet); only the underlying files are removed.
 * Blob deletes use `FileStore.deleteMany`; DB deletes use `WHERE id IN (...)`.
 */
export class CleanupService {
  constructor(
    private readonly db: Db,
    private readonly fileStore: FileStore,
    private readonly now: () => number = () => Date.now()
  ) {}

  /**
   * Delete one queued blob and its `pending_deletes` row. On failure the row
   * stays queued (just `attempts` incremented for logging) so a later run —
   * this one's next page, another account's drain, or the cron — retries
   * it; `FileStore.delete` is safe on an already-missing key, so this never
   * gets stuck on a key that's actually gone. Used when a batched drain
   * fails and we fall back per key.
   */
  private async drainOne(storageKey: string): Promise<boolean> {
    try {
      await this.fileStore.delete(storageKey);
      await this.db.delete(pendingDeletes).where(eq(pendingDeletes.storageKey, storageKey));
      return true;
    } catch {
      await this.db
        .update(pendingDeletes)
        .set({ attempts: sql`${pendingDeletes.attempts} + 1` })
        .where(eq(pendingDeletes.storageKey, storageKey));
      return false;
    }
  }

  /**
   * Try a batched blob + DB delete for these keys; on any failure, fall back
   * to `drainOne` so a single bad key doesn't block the rest of the page.
   */
  private async drainKeys(storageKeys: string[]): Promise<{ drained: number; failed: number }> {
    if (storageKeys.length === 0) return { drained: 0, failed: 0 };

    try {
      await this.fileStore.deleteMany(storageKeys);
      await this.db.delete(pendingDeletes).where(inArray(pendingDeletes.storageKey, storageKeys));
      return { drained: storageKeys.length, failed: 0 };
    } catch {
      let drained = 0;
      let failed = 0;
      for (const key of storageKeys) {
        if (await this.drainOne(key)) drained += 1;
        else failed += 1;
      }
      return { drained, failed };
    }
  }

  /**
   * Drain exactly these keys, once — the account-deletion route's
   * best-effort background pass right after a delete. Order doesn't matter
   * here (unlike the cron's oldest-first page): this call only ever
   * receives one account's just-queued keys. Any left un-drained (a
   * `FileStore` failure) stay in `pending_deletes` for the cron.
   */
  async drainPendingDeletes(storageKeys: string[]): Promise<number> {
    return (await this.drainKeys(storageKeys)).drained;
  }

  /**
   * Drain the whole queue, oldest first, a page at a time. A key that fails
   * stays queued in place, so each next page skips past the failures seen so
   * far; they are retried on the next run.
   */
  private async drainQueue(): Promise<number> {
    let drained = 0;
    let failed = 0;
    for (;;) {
      const rows = await this.db
        .select({ storageKey: pendingDeletes.storageKey })
        .from(pendingDeletes)
        .orderBy(pendingDeletes.enqueuedAt, pendingDeletes.storageKey)
        .limit(PENDING_DELETE_PAGE_SIZE)
        .offset(failed);
      if (rows.length === 0) return drained;

      const page = await this.drainKeys(rows.map((row) => row.storageKey));
      drained += page.drained;
      failed += page.failed;
      if (rows.length < PENDING_DELETE_PAGE_SIZE) return drained;
    }
  }

  async run(): Promise<CleanupResult> {
    const drainedPendingDeletes = await this.drainQueue();

    const cutoff = this.now() - TOMBSTONE_RETENTION_MS;

    const oldTombstones = await this.db
      .select({ id: releases.id })
      .from(releases)
      .where(and(eq(releases.deleted, true), lt(releases.serverUpdatedAt, cutoff)));

    let deletedFiles = 0;
    if (oldTombstones.length > 0) {
      const releaseIds = oldTombstones.map((row) => row.id);
      const rows = await this.db.select().from(files).where(inArray(files.releaseId, releaseIds));
      if (rows.length > 0) {
        await this.fileStore.deleteMany(rows.map((row) => row.storageKey));
        await this.db.delete(files).where(
          inArray(
            files.id,
            rows.map((row) => row.id)
          )
        );
        deletedFiles = rows.length;
      }
    }

    const expiredCodes = await this.db
      .select({ id: authCodes.id })
      .from(authCodes)
      .where(lt(authCodes.expiresAt, this.now()));
    if (expiredCodes.length > 0) {
      await this.db.delete(authCodes).where(
        inArray(
          authCodes.id,
          expiredCodes.map((row) => row.id)
        )
      );
    }

    const rateLimitCutoff = this.now() - RATE_LIMIT_RETENTION_MS;
    const staleRateLimits = await this.db
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, rateLimitCutoff))
      .returning({ key: rateLimits.key });

    const totalsRow = await this.db.select({ total: sql<number>`coalesce(sum(${files.bytes}), 0)` }).from(files);

    return {
      deletedFiles,
      deletedAuthCodes: expiredCodes.length,
      deletedRateLimits: staleRateLimits.length,
      drainedPendingDeletes,
      totalStoredBytes: Number(totalsRow[0]?.total ?? 0),
    };
  }
}
