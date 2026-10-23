import { inArray } from "drizzle-orm";
import type { Db } from "../../db/client";
import { shares } from "../../db/schema";

/**
 * `rootIds` plus every share below them (children, grandchildren, ...). A reshare chain is at most
 * `MAX_SHARE_DEPTH` deep, so this walks a few levels; the `seen` set also stops it on any cycle.
 */
export async function shareTreeIds(db: Db, rootIds: string[]): Promise<string[]> {
  const seen = new Set(rootIds);
  let frontier = [...rootIds];
  while (frontier.length > 0) {
    const children = await db.select({ id: shares.id }).from(shares).where(inArray(shares.parentShareId, frontier));
    frontier = children.map((c) => c.id).filter((id) => !seen.has(id));
    for (const id of frontier) seen.add(id);
  }
  return [...seen];
}
