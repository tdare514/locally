import { and, eq, lte, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "../../db/client";
import { playCounts, playDays, releases, samplerLease, spotifyLinks } from "../../db/schema";
import type { ReleaseRecord } from "../../shared/types";
import { ensureCloudDevice } from "./CloudDevice";
import { countSample, needsResolve, type LocalIds, type SessionState } from "./CloudPlayCounter";
import { resolveLocalTrack } from "./LocalTrackResolver";
import type { SpotifyLinkRow, SpotifyPlayerClient } from "./SpotifyPlayerClient";

export const SAMPLER_LEASE_MS = 50_000;
export const SAMPLER_CONCURRENCY = 25;
const LEASE_ID = "spotify-sampler";
const STOPPING_PROBLEMS = new Set(["reconnect", "notOnTesterList"]);

export interface SampleRunResult {
  sampled: number;
  counted: number;
  skipped: boolean;
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
 * One run of the every-minute sampler (#303 §3): takes a 50 s lease, reads each linked user's player,
 * applies the counting rule and writes the result. Replies carry numbers only, and nothing about a track
 * (uri, title or id) is ever logged.
 */
export class SpotifySampler {
  constructor(
    private readonly db: Db,
    private readonly player: SpotifyPlayerClient,
    private readonly now: () => number = () => Date.now()
  ) {}

  async run(): Promise<SampleRunResult> {
    if (!(await this.takeLease())) return { sampled: 0, counted: 0, skipped: true };

    try {
      return await this.sampleAll();
    } finally {
      // Release the lease so a trigger that fires a few seconds early is not skipped. The 50 s expiry stays
      // as the safety net for a run that crashes before this line.
      await this.releaseLease().catch(() => undefined);
    }
  }

  private async sampleAll(): Promise<SampleRunResult> {
    const links = (await this.db.select().from(spotifyLinks)).filter(
      (link) => !(link.problem && STOPPING_PROBLEMS.has(link.problem)) && (link.backoffUntil === null || link.backoffUntil <= this.now())
    );
    let sampled = 0;
    let counted = 0;
    let next = 0;
    const worker = async () => {
      while (next < links.length) {
        const link = links[next++]!;
        try {
          const outcome = await this.sampleUser(link);
          if (outcome) {
            sampled += 1;
            if (outcome.counted) counted += 1;
          }
        } catch (err) {
          // The message is left out on purpose: a failed query can carry its parameters (a track uri).
          console.error(JSON.stringify({ level: "error", event: "spotify_sample_failed", error: err instanceof Error ? err.name : "unknown" }));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SAMPLER_CONCURRENCY, links.length) }, worker));
    return { sampled, counted, skipped: false };
  }

  private async releaseLease(): Promise<void> {
    await this.db.update(samplerLease).set({ until: this.now() }).where(eq(samplerLease.id, LEASE_ID));
  }

  /** `until` <= now → now + 50 s, in one statement; a row comes back only when this run took the lease. */
  private async takeLease(): Promise<boolean> {
    const now = this.now();
    const rows = await this.db
      .insert(samplerLease)
      .values({ id: LEASE_ID, until: now + SAMPLER_LEASE_MS })
      .onConflictDoUpdate({ target: samplerLease.id, set: { until: now + SAMPLER_LEASE_MS }, setWhere: lte(samplerLease.until, now) })
      .returning({ id: samplerLease.id });
    return rows.length > 0;
  }

  /** Null when the user was skipped (a problem, a back-off or a failed read): nothing was changed or counted. */
  private async sampleUser(link: SpotifyLinkRow): Promise<{ counted: boolean } | null> {
    const result = await this.player.read(link);
    if (result.kind !== "ok") return null;

    const at = this.now();
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
        .where(eq(spotifyLinks.userId, link.userId)),
    ];

    if (outcome.counted && next) {
      const deviceId = await ensureCloudDevice(this.db, link.userId, link.cloudDeviceId, at);
      statements.push(...this.countStatements(link.userId, deviceId, next, localDay(at, link.timeZone), at));
    }
    await this.db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    return { counted: outcome.counted };
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
  private countStatements(userId: string, deviceId: string, session: SessionState, day: string, now: number) {
    const liveRelease = and(eq(releases.id, session.releaseId), eq(releases.userId, userId), eq(releases.deleted, false));
    const count = this.db
      .insert(playCounts)
      .select(
        this.db
          .select({
            userId: sql<string>`${userId}`.as("user_id"),
            deviceId: sql<string>`${deviceId}`.as("device_id"),
            releaseId: sql<string>`${releases.id}`.as("release_id"),
            trackId: sql<string>`${session.trackId}`.as("track_id"),
            count: sql<number>`1`.as("count"),
            updatedAt: sql<number>`${now}`.as("updated_at"),
          })
          .from(releases)
          .where(liveRelease)
      )
      .onConflictDoUpdate({
        target: [playCounts.deviceId, playCounts.trackId],
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
            count: sql<number>`1`.as("count"),
            updatedAt: sql<number>`${now}`.as("updated_at"),
          })
          .from(releases)
          .where(liveRelease)
      )
      .onConflictDoUpdate({
        target: [playDays.deviceId, playDays.trackId, playDays.day],
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
