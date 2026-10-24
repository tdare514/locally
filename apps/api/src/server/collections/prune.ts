import { and, eq, sql, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client";
import { collections } from "../../db/schema";

/**
 * The prune (#339): items of a collection that name a deleted release. Collection records are JSON text, so the
 * filtering runs in SQL, inside the same `db.batch` as the write that triggers it; no read-then-write window.
 */

/** A `release` or `track` item whose release is `releaseSql`-matched. */
function itemNamesRelease(match: SQL) {
  return sql`(json_extract(value, '$.kind') IN ('release', 'track') AND ${match})`;
}

function itemsWithout(match: SQL) {
  return sql`(SELECT json_group_array(json(value)) FROM json_each(${collections.record}, '$.items') WHERE NOT ${itemNamesRelease(match)})`;
}

function hasItem(match: SQL) {
  return sql`EXISTS (SELECT 1 FROM json_each(${collections.record}, '$.items') WHERE ${itemNamesRelease(match)})`;
}

/** Ids of the user's live collections that have an item naming `releaseId` (read before the batch; the catch-all covers races). */
export async function liveCollectionIdsNaming(db: Db, userId: string, releaseId: string): Promise<string[]> {
  const rows = await db
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.userId, userId), eq(collections.deleted, false), hasItem(sql`json_extract(value, '$.releaseId') = ${releaseId}`)));
  return rows.map((r) => r.id);
}

/**
 * Drop `releaseId`'s items from the user's live collections (one collection when `collectionId` is given, else all
 * of them), bumping `version`, `updatedAt` and `serverUpdatedAt`. Only acts if the release is tombstoned by then.
 */
export function pruneCollectionsOfRelease(db: Db, userId: string, releaseId: string, at: number, version: SQL<number>, collectionId?: string) {
  const match = sql`json_extract(value, '$.releaseId') = ${releaseId}`;
  return db
    .update(collections)
    .set({
      record: sql`json_set(${collections.record}, '$.items', json(${itemsWithout(match)}), '$.updatedAt', ${new Date(at).toISOString()})`,
      updatedAt: at,
      serverUpdatedAt: at,
      version,
    })
    .where(
      and(
        eq(collections.userId, userId),
        eq(collections.deleted, false),
        ...(collectionId ? [eq(collections.id, collectionId)] : []),
        hasItem(match),
        sql`EXISTS (SELECT 1 FROM releases WHERE releases.id = ${releaseId} AND releases.user_id = ${userId} AND releases.deleted = 1)`
      )
    );
}

/** Drop items naming any of the user's tombstoned releases from one collection just written at `version`. */
export function pruneTombstonedItems(db: Db, userId: string, collectionId: string, version: SQL<number>) {
  const match = sql`json_extract(value, '$.releaseId') IN (SELECT releases.id FROM releases WHERE releases.user_id = ${userId} AND releases.deleted = 1)`;
  return db
    .update(collections)
    .set({ record: sql`json_set(${collections.record}, '$.items', json(${itemsWithout(match)}))` })
    .where(and(eq(collections.id, collectionId), eq(collections.userId, userId), eq(collections.version, version), hasItem(match)));
}
