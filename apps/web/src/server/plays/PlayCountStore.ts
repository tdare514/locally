/** Where a play was counted: Spotify's desktop app, or Locally's own player (#338). */
export type PlaySource = "spotify" | "locally";

/** The counts of one source of one track: the same four fields an entry has always carried. */
export interface SourceCounts {
  count: number;
  pushed: number;
  days?: Record<string, number>;
  pushedDays?: Record<string, number>;
}

export interface PlayCountEntry {
  releaseId: string;
  /** Plays counted on this Mac, in Spotify. A `plays.json` from before sources (#338) holds only these. */
  count: number;
  /** How many of `count` the sync service has been sent and accepted (#107). */
  pushed: number;
  /**
   * Plays per local calendar day, `YYYY-MM-DD` in this Mac's time zone at play time, kept for 400
   * days (#200). Absent in files written before it and for plays counted before it, so the sum can
   * be below `count`. Pushed to the sync service since #202 (changed days only).
   */
  days?: Record<string, number>;
  /** The value of each day bucket the sync service has accepted (#202). A day missing here is pending. */
  pushedDays?: Record<string, number>;
  /** Plays in Locally's own player (#338), kept apart from the Spotify fields above and pushed with `source: "locally"`. */
  locally?: SourceCounts;
}

/** The sources an entry holds counts for, Spotify first. Locally's only when it has any. */
export function entrySources(entry: PlayCountEntry): { source: PlaySource; counts: SourceCounts }[] {
  const spotify: SourceCounts = { count: entry.count, pushed: entry.pushed, days: entry.days, pushedDays: entry.pushedDays };
  return entry.locally ? [{ source: "spotify", counts: spotify }, { source: "locally", counts: entry.locally }] : [{ source: "spotify", counts: spotify }];
}

/** What the app shows for a track: the plays of every source added together. */
export function totalCount(entry: PlayCountEntry): number {
  return entry.count + (entry.locally?.count ?? 0);
}

/** The day buckets of every source added together, or undefined when there are none. */
export function totalDays(entry: PlayCountEntry): Record<string, number> | undefined {
  if (!entry.locally?.days) return entry.days;
  if (!entry.days) return entry.locally.days;
  const sum = { ...entry.days };
  for (const [day, n] of Object.entries(entry.locally.days)) sum[day] = (sum[day] ?? 0) + n;
  return sum;
}

export interface PlayCounts {
  version: 1;
  tracks: Record<string, PlayCountEntry>;
  /** True once a days push pass has run to completion since the last reset (#202). Absent means false. */
  daysInSync?: boolean;
}

/** Persists per-track play counts counted on this Mac. */
export interface PlayCountStore {
  get(): Promise<PlayCounts>;
  /** Add one play for a track: to its all-time count and to the bucket for `day` (`YYYY-MM-DD`, local to the Mac),
   * under `source` (Spotify when omitted). */
  increment(trackId: string, releaseId: string, day: string, source?: PlaySource): Promise<void>;
  /** Drop every entry belonging to a release (it was deleted locally). */
  removeRelease(releaseId: string): Promise<void>;
  /** Changes every time `resetPushed` runs. A push reads it before it sends and hands it back to
   * `markPushed`, so a sign-out in between is noticed. */
  pushedEpoch(): number;
  /** Record that the sync service accepted these counts (trackId -> count sent). A marker only
   * moves up, a track that has since been dropped is ignored, and a stale `epoch` (a reset ran
   * since the push began, so the account it went to is gone) changes nothing. `sentDays` (trackId ->
   * day -> count sent) records the day buckets the same way (#202). */
  markPushed(
    sent: Record<string, number>,
    epoch: number,
    sentDays?: Record<string, Record<string, number>>,
    source?: PlaySource,
  ): Promise<void>;
  /** Record that a days push pass ran to completion (#202); a stale `epoch` changes nothing. */
  markDaysInSync(epoch: number): Promise<void>;
  /** Forget what was pushed, on sign-out or account deletion: counts stay, every one is pending again.
   * Also clears every day marker and `daysInSync` (#202). */
  resetPushed(): Promise<void>;
}

export function emptyPlayCounts(): PlayCounts {
  return { version: 1, tracks: {} };
}
