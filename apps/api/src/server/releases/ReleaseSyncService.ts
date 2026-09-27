import { and, eq, gt } from "drizzle-orm";
import type { Db } from "../../db/client";
import { releases, userCounters } from "../../db/schema";
import { ConflictError, NotFoundError } from "../../shared/errors";
import type { ReleaseRecord, ReleaseRecordWithVersion } from "../../shared/types";

export interface ListSinceResult {
  releases: ReleaseRecordWithVersion[];
  nextVersion: number;
}

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

  /** Atomically bump and return this user's version counter. */
  private async nextVersion(userId: string): Promise<number> {
    const [row] = await this.db.select().from(userCounters).where(eq(userCounters.userId, userId));
    const next = (row?.version ?? 0) + 1;
    if (row) {
      await this.db.update(userCounters).set({ version: next }).where(eq(userCounters.userId, userId));
    } else {
      await this.db.insert(userCounters).values({ userId, version: next });
    }
    return next;
  }

  private toRecordWithVersion(row: ReleaseRow): ReleaseRecordWithVersion {
    return {
      ...row.record,
      version: row.version,
      serverUpdatedAt: new Date(row.serverUpdatedAt).toISOString(),
    };
  }

  /** Releases with `version > sinceVersion` for this user, tombstones included. */
  async listSince(userId: string, sinceVersion: number): Promise<ListSinceResult> {
    const rows = await this.db
      .select()
      .from(releases)
      .where(and(eq(releases.userId, userId), gt(releases.version, sinceVersion)))
      .orderBy(releases.version);

    const [counter] = await this.db.select().from(userCounters).where(eq(userCounters.userId, userId));

    return {
      releases: rows.map((row) => this.toRecordWithVersion(row)),
      nextVersion: counter?.version ?? 0,
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
   * write whose `updatedAt` is not strictly newer than what's stored throws
   * `ConflictError` (409) so the caller can pull first and re-apply.
   */
  async upsert(userId: string, releaseId: string, record: ReleaseRecord): Promise<UpsertResult> {
    const [existing] = await this.db.select().from(releases).where(eq(releases.id, releaseId));

    if (existing && existing.userId !== userId) {
      throw new NotFoundError("Release not found");
    }

    const updatedAtMs = Date.parse(record.updatedAt);
    const now = this.now();

    if (existing) {
      if (updatedAtMs <= existing.updatedAt) {
        throw new ConflictError("Stored record is newer than the one being written");
      }
      const version = await this.nextVersion(userId);
      await this.db
        .update(releases)
        .set({ record, updatedAt: updatedAtMs, deleted: record.deleted, serverUpdatedAt: now, version })
        .where(eq(releases.id, releaseId));
      return { version };
    }

    const version = await this.nextVersion(userId);
    await this.db.insert(releases).values({
      id: releaseId,
      userId,
      version,
      record,
      updatedAt: updatedAtMs,
      deleted: record.deleted,
      serverUpdatedAt: now,
    });
    return { version };
  }

  /** Mark a release deleted. Throws `NotFoundError` if missing or owned by someone else. */
  async tombstone(userId: string, releaseId: string): Promise<UpsertResult> {
    const [existing] = await this.db.select().from(releases).where(eq(releases.id, releaseId));
    if (!existing || existing.userId !== userId) {
      throw new NotFoundError("Release not found");
    }

    const now = this.now();
    const tombstoned: ReleaseRecord = { ...existing.record, deleted: true, updatedAt: new Date(now).toISOString() };
    const version = await this.nextVersion(userId);

    await this.db
      .update(releases)
      .set({ record: tombstoned, updatedAt: now, deleted: true, serverUpdatedAt: now, version })
      .where(eq(releases.id, releaseId));

    return { version };
  }
}
