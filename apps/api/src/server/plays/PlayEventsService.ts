import { and, asc, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { devices, playEvents, releases } from "../../db/schema";
import { PLAY_DAY_RETENTION_DAYS, utcDay } from "../../shared/days";
import { ValidationError } from "../../shared/errors";
import {
  MAX_EVENTS_WINDOW_DAYS,
  MAX_PLAY_EVENTS,
  type PlayEventInput,
  type PlayEventsPushResponse,
  type PlayEventsResponse,
} from "../../shared/types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Play events (see `spec/sync.md`, "Play events"). Every query is scoped by the authenticated user; the
 * device is always the token's device. Events never change counts or day buckets.
 */
export class PlayEventsService {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = () => Date.now()
  ) {}

  /**
   * One upsert statement for `event`, for a caller's own `db.batch` or transaction (the sampler, #396). Inserts
   * only when `releaseId` is a live release of `userId`; on a known (user, id) it updates `listened_ms =
   * max(stored, sent)` and `updated_at` only when the device and every fixed field match. `RETURNING` yields a
   * row exactly when the event was written, so zero rows means the event was ignored.
   */
  upsertStatement(userId: string, deviceId: string, event: PlayEventInput, now: number = this.now()) {
    return this.db
      .insert(playEvents)
      .select(
        this.db
          .select({
            userId: sql<string>`${userId}`.as("user_id"),
            id: sql<string>`${event.id}`.as("id"),
            deviceId: sql<string>`${deviceId}`.as("device_id"),
            releaseId: sql<string>`${releases.id}`.as("release_id"),
            trackId: sql<string>`${event.trackId}`.as("track_id"),
            source: sql<string>`${event.source}`.as("source"),
            startedAt: sql<number>`${event.startedAt}`.as("started_at"),
            day: sql<string>`${event.day}`.as("day"),
            listenedMs: sql<number>`${event.listenedMs}`.as("listened_ms"),
            createdAt: sql<number>`${now}`.as("created_at"),
            updatedAt: sql<number>`${now}`.as("updated_at"),
          })
          .from(releases)
          .where(and(eq(releases.id, event.releaseId), eq(releases.userId, userId), eq(releases.deleted, false)))
      )
      .onConflictDoUpdate({
        target: [playEvents.userId, playEvents.id],
        set: {
          listenedMs: sql`max(${playEvents.listenedMs}, excluded.listened_ms)`,
          updatedAt: sql`excluded.updated_at`,
        },
        setWhere: and(
          eq(playEvents.deviceId, deviceId),
          eq(playEvents.releaseId, event.releaseId),
          eq(playEvents.trackId, event.trackId),
          eq(playEvents.source, event.source),
          eq(playEvents.startedAt, event.startedAt),
          eq(playEvents.day, event.day)
        ),
      })
      .returning({ id: playEvents.id });
  }

  /**
   * `PUT /v1/plays/events`. Throws `ValidationError` (nothing applied) for a `startedAt` later than now + 24 h
   * or a `day` later than UTC tomorrow. An event older than 400 days is dropped and counted in `ignored`.
   */
  async push(userId: string, deviceId: string, events: PlayEventInput[]): Promise<PlayEventsPushResponse> {
    const now = this.now();
    const tomorrow = utcDay(now, 1);
    for (const event of events) {
      if (event.startedAt > now + DAY_MS) throw new ValidationError("startedAt is later than 24 hours from now");
      if (event.day > tomorrow) throw new ValidationError("A day is later than tomorrow (UTC)");
    }
    const oldest = now - PLAY_DAY_RETENTION_DAYS * DAY_MS;
    const kept = events.filter((event) => event.startedAt >= oldest);
    if (kept.length === 0) return { accepted: 0, ignored: events.length };

    const statements = kept.map((event) => this.upsertStatement(userId, deviceId, event, now));
    const results = await this.db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
    const accepted = results.reduce((sum, rows) => sum + rows.length, 0);
    return { accepted, ignored: events.length - accepted };
  }

  /**
   * `GET /v1/plays/events`: events of live releases with `from <= startedAt < to`, newest first (`startedAt`
   * descending, then `id`), `MAX_PLAY_EVENTS` a page. Throws `ValidationError` for a bad window or cursor.
   */
  async list(userId: string, currentDeviceId: string, from: number, to: number, cursor?: string): Promise<PlayEventsResponse> {
    if (from > to) throw new ValidationError("from must not be after to");
    if (to - from > MAX_EVENTS_WINDOW_DAYS * DAY_MS) {
      throw new ValidationError(`The window is at most ${MAX_EVENTS_WINDOW_DAYS} days`);
    }
    const position = cursor === undefined ? undefined : decodeCursor(cursor);

    const rows = await this.db
      .select({
        id: playEvents.id,
        releaseId: playEvents.releaseId,
        trackId: playEvents.trackId,
        source: playEvents.source,
        startedAt: playEvents.startedAt,
        day: playEvents.day,
        listenedMs: playEvents.listenedMs,
        deviceId: devices.id,
        deviceName: devices.name,
        devicePlatform: devices.platform,
      })
      .from(playEvents)
      .innerJoin(releases, and(eq(releases.id, playEvents.releaseId), eq(releases.userId, userId), eq(releases.deleted, false)))
      .innerJoin(devices, and(eq(devices.id, playEvents.deviceId), eq(devices.userId, userId)))
      .where(
        and(
          eq(playEvents.userId, userId),
          gte(playEvents.startedAt, from),
          lt(playEvents.startedAt, to),
          position
            ? or(
                lt(playEvents.startedAt, position.startedAt),
                and(eq(playEvents.startedAt, position.startedAt), sql`${playEvents.id} > ${position.id}`)
              )
            : undefined
        )
      )
      .orderBy(desc(playEvents.startedAt), asc(playEvents.id))
      .limit(MAX_PLAY_EVENTS + 1);

    const page = rows.slice(0, MAX_PLAY_EVENTS);
    const last = page[page.length - 1];
    return {
      events: page.map((r) => ({
        id: r.id,
        releaseId: r.releaseId,
        trackId: r.trackId,
        source: r.source === "locally" ? "locally" : "spotify",
        startedAt: r.startedAt,
        day: r.day,
        listenedMs: r.listenedMs,
        device: { id: r.deviceId, name: r.deviceName, platform: r.devicePlatform, current: r.deviceId === currentDeviceId },
      })),
      nextCursor: rows.length > MAX_PLAY_EVENTS && last ? encodeCursor(last.startedAt, last.id) : null,
    };
  }
}

/** Opaque cursor: base64url of the JSON `[startedAt, id]` of the last event served. */
function encodeCursor(startedAt: number, id: string): string {
  return Buffer.from(JSON.stringify([startedAt, id])).toString("base64url");
}

function decodeCursor(cursor: string): { startedAt: number; id: string } {
  const bad = () => new ValidationError("cursor is not valid");
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw bad();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw bad();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== "number" ||
    !Number.isSafeInteger(parsed[0]) ||
    typeof parsed[1] !== "string" ||
    parsed[1].length === 0 ||
    parsed[1].length > 64
  ) {
    throw bad();
  }
  return { startedAt: parsed[0], id: parsed[1] };
}
