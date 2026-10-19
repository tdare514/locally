import crypto from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { devices, spotifyLinks } from "../../db/schema";

export const CLOUD_DEVICE_NAME = "Spotify (online)";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The user's "cloud" device (#303 §2): the row `play_counts` is keyed under for plays the sampler counts.
 * Reuses the user's existing cloud row (also after an unlink and re-link), so counts are never split across
 * two rows, and records its id on the link. Its `tokenHash` is the sha256 of 32 random bytes that are
 * thrown away, so no token can ever authenticate as it. `lastSeenAt` moves at most daily.
 */
export async function ensureCloudDevice(db: Db, userId: string, linkedDeviceId: string | null, now: number): Promise<string> {
  const [existing] = await db
    .select({ id: devices.id, lastSeenAt: devices.lastSeenAt })
    .from(devices)
    .where(and(eq(devices.userId, userId), eq(devices.platform, "cloud")))
    .orderBy(asc(devices.createdAt), asc(devices.id))
    .limit(1);

  let id: string;
  if (existing) {
    id = existing.id;
    if (now - existing.lastSeenAt >= DAY_MS) {
      await db.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, id));
    }
  } else {
    id = crypto.randomUUID();
    await db.insert(devices).values({
      id,
      userId,
      name: CLOUD_DEVICE_NAME,
      platform: "cloud",
      tokenHash: crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex"),
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null,
      installId: null,
    });
  }

  if (linkedDeviceId !== id) {
    await db.update(spotifyLinks).set({ cloudDeviceId: id }).where(eq(spotifyLinks.userId, userId));
  }
  return id;
}
