import { and, desc, eq, lte, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "../../db/client";
import { playCounts, playDays, playEvents, releases, samplerLease, spotifyLinks } from "../../db/schema";
import { MAX_EVENT_LISTENED_MS, type PlayEventInput, type ReleaseRecord } from "../../shared/types";
import { ensureCloudDevice } from "./CloudDevice";
import { PlayEventsService } from "../plays/PlayEventsService";
import { countSample, continuesSession, needsResolve, type LocalIds, type SessionState } from "./CloudPlayCounter";
import { sessionEventId } from "./PlayEventId";
import { resolveLocalTrack } from "./LocalTrackResolver";
import type { SpotifyLinkRow, SpotifyPlayerClient } from "./SpotifyPlayerClient";

export const SAMPLER_LEASE_MS = 50_000;
/** How long the caller should wait before the next run: short while anything plays, longer otherwise. */
export const ACTIVE_INTERVAL_MS = 10_000;
export const IDLE_INTERVAL_MS = 30_000;
export const SAMPLER_CONCURRENCY = 25;
/** A user is skipped this close to the lease's expiry: too late to write safely. */
const LEASE_MARGIN_MS = 5_000;
const LEASE_ID = "spotify-sampler";
/** A later sample raises the session's event only when `listenedMs` has grown by this much since the last write (or when the session ends). */
export const EVENT_STEP_MS = 30_000;
const STOPPING_PROBLEMS = new Set(["reconnect", "notOnTesterList"]);

export interface SampleRunResult {
  sampled: number;
  counted: number;
  skipped: boolean;
  /** Milliseconds until the caller should call again. */
  nextInMs: number;
}

/** The calendar date, `YYYY-MM-DD`, that `ms` falls on in `timeZone` (as the Mac's `localDay`). */
export function localDay(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`;
}

function sessionOf(link: SpotifyLinkRow): SessionState | null {
  if (
    link.sessionUri === null ||
    link.sessionReleaseId === null ||
    link.sessionTrackId === null ||
    link.sessionProgressMs === null ||
    link.sessionAt === null
  ) {
    return null;
  }
  return {
    uri: link.sessionUri,
    releaseId: link.sessionReleaseId,
    trackId: link.sessionTrackId,
    progressMs: link.sessionProgressMs,
    durationMs: link.sessionDurationMs,
    at: link.sessionAt,
    counted: link.sessionCounted === true,
  };
}

/**
 * One run of the sampler (#303 §3), called every 10 s while anything plays and every 30 s otherwise: takes a 50 s lease, reads each linked user's player,
 * applies the counting rule and writes the result. Replies carry numbers only, and nothing about a track
 * (uri, title or id) is ever logged.
 */
export class SpotifySampler {
  private readonly events: PlayEventsService;

  constructor(
    private readonly db: Db,
    private readonly player: SpotifyPlayerClient,
    private readonly now: () => number = () => Date.now()
  ) {
    this.events = new PlayEventsService(db, now);
  }

  async run(): Promise<SampleRunResult> {
    const leaseUntil = await this.takeLease();
    if (leaseUntil === null) return { sampled: 0, counted: 0, skipped: true, nextInMs: ACTIVE_INTERVAL_MS };

    try {
      return await this.sampleAll(leaseUntil);
    } finally {
      // Release the lease so a trigger that fires a few seconds early is not skipped. The 50 s expiry stays
      // as the safety net for a run that crashes before this line.
      await this.releaseLease(leaseUntil).catch(() => undefined);
    }
  }

  private async sampleAll(leaseUntil: number): Promise<SampleRunResult> {
    const links = (await this.db.select().from(spotifyLinks)).filter(
      (link) => !(link.problem && STOPPING_PROBLEMS.has(link.problem)) && (link.backoffUntil === null || link.backoffUntil <= this.now())
    );
    let sampled = 0;
    let counted = 0;
    let playing = false;
    let next = 0;
    const worker = async () => {
      while (next < links.length) {
        const link = links[next++]!;
        try {
          const outcome = await this.sampleUser(link, leaseUntil);
          if (outcome) {
            sampled += 1;
            if (outcome.counted) counted += 1;
            if (outcome.playing) playing = true;
          }
        } catch (err) {
          // The message is left out on purpose: a failed query can carry its parameters (a track uri).
          console.error(JSON.stringify({ level: "error", event: "spotify_sample_failed", error: err instanceof Error ? err.name : "unknown" }));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SAMPLER_CONCURRENCY, links.length) }, worker));
    return { sampled, counted, skipped: false, nextInMs: playing ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS };
  }

  /** Clears the lease only while it is still this run's: a newer holder's `until` is never touched. */
  private async releaseLease(leaseUntil: number): Promise<void> {
    await this.db
      .update(samplerLease)
      .set({ until: this.now() })
      .where(and(eq(samplerLease.id, LEASE_ID), eq(samplerLease.until, leaseUntil)));
  }

  /** `until` <= now → now + 50 s, in one statement. Returns the `until` written (this run's fencing token), or null when another run holds the lease. */
  private async takeLease(): Promise<number | null> {
    const now = this.now();
    const until = now + SAMPLER_LEASE_MS;
    const rows = await this.db
      .insert(samplerLease)
      .values({ id: LEASE_ID, until })
      .onConflictDoUpdate({ target: samplerLease.id, set: { until }, setWhere: lte(samplerLease.until, now) })
      .returning({ id: samplerLease.id });
    return rows.length > 0 ? until : null;
  }

  /** True only while the lease row still holds this run's `until`; ANDed into every write so a run whose lease was taken writes nothing. */
  private holdsLease(leaseUntil: number) {
    return sql`exists (select 1 from ${samplerLease} where ${samplerLease.id} = ${LEASE_ID} and ${samplerLease.until} = ${leaseUntil})`;
  }

  /** Null when the user was skipped (a problem, a back-off or a failed read): nothing was changed or counted. */
  private async sampleUser(link: SpotifyLinkRow, leaseUntil: number): Promise<{ counted: boolean; playing: boolean } | null> {
    const result = await this.player.read(link);
    if (result.kind !== "ok") return null;

    const at = this.now();
    if (at >= leaseUntil - LEASE_MARGIN_MS) return null;
    const prev = sessionOf(link);
    const sample = result.sample;
    let ids: LocalIds | null = null;
    if (sample.kind === "item" && sample.uri !== null && needsResolve(prev, sample)) {
      ids = await this.resolve(link.userId, sample.uri);
    }
    const outcome = countSample(prev, sample, at, ids);
    const next = outcome.next;

    const statements: BatchItem<"sqlite">[] = [
      this.db
        .update(spotifyLinks)
        .set({
          lastSampleAt: at,
          ...(link.problem === "rateLimited" ? { problem: null } : {}),
          backoffUntil: null,
          sessionUri: next?.uri ?? null,
          sessionReleaseId: next?.releaseId ?? null,
          sessionTrackId: next?.trackId ?? null,
          sessionProgressMs: next?.progressMs ?? null,
          sessionDurationMs: next?.durationMs ?? null,
          sessionAt: next?.at ?? null,
          sessionCounted: next ? next.counted : null,
        })
        .where(and(eq(spotifyLinks.userId, link.userId), this.holdsLease(leaseUntil))),
    ];

    // The event of an already counted session, raised by a later sample or finished when the session ends (#396).
    if (prev?.counted && sample.kind === "item" && link.cloudDeviceId !== null) {
      const continues = next !== null && next.uri === prev.uri && continuesSession(prev, sample.progressMs, at);
      const progress = continues ? sample.progressMs : prev.progressMs;
      const raise = await this.raiseStatement(link.userId, link.cloudDeviceId, prev, progress, continues, at, leaseUntil);
      if (raise) statements.push(...(raise as unknown as BatchItem<"sqlite">[]));
    }

    if (outcome.counted && next && sample.kind === "item") {
      const deviceId = await ensureCloudDevice(this.db, link.userId, link.cloudDeviceId, at);
      const day = localDay(at, link.timeZone);
      statements.push(...this.countStatements(link.userId, deviceId, next, day, at, leaseUntil));
      const startedAt = Math.max(0, at - sample.progressMs);
      statements.push(
        this.events.upsertStatement(
          link.userId,
          deviceId,
          {
            id: sessionEventId(link.userId, next.trackId, startedAt),
            releaseId: next.releaseId,
            trackId: next.trackId,
            source: "spotify",
            startedAt,
            day,
            listenedMs: Math.min(sample.progressMs, MAX_EVENT_LISTENED_MS),
          },
          at,
          this.holdsLease(leaseUntil)
        )
      );
    }
    await this.db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    return { counted: outcome.counted, playing: sample.kind === "item" && sample.isPlaying };
  }

  /**
   * The upsert (in a one-item array) that raises a counted session's event to `progressMs`, or null when nothing is due. The event
   * is found by its row (the newest spotify event for this track on the cloud device), whose stored
   * `listenedMs` is the last written value, so no extra session state is kept: while the session continues a
   * write is due once it has grown by `EVENT_STEP_MS`, and when it ends, once it has grown at all.
   */
  private async raiseStatement(userId: string, deviceId: string, session: SessionState, progressMs: number, continues: boolean, now: number, leaseUntil: number) {
    const [row] = await this.db
      .select()
      .from(playEvents)
      .where(
        and(
          eq(playEvents.userId, userId),
          eq(playEvents.deviceId, deviceId),
          eq(playEvents.trackId, session.trackId),
          eq(playEvents.source, "spotify")
        )
      )
      .orderBy(desc(playEvents.startedAt))
      .limit(1);
    const listenedMs = Math.min(progressMs, MAX_EVENT_LISTENED_MS);
    if (!row || listenedMs - row.listenedMs < (continues ? EVENT_STEP_MS : 1)) return null;
    const event: PlayEventInput = {
      id: row.id,
      releaseId: row.releaseId,
      trackId: row.trackId,
      source: "spotify",
      startedAt: row.startedAt,
      day: row.day,
      listenedMs,
    };
    // Wrapped: a query builder is thenable, so returning it bare from an async function would run it.
    return [this.events.upsertStatement(userId, deviceId, event, now, this.holdsLease(leaseUntil))];
  }

  private async resolve(userId: string, uri: string): Promise<LocalIds | null> {
    const rows = await this.db
      .select({ record: releases.record })
      .from(releases)
      .where(and(eq(releases.userId, userId), eq(releases.deleted, false)));
    const result = resolveLocalTrack(uri, rows.map((r) => r.record as ReleaseRecord));
    return result.kind === "match" ? { releaseId: result.releaseId, trackId: result.trackId } : null;
  }

  /** +1 on the cloud device's `play_counts` row and today's `play_days` row, guarded to a live release of the user. */
  private countStatements(userId: string, deviceId: string, session: SessionState, day: string, now: number, leaseUntil: number) {
    const liveRelease = and(
      eq(releases.id, session.releaseId),
      eq(releases.userId, userId),
      eq(releases.deleted, false),
      this.holdsLease(leaseUntil)
    );
    const count = this.db
      .insert(playCounts)
      .select(
        this.db
          .select({
            userId: sql<string>`${userId}`.as("user_id"),
            deviceId: sql<string>`${deviceId}`.as("device_id"),
            releaseId: sql<string>`${releases.id}`.as("release_id"),
            trackId: sql<string>`${session.trackId}`.as("track_id"),
            source: sql<string>`${"spotify"}`.as("source"),
            count: sql<number>`1`.as("count"),
            updatedAt: sql<number>`${now}`.as("updated_at"),
          })
          .from(releases)
          .where(liveRelease)
      )
      .onConflictDoUpdate({
        target: [playCounts.deviceId, playCounts.trackId, playCounts.source],
        set: {
          count: sql`${playCounts.count} + 1`,
          releaseId: sql`excluded.release_id`,
          updatedAt: sql`excluded.updated_at`,
        },
        setWhere: eq(playCounts.userId, userId),
      });
    const dayRow = this.db
      .insert(playDays)
      .select(
        this.db
          .select({
            userId: sql<string>`${userId}`.as("user_id"),
            deviceId: sql<string>`${deviceId}`.as("device_id"),
            releaseId: sql<string>`${releases.id}`.as("release_id"),
            trackId: sql<string>`${session.trackId}`.as("track_id"),
            day: sql<string>`${day}`.as("day"),
            source: sql<string>`${"spotify"}`.as("source"),
            count: sql<number>`1`.as("count"),
            updatedAt: sql<number>`${now}`.as("updated_at"),
          })
          .from(releases)
          .where(liveRelease)
      )
      .onConflictDoUpdate({
        target: [playDays.deviceId, playDays.trackId, playDays.source, playDays.day],
        set: {
          count: sql`${playDays.count} + 1`,
          releaseId: sql`excluded.release_id`,
          updatedAt: sql`excluded.updated_at`,
        },
        setWhere: eq(playDays.userId, userId),
      });
    return [count, dayRow];
  }
}
