import type { PlaysStatus, Release, Settings } from "../../shared/types";
import type { SettingsStore } from "../config/SettingsStore";
import type { LibraryRepository } from "../storage/LibraryRepository";
import { resolveLocalTrack } from "./LocalTrackResolver";
import type { PlayCountStore } from "./PlayCountStore";
import { PlayCounter } from "./PlayCounter";
import type { SpotifyNowPlaying } from "./SpotifyNowPlaying";

export const DEFAULT_POLL_INTERVAL_MS = 5000;

/**
 * Polls Spotify while the user has opted in, feeds samples to {@link PlayCounter} and
 * records counted plays of Locally tracks. Only counts are stored; nothing else Spotify
 * reports is kept.
 */
export class PlayTracker {
  private readonly counter = new PlayCounter();
  private enabled = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private lastStatus: Exclude<PlaysStatus, "off"> = "on";
  private warnedAmbiguous = new Set<string>();
  private loggedFailure = false;

  constructor(
    private readonly nowPlaying: SpotifyNowPlaying,
    private readonly settings: Pick<SettingsStore, "get">,
    private readonly library: Pick<LibraryRepository, "list">,
    private readonly store: Pick<PlayCountStore, "increment">,
    private readonly now: () => number = Date.now,
    private readonly intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  ) {}

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.lastStatus = "on";
      this.timer = setInterval(() => void this.poll(), this.intervalMs);
      this.timer.unref?.();
      void this.poll();
    } else {
      this.clearTimer();
    }
  }

  status(): PlaysStatus {
    return this.enabled ? this.lastStatus : "off";
  }

  stop(): void {
    this.enabled = false;
    this.clearTimer();
  }

  /** One poll. Never overlaps with another; exposed for tests. */
  async poll(): Promise<void> {
    if (!this.enabled || this.polling) return;
    this.polling = true;
    try {
      const result = await this.nowPlaying.read();
      if (!this.enabled) return;
      const at = this.now();
      if ("error" in result) {
        this.counter.push({ at, running: false, state: "stopped", id: null, positionSec: 0, durationMs: 0 });
        if (result.error === "permission-denied") {
          this.lastStatus = "permission-denied";
        } else {
          this.lastStatus = "on";
          if (!this.loggedFailure) {
            this.loggedFailure = true;
            console.warn("Play tracker could not read Spotify's current track.");
          }
        }
        return;
      }
      this.loggedFailure = false;
      if (!result.running) {
        this.lastStatus = "spotify-not-running";
        this.counter.push({ at, running: false, state: "stopped", id: null, positionSec: 0, durationMs: 0 });
        return;
      }
      this.lastStatus = "on";
      const counted = this.counter.push({ at, ...result });
      if (counted) await this.record(counted);
    } catch (err) {
      console.warn("Play tracker poll failed:", err instanceof Error ? err.message : err);
    } finally {
      this.polling = false;
    }
  }

  private async record(spotifyId: string): Promise<void> {
    const settings: Settings = await this.settings.get();
    const releases: Release[] = await this.library.list(settings.libraryDir);
    const resolved = resolveLocalTrack(spotifyId, releases);
    if (resolved.kind === "match") {
      await this.store.increment(resolved.trackId, resolved.releaseId);
    } else if (resolved.kind === "ambiguous" && !this.warnedAmbiguous.has(spotifyId)) {
      this.warnedAmbiguous.add(spotifyId);
      console.warn("Play tracker: a Spotify local file matches more than one Locally track; not counted.");
    }
  }

  private clearTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
