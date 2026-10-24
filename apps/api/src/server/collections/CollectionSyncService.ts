import { and, count, eq, gt, lte, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { collections, userCounters } from "../../db/schema";
import { ConflictError, NotFoundError } from "../../shared/errors";
import { MAX_LIVE_COLLECTIONS, type CollectionRecord, type CollectionRecordWithVersion } from "../../shared/collections";
import { pruneTombstonedItems } from "./prune";

export interface CollectionListResult {
  collections: CollectionRecordWithVersion[];
  nextVersion: number;
  hasMore: boolean;
}

/** Default and maximum number of collections returned in one `listSince` page. */
export const COLLECTION_PAGE_MAX = 200;

/** A page's serialized records stop growing past this many bytes. */
export const COLLECTION_PAGE_MAX_BYTES = 2 * 1024 * 1024;

export interface CollectionWriteResult {
  version: number;
}

export interface CollectionUpsertResult extends CollectionWriteResult {
  /** Items the API dropped because they name one of the user's deleted releases. */
  pruned: number;
}

type CollectionRow = typeof collections.$inferSelect;

/**
 * Collection sync (#339), modelled on `ReleaseSyncService`: scoped list/upsert/tombstone, last writer wins on the
 * whole record, versions from the same per-user counter. An id belongs to the user that first wrote it; anyone
 * else gets a plain 404.
 */
export class CollectionSyncService {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = () => Date.now()
  ) {}

  private bumpVersion(userId: string) {
    return this.db
      .insert(userCounters)
      .values({ userId, version: 1 })
      .onConflictDoUpdate({ target: userCounters.userId, set: { version: sql`${userCounters.version} + 1` } });
  }

  private currentVersion(userId: string) {
    return sql<number>`(select ${userCounters.version} from ${userCounters} where ${userCounters.userId} = ${userId})`;
  }

  private toRecordWithVersion(row: CollectionRow): CollectionRecordWithVersion {
    return { ...row.record, version: row.version, serverUpdatedAt: new Date(row.serverUpdatedAt).toISOString() };
  }

  /** Same paging rules as `ReleaseSyncService.listSince`: row cap, byte cap, `nextVersion` never ahead of a left-out row. */
  async listSince(userId: string, sinceVersion: number, limit: number = COLLECTION_PAGE_MAX): Promise<CollectionListResult> {
    const [rows, [counter]] = await this.db.batch([
      this.db
        .select()
        .from(collections)
        .where(and(eq(collections.userId, userId), gt(collections.version, sinceVersion)))
        .orderBy(collections.version)
        .limit(limit + 1),
      this.db.select().from(userCounters).where(eq(userCounters.userId, userId)),
    ]);

    const kept: CollectionRow[] = [];
    let bytes = 0;
    let hasMore = rows.length > limit;
    for (const row of rows.slice(0, limit)) {
      const size = JSON.stringify(row.record).length;
      if (kept.length > 0 && bytes + size > COLLECTION_PAGE_MAX_BYTES) {
        hasMore = true;
        break;
      }
      kept.push(row);
      bytes += size;
    }

    return {
      collections: kept.map((row) => this.toRecordWithVersion(row)),
      nextVersion: hasMore ? (kept[kept.length - 1]?.version ?? sinceVersion) : (counter?.version ?? 0),
      hasMore,
    };
  }

  /** Look up a collection owned by `userId`. Throws `NotFoundError` if missing or owned by someone else. */
  async getOwned(userId: string, collectionId: string): Promise<CollectionRecordWithVersion> {
    const [row] = await this.db.select().from(collections).where(eq(collections.id, collectionId));
    if (!row || row.userId !== userId) {
      throw new NotFoundError("Collection not found");
    }
    return this.toRecordWithVersion(row);
  }

  /**
   * Create or update a collection. A write whose `updatedAt` is older than the stored one is a 409; an equal one is
   * accepted (idempotent retry), as for releases. A new live collection beyond the per-user cap is a 409
   * `too_many_collections`. A tombstone (`deleted: true`) is stored with `items: []`. Items naming this user's tombstoned releases are dropped in the same batch and counted.
   */
  async upsert(userId: string, collectionId: string, sent: CollectionRecord): Promise<CollectionUpsertResult> {
    // A tombstone keeps no items.
    const record: CollectionRecord = sent.deleted ? { ...sent, items: [] } : sent;
    const [existing] = await this.db.select().from(collections).where(eq(collections.id, collectionId));
    if (existing && existing.userId !== userId) {
      throw new NotFoundError("Collection not found");
    }

    const updatedAtMs = Date.parse(record.updatedAt);
    if (existing && updatedAtMs < existing.updatedAt) {
      throw new ConflictError("Stored record is newer than the one being written");
    }

    if (!record.deleted && (!existing || existing.deleted)) {
      const [live] = await this.db
        .select({ n: count() })
        .from(collections)
        .where(and(eq(collections.userId, userId), eq(collections.deleted, false)));
      if ((live?.n ?? 0) >= MAX_LIVE_COLLECTIONS) {
        throw new ConflictError("too_many_collections");
      }
    }

    const now = this.now();
    const version = this.currentVersion(userId);
    const [, written, , [after]] = await this.db.batch([
      this.bumpVersion(userId),
      this.db
        .insert(collections)
        .values({ id: collectionId, userId, version, record, updatedAt: updatedAtMs, deleted: record.deleted, serverUpdatedAt: now })
        .onConflictDoUpdate({
          target: collections.id,
          set: { record, updatedAt: updatedAtMs, deleted: record.deleted, serverUpdatedAt: now, version },
          setWhere: and(eq(collections.userId, userId), lte(collections.updatedAt, updatedAtMs)),
        })
        .returning({ version: collections.version }),
      pruneTombstonedItems(this.db, userId, collectionId, version),
      this.db
        .select({ n: sql<number>`json_array_length(${collections.record}, '$.items')` })
        .from(collections)
        .where(and(eq(collections.id, collectionId), eq(collections.userId, userId))),
    ]);

    if (!written[0]) {
      const [current] = await this.db.select().from(collections).where(eq(collections.id, collectionId));
      if (current && current.userId !== userId) {
        throw new NotFoundError("Collection not found");
      }
      throw new ConflictError("Stored record is newer than the one being written");
    }
    return { version: written[0].version, pruned: Math.max(0, record.items.length - (after?.n ?? record.items.length)) };
  }

  /** Mark a collection deleted. Throws `NotFoundError` if missing or owned by someone else. */
  async tombstone(userId: string, collectionId: string): Promise<CollectionWriteResult> {
    const [existing] = await this.db.select().from(collections).where(eq(collections.id, collectionId));
    if (!existing || existing.userId !== userId) {
      throw new NotFoundError("Collection not found");
    }

    const now = this.now();
    const tombstoned: CollectionRecord = { ...existing.record, items: [], deleted: true, updatedAt: new Date(now).toISOString() };
    const [, written] = await this.db.batch([
      this.bumpVersion(userId),
      this.db
        .update(collections)
        .set({ record: tombstoned, updatedAt: now, deleted: true, serverUpdatedAt: now, version: this.currentVersion(userId) })
        .where(and(eq(collections.id, collectionId), eq(collections.userId, userId)))
        .returning({ version: collections.version }),
    ]);

    if (!written[0]) {
      throw new NotFoundError("Collection not found");
    }
    return { version: written[0].version };
  }
}
