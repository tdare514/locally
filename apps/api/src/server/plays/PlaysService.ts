import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { devices, playCounts, releases } from "../../db/schema";
import type { PlayCountsRequest, PlayCountsResponse, ReleasePlaysResponse, TrackPlays } from "../../shared/types";

/**
 * Per-device play counts (see `spec/sync.md`, "Play counts"). Every query is
 * scoped by the authenticated user; the device is always the token's device.
 */
export class PlaysService {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = () => Date.now()
  ) {}

  /**
   * Store `max(stored, sent)` for each (device, track). One `db.batch`, one
   * statement per entry: `INSERT ... SELECT ... FROM releases WHERE id = ? AND
   * user_id = ? AND deleted = 0 ON CONFLICT (device_id, track_id) DO UPDATE`,
   * so an entry for a release that isn't a live release of `userId` inserts
   * nothing. `RETURNING` tells which statements wrote a row: `accepted` is
   * those, `ignored` is the rest.
   */
  async push(userId: string, deviceId: string, counts: PlayCountsRequest["counts"]): Promise<PlayCountsResponse> {
    const now = this.now();
    const statements = counts.map((entry) =>
      this.db
        .insert(playCounts)
        .select(
          this.db
            .select({
              userId: sql<string>`${userId}`.as("user_id"),
              deviceId: sql<string>`${deviceId}`.as("device_id"),
              releaseId: sql<string>`${releases.id}`.as("release_id"),
              trackId: sql<string>`${entry.trackId}`.as("track_id"),
              count: sql<number>`${entry.count}`.as("count"),
              updatedAt: sql<number>`${now}`.as("updated_at"),
            })
            .from(releases)
            .where(and(eq(releases.id, entry.releaseId), eq(releases.userId, userId), eq(releases.deleted, false)))
        )
        .onConflictDoUpdate({
          target: [playCounts.deviceId, playCounts.trackId],
          set: {
            count: sql`max(${playCounts.count}, excluded.count)`,
            releaseId: sql`excluded.release_id`,
            updatedAt: sql`excluded.updated_at`,
          },
          setWhere: eq(playCounts.userId, userId),
        })
        .returning({ trackId: playCounts.trackId })
    );

    const results = await this.db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
    const accepted = results.reduce((sum, rows) => sum + rows.length, 0);
    return { accepted, ignored: counts.length - accepted };
  }

  /**
   * Counts per track for a live release of `userId`, or `null` when it isn't
   * one (the route answers 404). Devices include revoked ones, with their
   * stored name and platform. Ordered by track id, then device name and id.
   */
  async forRelease(userId: string, releaseId: string, requestingDeviceId: string): Promise<ReleasePlaysResponse | null> {
    const [[release], rows] = await this.db.batch([
      this.db
        .select({ id: releases.id })
        .from(releases)
        .where(and(eq(releases.id, releaseId), eq(releases.userId, userId), eq(releases.deleted, false))),
      this.db
        .select({
          trackId: playCounts.trackId,
          deviceId: playCounts.deviceId,
          name: devices.name,
          platform: devices.platform,
          count: playCounts.count,
        })
        .from(playCounts)
        .innerJoin(devices, and(eq(devices.id, playCounts.deviceId), eq(devices.userId, userId)))
        .where(and(eq(playCounts.userId, userId), eq(playCounts.releaseId, releaseId)))
        .orderBy(playCounts.trackId, devices.name, devices.id),
    ]);
    if (!release) return null;

    const tracks: TrackPlays[] = [];
    for (const row of rows) {
      let track = tracks[tracks.length - 1];
      if (!track || track.trackId !== row.trackId) {
        track = { trackId: row.trackId, total: 0, devices: [] };
        tracks.push(track);
      }
      track.total += row.count;
      track.devices.push({
        deviceId: row.deviceId,
        name: row.name,
        platform: row.platform,
        count: row.count,
        current: row.deviceId === requestingDeviceId,
      });
    }
    return { tracks };
  }
}
