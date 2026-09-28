import { sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { rateLimits } from "../../db/schema";
import type { RateLimiter } from "./RateLimiter";

/**
 * Fixed-window rate limiter backed by the `rate_limits` table in the app's
 * own libSQL database, so every Vercel instance (and every route handler
 * within one) consumes the same shared count instead of each keeping its
 * own — the gap `InMemoryRateLimiter` has in a multi-instance deployment.
 *
 * Each key's row is upserted with a single, atomic `INSERT ... ON CONFLICT
 * ... DO UPDATE ... RETURNING` statement: if the existing window has expired
 * (`windowStart` is at or before `now - windowMs`), it resets to a fresh
 * window of one; otherwise it increments the count in place. Doing this in
 * one round trip, rather than a read followed by a write, is what keeps two
 * concurrent requests for the same key from both reading a stale count and
 * both being allowed through.
 *
 * `namespace` is prefixed onto every key so the several `DbRateLimiter`s
 * sharing this one table (one per route/dimension, e.g. "code:email" and
 * "code:ip") never collide on the same row.
 */
export class DbRateLimiter implements RateLimiter {
  constructor(
    private readonly db: Db,
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly namespace: string,
    private readonly now: () => number = () => Date.now()
  ) {}

  async consume(key: string): Promise<boolean> {
    const now = this.now();
    const cutoff = now - this.windowMs;
    const rowKey = `${this.namespace}:${key}`;

    const [row] = await this.db
      .insert(rateLimits)
      .values({ key: rowKey, windowStart: now, count: 1 })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          windowStart: sql`CASE WHEN ${rateLimits.windowStart} <= ${cutoff} THEN ${now} ELSE ${rateLimits.windowStart} END`,
          count: sql`CASE WHEN ${rateLimits.windowStart} <= ${cutoff} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        },
      })
      .returning({ count: rateLimits.count });

    const count = row?.count ?? 1;
    return count <= this.limit;
  }
}
