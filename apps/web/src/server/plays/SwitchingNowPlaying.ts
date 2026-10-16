import type { SettingsStore } from "../config/SettingsStore";
import { LOCAL_ID_PREFIX } from "./PlayCounter";
import { SpotifyApiError } from "../spotify/SpotifyClient";
import type { NowPlayingResult, SpotifyNowPlaying } from "./SpotifyNowPlaying";

/** How long the Web API is left alone after a failure, at least. */
export const WEB_API_HOLD_OFF_SEC = 60;

/**
 * One source at a time (#228). While Spotify is connected and "Count plays on my other devices" is
 * on, the Web API is read (it sees every device, this Mac included, so a play never counts twice).
 * Otherwise, or after any Web API failure, this Mac's Spotify app is read through AppleScript.
 * A failure holds the Web API off for 60 s (longer for a 429 with a longer Retry-After).
 */
export class SwitchingNowPlaying implements SpotifyNowPlaying {
  private holdOffUntil = 0;
  private source: "account" | "this-mac" = "this-mac";
  private failing = false;
  private loggedStreak = false;

  constructor(
    private readonly deps: {
      web: SpotifyNowPlaying;
      appleScript: SpotifyNowPlaying;
      settings: Pick<SettingsStore, "get">;
      now?: () => number;
    },
  ) {}

  currentSource(): "account" | "this-mac" {
    return this.source;
  }

  /** True while the account source failed and this Mac's app is read instead. */
  fallingBack(): boolean {
    return this.failing;
  }

  async read(): Promise<NowPlayingResult> {
    const now = (this.deps.now ?? Date.now)();
    const settings = await this.deps.settings.get();
    const wanted = settings.spotify !== undefined && settings.countOtherDevices === true;
    if (!wanted) {
      this.source = "this-mac";
      this.failing = false;
      this.loggedStreak = false;
      this.holdOffUntil = 0;
      return this.deps.appleScript.read();
    }
    if (now < this.holdOffUntil) {
      this.source = "this-mac";
      return this.duringFallback();
    }
    try {
      const result = await this.deps.web.read();
      this.source = "account";
      this.failing = false;
      this.loggedStreak = false;
      return result;
    } catch (err) {
      const retryAfter = err instanceof SpotifyApiError && err.code === "rateLimited" ? (err.retryAfterSec ?? 0) : 0;
      // From when the failure arrived, not when the request began: a slow failure mustn't shorten it.
      const failedAt = (this.deps.now ?? Date.now)();
      this.holdOffUntil = failedAt + Math.max(WEB_API_HOLD_OFF_SEC, retryAfter) * 1000;
      this.source = "this-mac";
      this.failing = true;
      if (!this.loggedStreak) {
        this.loggedStreak = true;
        // Only the failure kind: never the token or a response body.
        const kind = err instanceof SpotifyApiError ? err.code : "unknown";
        console.warn(`Play tracker could not read the Spotify account (${kind}); counting this Mac only for now.`);
      }
      return this.duringFallback();
    }
  }

  /**
   * While the account is down, this Mac only speaks for the account when it is actively playing a
   * local file (the account plays one thing at a time). Anything else holds the account's session.
   */
  private async duringFallback(): Promise<NowPlayingResult> {
    const result = await this.deps.appleScript.read();
    if (
      "running" in result &&
      result.running &&
      result.state === "playing" &&
      result.id !== null &&
      result.id.startsWith(LOCAL_ID_PREFIX)
    ) {
      return result;
    }
    return { hold: true };
  }
}
