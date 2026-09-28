import { and, eq, gt, lte, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { releases, userCounters } from "../../db/schema";
import { ConflictError, NotFoundError } from "../../shared/errors";
import type { ReleaseRecord, ReleaseRecordWithVersion } from "../../shared/types";

export interface ListSinceResult {
  releases: ReleaseRecordWithVersion[];
  nextVersion: number;
  hasMore: boolean;
}

/** Default and maximum number of releases returned in one `listSince` page. */
export const RELEASE_PAGE_MAX = 200;

/** A page's serialized records stop growing past this many bytes. */
export const RELEASE_PAGE_MAX_BYTES = 2 * 1024 * 1024;

export interface UpsertResult {
  version: number;
}

type ReleaseRow = typeof releases.$inferSelect;

/**
 * Sync core: list-since-version (with tombstones), last-writer-wins upsert,
 * and tombstoning. A release id belongs to whichever user first wrote it —
 * every lookup by id is checked against `userId` and reports a plain 404
 * (never a 403) when it belongs to someone else, so existence is never
 * leaked across accounts.
 */
export class ReleaseSyncService {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = () => Date.now()
  ) {}

  /**
   * Single-statement bump of this user's version counter. Only ever run in the
   * same `db.batch` (one transaction) as the release write that reads it back
   * through `currentVersion`, so two writes for one user can never share a
   * version or land out of version order.
   */
  private bumpVersion(userId: string) {
    return this.db
      .insert(userCounters)
      .values({ userId, version: 1 })
      .onConflictDoUpdate({ target: userCounters.userId, set: { version: sql`${userCounters.version} + 1` } });
  }

  /** The counter value just written by `bumpVersion`, as a SQL subquery. */
  private currentVersion(userId: string) {
    return sql<number>`(select ${userCounters.version} from ${userCounters} where ${userCounters.userId} = ${userId})`;
  }

  private toRecordWithVersion(row: ReleaseRow): ReleaseRecordWithVersion {
    return {
      ...row.record,
      version: row.version,
      serverUpdatedAt: new Date(row.serverUpdatedAt).toISOString(),
    };
  }

  /**
   * Releases with `version > sinceVersion` for this user, tombstones
   * included, paged to at most `limit` rows and `RELEASE_PAGE_MAX_BYTES` of
   * serialized records (the first row always fits, even alone). `hasMore`
   * is true when rows were left out; `nextVersion` is then the last kept
   * row's version, so it never runs ahead of a release this page left out
   * (the #28 invariant).
   */
  async listSince(userId: string, sinceVersion: number, limit: number = RELEASE_PAGE_MAX): Promise<ListSinceResult> {
    // One batch, so the rows and the counter come from the same snapshot and
    // `nextVersion` never runs ahead of a release this response left out.
    const [rows, [counter]] = await this.db.batch([
      this.db
        .select()
        .from(releases)
        .where(and(eq(releases.userId, userId), gt(releases.version, sinceVersion)))
        .orderBy(releases.version)
        .limit(limit + 1),
      this.db.select().from(userCounters).where(eq(userCounters.userId, userId)),
    ]);

    const kept: ReleaseRow[] = [];
    let bytes = 0;
    let hasMore = rows.length > limit;
    const rowsInBudget = rows.slice(0, limit);
    for (const row of rowsInBudget) {
      const size = JSON.stringify(row.record).length;
      if (kept.length > 0 && bytes + size > RELEASE_PAGE_MAX_BYTES) {
        hasMore = true;
        break;
      }
      kept.push(row);
      bytes += size;
    }

    return {
      releases: kept.map((row) => this.toRecordWithVersion(row)),
      nextVersion: hasMore ? (kept[kept.length - 1]?.version ?? sinceVersion) : (counter?.version ?? 0),
      hasMore,
    };
  }

  /** Look up a release owned by `userId`. Throws `NotFoundError` if missing or owned by someone else. */
  async getOwned(userId: string, releaseId: string): Promise<ReleaseRecordWithVersion> {
    const [row] = await this.db.select().from(releases).where(eq(releases.id, releaseId));
    if (!row || row.userId !== userId) {
      throw new NotFoundError("Release not found");
    }
    return this.toRecordWithVersion(row);
  }

  /**
   * Create or update a release. Last writer wins by `record.updatedAt`: a
   * write whose `updatedAt` is older than what's stored throws
   * `ConflictError` (409) so the caller can pull first and re-apply. An
   * *equal* `updatedAt` is accepted and bumps the version: both clients
   * finish a push whose `PUT` landed but whose file uploads failed by
   * re-sending the same record, so a retry has to be idempotent rather
   * than a conflict (found on the first real-device smoke test, #3).
   */
  async upsert(userId: string, releaseId: string, record: ReleaseRecord): Promise<UpsertResult> {
    const [existing] = await this.db.select().from(releases).where(eq(releases.id, releaseId));

    if (existing && existing.userId !== userId) {
      throw new NotFoundError("Release not found");
    }

    const updatedAtMs = Date.parse(record.updatedAt);
    const now = this.now();

    if (existing && updatedAtMs < existing.updatedAt) {
      throw new ConflictError("Stored record is newer than the one being written");
    }

    // Bump and write in one transaction. The ownership and last-writer-wins
    // checks are repeated in the write's WHERE, so a concurrent write that
    // lands between the read above and this batch can't be overwritten.
    const version = this.currentVersion(userId);
    const [, written] = await this.db.batch([
      this.bumpVersion(userId),
      this.db
        .insert(releases)
        .values({
          id: releaseId,
          userId,
          version,
          record,
          updatedAt: updatedAtMs,
          deleted: record.deleted,
          serverUpdatedAt: now,
        })
        .onConflictDoUpdate({
          target: releases.id,
          set: { record, updatedAt: updatedAtMs, deleted: record.deleted, serverUpdatedAt: now, version },
          setWhere: and(eq(releases.userId, userId), lte(releases.updatedAt, updatedAtMs)),
        })
        .returning({ version: releases.version }),
    ]);

    if (!written[0]) {
      // Lost a race since the read above. The counter bump leaves a gap in
      // this user's versions, which the protocol allows.
      const [current] = await this.db.select().from(releases).where(eq(releases.id, releaseId));
      if (current && current.userId !== userId) {
        throw new NotFoundError("Release not found");
      }
      throw new ConflictError("Stored record is newer than the one being written");
    }
    return { version: written[0].version };
  }

  /** Mark a release deleted. Throws `NotFoundError` if missing or owned by someone else. */
  async tombstone(userId: string, releaseId: string): Promise<UpsertResult> {
    const [existing] = await this.db.select().from(releases).where(eq(releases.id, releaseId));
    if (!existing || existing.userId !== userId) {
      throw new NotFoundError("Release not found");
    }

    const now = this.now();
    const tombstoned: ReleaseRecord = { ...existing.record, deleted: true, updatedAt: new Date(now).toISOString() };
    const [, written] = await this.db.batch([
      this.bumpVersion(userId),
      this.db
        .update(releases)
        .set({ record: tombstoned, updatedAt: now, deleted: true, serverUpdatedAt: now, version: this.currentVersion(userId) })
        .where(and(eq(releases.id, releaseId), eq(releases.userId, userId)))
        .returning({ version: releases.version }),
    ]);

    if (!written[0]) {
      throw new NotFoundError("Release not found");
    }
    return { version: written[0].version };
  }
}
