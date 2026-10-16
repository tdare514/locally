export interface PlayCountEntry {
  releaseId: string;
  /** Plays counted on this Mac. */
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
  /** Add one play for a track: to its all-time count and to the bucket for `day` (`YYYY-MM-DD`, local to the Mac). */
  increment(trackId: string, releaseId: string, day: string): Promise<void>;
  /** Drop every entry belonging to a release (it was deleted locally). */
  removeRelease(releaseId: string): Promise<void>;
  /** Changes every time `resetPushed` runs. A push reads it before it sends and hands it back to
   * `markPushed`, so a sign-out in between is noticed. */
  pushedEpoch(): number;
  /** Record that the sync service accepted these counts (trackId -> count sent). A marker only
   * moves up, a track that has since been dropped is ignored, and a stale `epoch` (a reset ran
   * since the push began, so the account it went to is gone) changes nothing. `sentDays` (trackId ->
   * day -> count sent) records the day buckets the same way (#202). */
  markPushed(sent: Record<string, number>, epoch: number, sentDays?: Record<string, Record<string, number>>): Promise<void>;
  /** Record that a days push pass ran to completion (#202); a stale `epoch` changes nothing. */
  markDaysInSync(epoch: number): Promise<void>;
  /** Forget what was pushed, on sign-out or account deletion: counts stay, every one is pending again.
   * Also clears every day marker and `daysInSync` (#202). */
  resetPushed(): Promise<void>;
}

export function emptyPlayCounts(): PlayCounts {
  return { version: 1, tracks: {} };
}
