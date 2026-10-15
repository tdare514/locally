export interface PlayCountEntry {
  releaseId: string;
  /** Plays counted on this Mac. */
  count: number;
  /** How many of `count` have been pushed to the sync service (used by #107). */
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
}

export function emptyPlayCounts(): PlayCounts {
  return { version: 1, tracks: {} };
}
