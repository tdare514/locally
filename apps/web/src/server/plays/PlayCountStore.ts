export interface PlayCountEntry {
  releaseId: string;
  /** Plays counted on this Mac. */
  count: number;
  /** How many of `count` the sync service has been sent and accepted (#107). */
  pushed: number;
}

export interface PlayCounts {
  version: 1;
  tracks: Record<string, PlayCountEntry>;
}

/** Persists per-track play counts counted on this Mac. */
export interface PlayCountStore {
  get(): Promise<PlayCounts>;
  /** Add one play for a track. */
  increment(trackId: string, releaseId: string): Promise<void>;
  /** Drop every entry belonging to a release (it was deleted locally). */
  removeRelease(releaseId: string): Promise<void>;
  /** Changes every time `resetPushed` runs. A push reads it before it sends and hands it back to
   * `markPushed`, so a sign-out in between is noticed. */
  pushedEpoch(): number;
  /** Record that the sync service accepted these counts (trackId -> count sent). A marker only
   * moves up, a track that has since been dropped is ignored, and a stale `epoch` (a reset ran
   * since the push began, so the account it went to is gone) changes nothing. */
  markPushed(sent: Record<string, number>, epoch: number): Promise<void>;
  /** Forget what was pushed, on sign-out or account deletion: counts stay, every one is pending again. */
  resetPushed(): Promise<void>;
}

export function emptyPlayCounts(): PlayCounts {
  return { version: 1, tracks: {} };
}
