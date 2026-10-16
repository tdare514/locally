import { and, asc, eq, gt, gte, lte, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { devices, playCounts, playDays, releases } from "../../db/schema";
import { inclusiveDays, PLAY_DAY_RETENTION_DAYS, utcDay } from "../../shared/days";
import { ValidationError } from "../../shared/errors";
import {
  PLAYS_SUMMARY_PAGE_SIZE,
  type PlayCountsRequest,
  type PlayCountsResponse,
  type PlaysSummaryResponse,
  type ReleasePlaysResponse,
  type TrackPlays,
} from "../../shared/types";

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
    const tomorrow = utcDay(now, 1);
    const oldest = utcDay(now, -PLAY_DAY_RETENTION_DAYS);
    for (const entry of counts) {
      if (entry.days?.some((d) => d.day > tomorrow)) {
        throw new ValidationError("A day is later than tomorrow (UTC)");
      }
    }
    const countStatements = counts.map((entry) =>
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

    // Day buckets: same rule and same live-release guard, one statement per (entry, day). Days older
    // than the retention window are dropped silently (the daily cleanup would delete them anyway).
    const dayStatements = counts.flatMap((entry) =>
      (entry.days ?? [])
        .filter((d) => d.day >= oldest)
        .map((d) =>
          this.db
            .insert(playDays)
            .select(
              this.db
                .select({
                  userId: sql<string>`${userId}`.as("user_id"),
                  deviceId: sql<string>`${deviceId}`.as("device_id"),
                  releaseId: sql<string>`${releases.id}`.as("release_id"),
                  trackId: sql<string>`${entry.trackId}`.as("track_id"),
                  day: sql<string>`${d.day}`.as("day"),
                  count: sql<number>`${d.count}`.as("count"),
                  updatedAt: sql<number>`${now}`.as("updated_at"),
                })
                .from(releases)
                .where(and(eq(releases.id, entry.releaseId), eq(releases.userId, userId), eq(releases.deleted, false)))
            )
            .onConflictDoUpdate({
              target: [playDays.deviceId, playDays.trackId, playDays.day],
              set: {
                count: sql`max(${playDays.count}, excluded.count)`,
                releaseId: sql`excluded.release_id`,
                updatedAt: sql`excluded.updated_at`,
              },
              setWhere: eq(playDays.userId, userId),
            })
            .returning({ trackId: playDays.trackId })
        )
    );

    const statements = [...countStatements, ...dayStatements];
    const results = await this.db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
    const accepted = results.slice(0, counts.length).reduce((sum, rows) => sum + rows.length, 0);
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

  /**
   * Library-wide plays for the live releases of `userId` (`GET /v1/plays/summary`). `tracks` sums
   * `play_days` over every device (revoked too) for days in [from, to]; `allTime` sums `play_counts`.
   * Paged by track id over the tracks with a live count row or a live day in the range: both lists
   * cover the same page.
   * Throws `ValidationError` for a range that is reversed, over 400 days, or ends after tomorrow (UTC).
   */
  async summary(userId: string, from: string, to: string, cursor?: string): Promise<PlaysSummaryResponse> {
    if (from > to) throw new ValidationError("from must not be after to");
    if (inclusiveDays(from, to) > PLAY_DAY_RETENTION_DAYS) {
      throw new ValidationError(`The range is at most ${PLAY_DAY_RETENTION_DAYS} days`);
    }
    if (to > utcDay(this.now(), 1)) throw new ValidationError("to is later than tomorrow (UTC)");

    const live = and(eq(releases.userId, userId), eq(releases.deleted, false));
    const afterCursor = cursor ? gt(playCounts.trackId, cursor) : undefined;
    const daysAfterCursor = cursor ? gt(playDays.trackId, cursor) : undefined;

    // The page's track ids: tracks with a count row on a live release, or a day in the range on a
    // live release. Both, because a track's count row can sit under a different release from its
    // day rows (the count row follows the latest push), and either release can be tombstoned.
    const idRows = await this.db.all<{ track_id: string }>(sql`
      select track_id from (
        select pc.track_id from play_counts pc join releases r on r.id = pc.release_id
          where pc.user_id = ${userId} and r.user_id = ${userId} and r.deleted = 0
        union
        select pd.track_id from play_days pd join releases r on r.id = pd.release_id
          where pd.user_id = ${userId} and pd.day >= ${from} and pd.day <= ${to}
            and r.user_id = ${userId} and r.deleted = 0
      )
      ${cursor ? sql`where track_id > ${cursor}` : sql``}
      order by track_id
      limit ${PLAYS_SUMMARY_PAGE_SIZE + 1}`);
    const hasMore = idRows.length > PLAYS_SUMMARY_PAGE_SIZE;
    const page = idRows.slice(0, PLAYS_SUMMARY_PAGE_SIZE).map((r) => r.track_id);
    if (page.length === 0) return { tracks: [], allTime: [], nextCursor: null };
    const lastId = page[page.length - 1]!;
    const pageIds = new Set(page);

    const [allTimeRows, dayRows] = await this.db.batch([
      this.db
        .select({
          trackId: playCounts.trackId,
          releaseId: playCounts.releaseId,
          plays: sql<number>`sum(${playCounts.count})`,
        })
        .from(playCounts)
        .innerJoin(releases, eq(releases.id, playCounts.releaseId))
        .where(and(eq(playCounts.userId, userId), live, afterCursor, lte(playCounts.trackId, lastId)))
        .groupBy(playCounts.trackId, playCounts.releaseId)
        .orderBy(asc(playCounts.trackId), asc(playCounts.releaseId)),
      this.db
        .select({
          trackId: playDays.trackId,
          releaseId: playDays.releaseId,
          plays: sql<number>`sum(${playDays.count})`,
          lastPlayedDay: sql<string>`max(case when ${playDays.count} > 0 then ${playDays.day} end)`,
        })
        .from(playDays)
        .innerJoin(releases, eq(releases.id, playDays.releaseId))
        .where(
          and(
            eq(playDays.userId, userId),
            gte(playDays.day, from),
            lte(playDays.day, to),
            daysAfterCursor,
            lte(playDays.trackId, lastId),
            live
          )
        )
        .groupBy(playDays.trackId, playDays.releaseId)
        .having(sql`sum(${playDays.count}) > 0`)
        .orderBy(asc(playDays.trackId), asc(playDays.releaseId)),
    ]);

    return {
      tracks: dayRows
        .filter((r) => pageIds.has(r.trackId))
        .map((r) => ({ trackId: r.trackId, releaseId: r.releaseId, plays: Number(r.plays), lastPlayedDay: r.lastPlayedDay })),
      allTime: allTimeRows.map((r) => ({ trackId: r.trackId, releaseId: r.releaseId, plays: Number(r.plays) })),
      nextCursor: hasMore ? lastId : null,
    };
  }
}
