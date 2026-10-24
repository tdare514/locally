/** A heartbeat older than this means the player is gone (window closed, page reloaded), so nothing is playing. */
export const LOCALLY_PLAYING_TTL_MS = 15_000;

/**
 * Which track Locally's own player is playing right now (#338), as the window last reported it. In memory
 * only: the Spotify tracker reads it to ignore a now-playing read of the same track, so one play is never
 * counted twice. The window refreshes it every few seconds while playing; it lapses by itself.
 */
export class LocallyNowPlaying {
  private current: { trackId: string; at: number } | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  /** The player started or kept playing `trackId`, or (null) stopped. */
  set(trackId: string | null): void {
    this.current = trackId === null ? null : { trackId, at: this.now() };
  }

  /** The track Locally is playing, or null when nothing is or the last report has lapsed. */
  trackId(): string | null {
    if (!this.current) return null;
    if (this.now() - this.current.at > LOCALLY_PLAYING_TTL_MS) {
      this.current = null;
      return null;
    }
    return this.current.trackId;
  }
}
