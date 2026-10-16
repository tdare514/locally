export type SpotifyPlayerState = "playing" | "paused" | "stopped";

/** What Spotify is doing right now, as read from the desktop app. */
export type NowPlayingSample =
  | { running: false }
  | {
      running: true;
      state: SpotifyPlayerState;
      /** Spotify track URI, or null when there is no current track. */
      id: string | null;
      positionSec: number;
      /** Track length in milliseconds (Spotify reports `duration` in ms), or 0 when unknown. */
      durationMs: number;
    };

export type NowPlayingError = { error: "permission-denied" } | { error: "failed" };

/**
 * `{ hold: true }`: the account source is down and this Mac isn't actively playing a local file, so
 * the sample says nothing about the account's session. The tracker feeds the counter nothing (#228).
 */
export type NowPlayingHold = { hold: true };

export type NowPlayingResult = NowPlayingSample | NowPlayingError | NowPlayingHold;

/**
 * Reads the Spotify desktop app's current track. Behind an interface so tests use a fake
 * instead of running osascript.
 */
export interface SpotifyNowPlaying {
  read(): Promise<NowPlayingResult>;
}
