import { and, eq, lt } from "drizzle-orm";
import type { Db } from "../../db/client";
import { authCodes, files, rateLimits, releases } from "../../db/schema";
import type { FileStore } from "../files/FileStore";

const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface CleanupResult {
  deletedFiles: number;
  deletedAuthCodes: number;
  deletedRateLimits: number;
}

/**
 * The daily cron target (`GET /v1/internal/cleanup`, see `spec/sync.md`):
 * deletes the storage objects of tombstoned releases once they're older than
 * 30 days, prunes expired auth codes so that table doesn't grow forever, and
 * prunes `rate_limits` rows (see `DbRateLimiter`) whose window is more than a
 * day stale — a window that old is never read again, since every limiter's
 * `windowMs` is well under 24h. Tombstone rows themselves are kept (clients
 * may not have seen them yet); only the underlying files are removed.
 */
export class CleanupService {
  constructor(
    private readonly db: Db,
    private readonly fileStore: FileStore,
    private readonly now: () => number = () => Date.now()
  ) {}

  async run(): Promise<CleanupResult> {
    const cutoff = this.now() - TOMBSTONE_RETENTION_MS;

    const oldTombstones = await this.db
      .select({ id: releases.id })
      .from(releases)
      .where(and(eq(releases.deleted, true), lt(releases.serverUpdatedAt, cutoff)));

    let deletedFiles = 0;
    for (const { id: releaseId } of oldTombstones) {
      const rows = await this.db.select().from(files).where(eq(files.releaseId, releaseId));
      for (const row of rows) {
        await this.fileStore.delete(row.storageKey);
        await this.db.delete(files).where(eq(files.id, row.id));
        deletedFiles += 1;
      }
    }

    const expiredCodes = await this.db.select({ id: authCodes.id }).from(authCodes).where(lt(authCodes.expiresAt, this.now()));
    for (const { id } of expiredCodes) {
      await this.db.delete(authCodes).where(eq(authCodes.id, id));
    }

    const rateLimitCutoff = this.now() - RATE_LIMIT_RETENTION_MS;
    const staleRateLimits = await this.db
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, rateLimitCutoff))
      .returning({ key: rateLimits.key });

    return { deletedFiles, deletedAuthCodes: expiredCodes.length, deletedRateLimits: staleRateLimits.length };
  }
}
