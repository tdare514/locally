import { and, asc, eq, gt, inArray, isNull, lt, min, sql, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client";
import { authCodes, files, pendingDeletes, playCounts, playDays, playEvents, rateLimits, releases, spotifyLinkRequests } from "../../db/schema";
import { PLAY_DAY_RETENTION_DAYS, utcDay } from "../../shared/days";
import type { FileStore } from "../files/FileStore";
import { listUserKeys, userStoragePrefix } from "../files/ReleaseFilesService";

const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Rows per page for every cleanup pass, so no query binds an unbounded `IN (...)` list. */
const CLEANUP_PAGE_SIZE = 200;
/** An upload row this old with no object can't be mid-upload: upload URLs expire long before (#89). */
const UNVERIFIED_GRACE_MS = 24 * 60 * 60 * 1000;
/** Users whose uploads the verify and orphan passes list per run (one priced listing each). */
const VERIFY_USERS_PER_RUN = 50;
/** Keys read from one user's listing; a listing that hits it can't prove absence. */
const VERIFY_MAX_LISTED_KEYS = 50_000;
/** Orphan objects deleted per user per run. */
const ORPHANS_PER_USER_PER_RUN = 1000;

export interface CleanupResult {
  /** Upload rows whose object was seen in storage and are now marked `verified_at` (#89). */
  verifiedFiles: number;
  /** Upload rows older than 24 hours with no object, deleted (this frees their quota). */
  abandonedFiles: number;
  /** Stored objects with no `files` row, deleted. */
  orphanObjects: number;
  deletedFiles: number;
  /** `play_counts` rows of tombstoned releases past the same retention as their files. */
  deletedPlayCounts: number;
  /** `play_days` rows of those tombstoned releases. */
  deletedPlayDays: number;
  /** `play_days` rows more than 400 days before today's UTC date (retention). */
  expiredPlayDays: number;
  /** `play_events` rows of tombstoned releases past the same retention (#368). */
  deletedPlayEvents: number;
  /** `play_events` rows whose `started_at` is more than 400 days ago (retention, #368). */
  expiredPlayEvents: number;
  deletedAuthCodes: number;
  deletedRateLimits: number;
  /** `spotify_link_requests` rows past their 10-minute expiry. */
  deletedSpotifyLinkRequests: number;
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
 * may not have seen them yet, and pulls return tombstones with no age limit);
 * only the underlying files are removed, and a tombstone with no files left
 * is not selected again. Every pass works a page (`CLEANUP_PAGE_SIZE`) at a
 * time. Blob deletes use `FileStore.deleteMany`; DB deletes use
 * `WHERE id IN (...)`.
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
        .limit(CLEANUP_PAGE_SIZE)
        .offset(failed);
      if (rows.length === 0) return drained;

      const page = await this.drainKeys(rows.map((row) => row.storageKey));
      drained += page.drained;
      failed += page.failed;
      if (rows.length < CLEANUP_PAGE_SIZE) return drained;
    }
  }

  /** The same rowid paging for `play_events`. */
  private async deletePlayEventsPaged(where: SQL | undefined): Promise<number> {
    let deleted = 0;
    for (;;) {
      const result = await this.db.run(
        sql`delete from play_events where rowid in (select rowid from play_events where ${where} limit ${CLEANUP_PAGE_SIZE})`
      );
      deleted += result.rowsAffected;
      if (result.rowsAffected < CLEANUP_PAGE_SIZE) return deleted;
    }
  }

  /**
   * Delete the `play_days` rows matching `where`, a page (`CLEANUP_PAGE_SIZE`) at a time by rowid, so a
   * large backlog is never read back or deleted in one statement. Returns how many rows went.
   */
  private async deletePlayDaysPaged(where: SQL | undefined): Promise<number> {
    let deleted = 0;
    for (;;) {
      const result = await this.db.run(
        sql`delete from play_days where rowid in (select rowid from play_days where ${where} limit ${CLEANUP_PAGE_SIZE})`
      );
      deleted += result.rowsAffected;
      if (result.rowsAffected < CLEANUP_PAGE_SIZE) return deleted;
    }
  }

  /**
   * Pass 1 and 2 (#89), for up to 50 users with unverified upload rows older than 24 hours
   * (oldest first). One listing per user, capped at 50,000 keys:
   * - rows whose key is listed get `verified_at`;
   * - if the listing was complete, old unverified rows whose key is not listed are deleted;
   * - if it was complete, listed keys with no row of this user (and not queued in
   *   `pending_deletes`) are orphans and are deleted, at most 1,000 a run.
   * A capped listing never deletes anything. Logs carry the user id and counts only.
   */
  private async verifyUploads(): Promise<{ verified: number; abandoned: number; orphans: number }> {
    const total = { verified: 0, abandoned: 0, orphans: 0 };
    const cutoff = this.now() - UNVERIFIED_GRACE_MS;
    const oldUnverified = and(isNull(files.verifiedAt), lt(files.createdAt, cutoff));

    const candidates = await this.db
      .select({ userId: files.userId })
      .from(files)
      .where(oldUnverified)
      .groupBy(files.userId)
      .orderBy(asc(min(files.createdAt)), asc(files.userId))
      .limit(VERIFY_USERS_PER_RUN);

    for (const { userId } of candidates) {
      try {
        const counts = await this.verifyUser(userId, cutoff);
        total.verified += counts.verified;
        total.abandoned += counts.abandoned;
        total.orphans += counts.orphans;
      } catch (error) {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "verify_uploads_failed",
            userId,
            error: error instanceof Error ? error.name : "unknown",
          })
        );
      }
    }
    return total;
  }

  private async verifyUser(userId: string, cutoff: number) {
    const { keys: listed, truncated } = await listUserKeys(this.fileStore, userId, VERIFY_MAX_LISTED_KEYS);
    const counts = { verified: 0, abandoned: 0, orphans: 0 };

    // Page the user's old unverified rows by id, so a page that keeps rows (capped listing) still advances.
    let lastId = "";
    for (;;) {
      const rows = await this.db
        .select({ id: files.id, storageKey: files.storageKey })
        .from(files)
        .where(
          and(eq(files.userId, userId), isNull(files.verifiedAt), lt(files.createdAt, cutoff), gt(files.id, lastId))
        )
        .orderBy(asc(files.id))
        .limit(CLEANUP_PAGE_SIZE);
      if (rows.length === 0) break;
      lastId = rows[rows.length - 1]!.id;

      // Preconditions repeat in each write: a row re-issued meanwhile (new created_at) is left alone.
      const stillOld = and(eq(files.userId, userId), isNull(files.verifiedAt), lt(files.createdAt, cutoff));
      const present = rows.filter((row) => listed.has(row.storageKey)).map((row) => row.id);
      if (present.length > 0) {
        const marked = await this.db
          .update(files)
          .set({ verifiedAt: this.now() })
          .where(and(stillOld, inArray(files.id, present)))
          .returning({ id: files.id });
        counts.verified += marked.length;
      }
      if (!truncated) {
        const absent = rows.filter((row) => !listed.has(row.storageKey)).map((row) => row.id);
        if (absent.length > 0) {
          const dropped = await this.db
            .delete(files)
            .where(and(stillOld, inArray(files.id, absent)))
            .returning({ id: files.id });
          counts.abandoned += dropped.length;
        }
      }
      if (rows.length < CLEANUP_PAGE_SIZE) break;
    }

    if (truncated) {
      console.warn(JSON.stringify({ level: "warn", event: "verify_uploads_truncated", userId, keysListed: listed.size }));
    } else {
      counts.orphans = await this.sweepOrphans(userId, listed);
    }

    if (counts.verified + counts.abandoned + counts.orphans > 0 || truncated) {
      console.log(JSON.stringify({ level: "info", event: "verify_uploads", userId, ...counts, truncated }));
    }
    return counts;
  }

  /**
   * Delete listed keys that no `files` row of this user holds (rows of tombstoned releases not yet
   * pruned included: they are rows) and that are not queued in `pending_deletes`. The row keys are
   * read AFTER the listing: a row is written before its upload URL exists, so any listed object
   * has a row unless that row was removed, and a row added since the listing only protects more.
   * Only call with a complete listing.
   */
  private async sweepOrphans(userId: string, listed: Set<string>): Promise<number> {
    if (listed.size === 0) return 0;
    const known = new Set<string>();
    let lastId = "";
    for (;;) {
      const rows = await this.db
        .select({ id: files.id, storageKey: files.storageKey })
        .from(files)
        .where(and(eq(files.userId, userId), gt(files.id, lastId)))
        .orderBy(asc(files.id))
        .limit(CLEANUP_PAGE_SIZE);
      for (const row of rows) known.add(row.storageKey);
      if (rows.length < CLEANUP_PAGE_SIZE) break;
      lastId = rows[rows.length - 1]!.id;
    }

    const candidates = [...listed].filter((key) => key.startsWith(userStoragePrefix(userId)) && !known.has(key));
    const orphans: string[] = [];
    for (let i = 0; i < candidates.length && orphans.length < ORPHANS_PER_USER_PER_RUN; i += CLEANUP_PAGE_SIZE) {
      const page = candidates.slice(i, i + CLEANUP_PAGE_SIZE);
      const queued = await this.db
        .select({ storageKey: pendingDeletes.storageKey })
        .from(pendingDeletes)
        .where(inArray(pendingDeletes.storageKey, page));
      const queuedKeys = new Set(queued.map((row) => row.storageKey));
      for (const key of page) {
        if (!queuedKeys.has(key)) orphans.push(key);
      }
    }

    const batch = orphans.slice(0, ORPHANS_PER_USER_PER_RUN);
    for (let i = 0; i < batch.length; i += CLEANUP_PAGE_SIZE) {
      await this.fileStore.deleteMany(batch.slice(i, i + CLEANUP_PAGE_SIZE));
    }
    return batch.length;
  }

  async run(): Promise<CleanupResult> {
    const drainedPendingDeletes = await this.drainQueue();
    const uploads = await this.verifyUploads();

    const cutoff = this.now() - TOMBSTONE_RETENTION_MS;

    let deletedFiles = 0;
    for (;;) {
      // Select through `files`, not `releases`: a tombstone whose files are
      // already gone drops out of this join, so it is never re-read.
      const rows = await this.db
        .select({ id: files.id, storageKey: files.storageKey })
        .from(files)
        .innerJoin(releases, eq(files.releaseId, releases.id))
        .where(and(eq(releases.deleted, true), lt(releases.serverUpdatedAt, cutoff)))
        .limit(CLEANUP_PAGE_SIZE);
      if (rows.length === 0) break;

      await this.fileStore.deleteMany(rows.map((row) => row.storageKey));
      await this.db.delete(files).where(
        inArray(
          files.id,
          rows.map((row) => row.id)
        )
      );
      deletedFiles += rows.length;
      if (rows.length < CLEANUP_PAGE_SIZE) break;
    }

    // Play counts of tombstoned releases (not served meanwhile), same retention as their files.
    const stalePlayCounts = await this.db
      .delete(playCounts)
      .where(
        inArray(
          playCounts.releaseId,
          this.db
            .select({ id: releases.id })
            .from(releases)
            .where(and(eq(releases.deleted, true), lt(releases.serverUpdatedAt, cutoff)))
        )
      )
      .returning({ trackId: playCounts.trackId });

    const staleTombstonePlayDays = await this.deletePlayDaysPaged(
      inArray(
        playDays.releaseId,
        this.db
          .select({ id: releases.id })
          .from(releases)
          .where(and(eq(releases.deleted, true), lt(releases.serverUpdatedAt, cutoff)))
      )
    );

    // Retention: day buckets older than 400 days (UTC date), live or not.
    const expiredPlayDays = await this.deletePlayDaysPaged(
      lt(playDays.day, utcDay(this.now(), -PLAY_DAY_RETENTION_DAYS))
    );

    const staleTombstonePlayEvents = await this.deletePlayEventsPaged(
      inArray(
        playEvents.releaseId,
        this.db
          .select({ id: releases.id })
          .from(releases)
          .where(and(eq(releases.deleted, true), lt(releases.serverUpdatedAt, cutoff)))
      )
    );

    // Retention: events that started more than 400 days ago, live or not.
    const expiredPlayEvents = await this.deletePlayEventsPaged(
      lt(playEvents.startedAt, this.now() - PLAY_DAY_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    );

    let deletedAuthCodes = 0;
    for (;;) {
      const expiredCodes = await this.db
        .select({ id: authCodes.id })
        .from(authCodes)
        .where(lt(authCodes.expiresAt, this.now()))
        .limit(CLEANUP_PAGE_SIZE);
      if (expiredCodes.length === 0) break;

      await this.db.delete(authCodes).where(
        inArray(
          authCodes.id,
          expiredCodes.map((row) => row.id)
        )
      );
      deletedAuthCodes += expiredCodes.length;
      if (expiredCodes.length < CLEANUP_PAGE_SIZE) break;
    }

    const rateLimitCutoff = this.now() - RATE_LIMIT_RETENTION_MS;
    const staleRateLimits = await this.db
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, rateLimitCutoff))
      .returning({ key: rateLimits.key });

    const staleLinkRequests = await this.db
      .delete(spotifyLinkRequests)
      .where(lt(spotifyLinkRequests.expiresAt, this.now()))
      .returning({ stateHash: spotifyLinkRequests.stateHash });

    const totalsRow = await this.db.select({ total: sql<number>`coalesce(sum(${files.bytes}), 0)` }).from(files);

    return {
      verifiedFiles: uploads.verified,
      abandonedFiles: uploads.abandoned,
      orphanObjects: uploads.orphans,
      deletedFiles,
      deletedPlayCounts: stalePlayCounts.length,
      deletedPlayDays: staleTombstonePlayDays,
      expiredPlayDays,
      deletedPlayEvents: staleTombstonePlayEvents,
      expiredPlayEvents,
      deletedAuthCodes,
      deletedRateLimits: staleRateLimits.length,
      deletedSpotifyLinkRequests: staleLinkRequests.length,
      drainedPendingDeletes,
      totalStoredBytes: Number(totalsRow[0]?.total ?? 0),
    };
  }
}
