import { and, asc, eq, gt, gte, lte, sql, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client";
import { devices, playCounts, playDays, playEvents, releases } from "../../db/schema";
import { inclusiveDays, PLAY_DAY_RETENTION_DAYS, utcDay } from "../../shared/days";
import { ValidationError } from "../../shared/errors";
import {
  PLAYS_SUMMARY_PAGE_SIZE,
  type PlayCountsRequest,
  type PlayEventTotals,
  type PlayCountsResponse,
  type PlaysSummaryResponse,
  type ReleasePlaysResponse,
  type TrackPlays,
} from "../../shared/types";

const NO_EVENTS: PlayEventTotals = { lastPlayedAt: null, listenedMs: 0, events: 0 };

function eventTotalsByKey(
  rows: Array<{ trackId: string; releaseId: string; lastPlayedAt: number; listenedMs: number; events: number }>
): Map<string, PlayEventTotals> {
  return new Map(
    rows.map((r) => [
      `${r.trackId}/${r.releaseId}`,
      { lastPlayedAt: Number(r.lastPlayedAt), listenedMs: Number(r.listenedMs), events: Number(r.events) },
    ])
  );
}

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
   * Store `max(stored, sent)` for each (device, track, source); `source` defaults to `spotify` (#340). One `db.batch`, one
   * statement per entry: `INSERT ... SELECT ... FROM releases WHERE id = ? AND
   * user_id = ? AND deleted = 0 ON CONFLICT (device_id, track_id, source) DO UPDATE`,
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
    const countStatements = counts.map((entry) => {
      const source = entry.source ?? "spotify";
      return this.db
        .insert(playCounts)
        .select(
          this.db
            .select({
              userId: sql<string>`${userId}`.as("user_id"),
              deviceId: sql<string>`${deviceId}`.as("device_id"),
              releaseId: sql<string>`${releases.id}`.as("release_id"),
              trackId: sql<string>`${entry.trackId}`.as("track_id"),
              source: sql<string>`${source}`.as("source"),
              count: sql<number>`${entry.count}`.as("count"),
              updatedAt: sql<number>`${now}`.as("updated_at"),
            })
            .from(releases)
            .where(and(eq(releases.id, entry.releaseId), eq(releases.userId, userId), eq(releases.deleted, false)))
        )
        .onConflictDoUpdate({
          target: [playCounts.deviceId, playCounts.trackId, playCounts.source],
          set: {
            count: sql`max(${playCounts.count}, excluded.count)`,
            releaseId: sql`excluded.release_id`,
            updatedAt: sql`excluded.updated_at`,
          },
          setWhere: eq(playCounts.userId, userId),
        })
        .returning({ trackId: playCounts.trackId });
    });

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
                  source: sql<string>`${entry.source ?? "spotify"}`.as("source"),
                  count: sql<number>`${d.count}`.as("count"),
                  updatedAt: sql<number>`${now}`.as("updated_at"),
                })
                .from(releases)
                .where(and(eq(releases.id, entry.releaseId), eq(releases.userId, userId), eq(releases.deleted, false)))
            )
            .onConflictDoUpdate({
              target: [playDays.deviceId, playDays.trackId, playDays.source, playDays.day],
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
          count: sql<number>`sum(${playCounts.count})`,
        })
        .from(playCounts)
        .innerJoin(devices, and(eq(devices.id, playCounts.deviceId), eq(devices.userId, userId)))
        .where(and(eq(playCounts.userId, userId), eq(playCounts.releaseId, releaseId)))
        .groupBy(playCounts.trackId, playCounts.deviceId, devices.name, devices.platform)
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
      const count = Number(row.count);
      track.total += count;
      track.devices.push({
        deviceId: row.deviceId,
        name: row.name,
        platform: row.platform,
        count,
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
   * Each entry also carries `devicePlays`: the share of `deviceId` (the caller) in the same sum, so
   * a client can tell its own plays from the other devices' (#216). Other devices, revoked or not, count
   * toward `plays` only.
   * Throws `ValidationError` for a range that is reversed, over 400 days, or ends after tomorrow (UTC).
   */
  async summary(userId: string, deviceId: string, from: string, to: string, cursor?: string): Promise<PlaysSummaryResponse> {
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

    const [allTimeRows, dayRows, windowEventRows, allEventRows] = await this.db.batch([
      this.db
        .select({
          trackId: playCounts.trackId,
          releaseId: playCounts.releaseId,
          plays: sql<number>`sum(${playCounts.count})`,
          devicePlays: sql<number>`sum(case when ${playCounts.deviceId} = ${deviceId} then ${playCounts.count} else 0 end)`,
          spotifyPlays: sql<number>`sum(case when ${playCounts.source} = 'spotify' then ${playCounts.count} else 0 end)`,
          locallyPlays: sql<number>`sum(case when ${playCounts.source} = 'locally' then ${playCounts.count} else 0 end)`,
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
          devicePlays: sql<number>`sum(case when ${playDays.deviceId} = ${deviceId} then ${playDays.count} else 0 end)`,
          spotifyPlays: sql<number>`sum(case when ${playDays.source} = 'spotify' then ${playDays.count} else 0 end)`,
          locallyPlays: sql<number>`sum(case when ${playDays.source} = 'locally' then ${playDays.count} else 0 end)`,
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
      // Events (#368): per (track, release), those with a `day` in the window, then all retained ones.
      this.eventTotals(userId, live, cursor, lastId, from, to),
      this.eventTotals(userId, live, cursor, lastId),
    ]);
    const windowEvents = eventTotalsByKey(windowEventRows);
    const allEvents = eventTotalsByKey(allEventRows);

    return {
      tracks: dayRows
        .filter((r) => pageIds.has(r.trackId))
        .map((r) => ({
          trackId: r.trackId,
          releaseId: r.releaseId,
          plays: Number(r.plays),
          devicePlays: Number(r.devicePlays),
          lastPlayedDay: r.lastPlayedDay,
          bySource: { spotify: Number(r.spotifyPlays), locally: Number(r.locallyPlays) },
          ...(windowEvents.get(`${r.trackId}/${r.releaseId}`) ?? NO_EVENTS),
        })),
      allTime: allTimeRows.map((r) => ({
        trackId: r.trackId,
        releaseId: r.releaseId,
        plays: Number(r.plays),
        devicePlays: Number(r.devicePlays),
        bySource: { spotify: Number(r.spotifyPlays), locally: Number(r.locallyPlays) },
        ...(allEvents.get(`${r.trackId}/${r.releaseId}`) ?? NO_EVENTS),
      })),
      nextCursor: hasMore ? lastId : null,
    };
  }

  /** Per (track, release) event totals for live releases of `userId` on one summary page; `from`/`to` limit by `day`. */
  private eventTotals(userId: string, live: SQL | undefined, cursor: string | undefined, lastId: string, from?: string, to?: string) {
    return this.db
      .select({
        trackId: playEvents.trackId,
        releaseId: playEvents.releaseId,
        lastPlayedAt: sql<number>`max(${playEvents.startedAt})`,
        listenedMs: sql<number>`sum(${playEvents.listenedMs})`,
        events: sql<number>`count(*)`,
      })
      .from(playEvents)
      .innerJoin(releases, eq(releases.id, playEvents.releaseId))
      .where(
        and(
          eq(playEvents.userId, userId),
          live,
          from === undefined ? undefined : gte(playEvents.day, from),
          to === undefined ? undefined : lte(playEvents.day, to),
          cursor ? gt(playEvents.trackId, cursor) : undefined,
          lte(playEvents.trackId, lastId)
        )
      )
      .groupBy(playEvents.trackId, playEvents.releaseId);
  }
}
