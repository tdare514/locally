import type { PlaysStatus, Release, Settings } from "../../shared/types";
import type { SettingsStore } from "../config/SettingsStore";
import type { LibraryRepository } from "../storage/LibraryRepository";
import { resolveLocalTrack } from "./LocalTrackResolver";
import type { PlayCountStore } from "./PlayCountStore";
import { MAX_EVENT_LISTENED_MS, type PlayEventStore } from "./PlayEventStore";
import { PlayCounter } from "./PlayCounter";
import { localDay } from "./playDays";
import type { SpotifyNowPlaying } from "./SpotifyNowPlaying";
import type { CloudPlays } from "../spotify/CloudPlays";
import type { LocallyNowPlaying } from "./LocallyNowPlaying";

export const DEFAULT_POLL_INTERVAL_MS = 5000;
/** Poll interval while the last poll found Spotify closed, so an idle app rarely spawns osascript (#162). */
export const IDLE_POLL_INTERVAL_MS = 30_000;
/** Once nothing has played this long, poll at the idle interval until something plays again (#228). */
export const IDLE_AFTER_NOT_PLAYING_MS = 120_000;
/** More audible time a counted Spotify play gathers before its event is written again (#398). */
export const EVENT_STEP_MS = 15_000;

/**
 * Polls Spotify while the user has opted in, feeds samples to {@link PlayCounter} and
 * records counted plays of Locally tracks. Only counts are stored; nothing else Spotify
 * reports is kept.
 */
export class PlayTracker {
  private readonly counter = new PlayCounter();
  private enabled = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private lastStatus: Exclude<PlaysStatus, "off"> = "on";
  private warnedAmbiguous = new Set<string>();
  private loggedFailure = false;
  /** When the run of non-playing samples (paused, stopped, closed, failed) began; null while playing. */
  private notPlayingSince: number | null = null;
  /** True while the sync service counts plays online and this Mac stays out of it (#307). */
  private standDown = false;
  /** The counted play whose event is being raised as samples come in (#398); null when none is. */
  /** The `startedAt` of the restored session `reattach` last looked up, so a track that doesn't resolve isn't looked up every poll. */
  private reattachTried: number | null = null;
  private eventSession: { trackId: string; releaseId: string; startedAt: number; written: number; latest: number } | null = null;

  constructor(
    private readonly nowPlaying: SpotifyNowPlaying,
    private readonly settings: Pick<SettingsStore, "get">,
    private readonly library: Pick<LibraryRepository, "list">,
    private readonly store: Pick<PlayCountStore, "increment">,
    private readonly now: () => number = Date.now,
    private readonly intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
    private readonly idleIntervalMs: number = IDLE_POLL_INTERVAL_MS,
    /** IANA zone the day bucket is taken in; the system zone when omitted (#200). */
    private readonly timeZone?: string,
    /** Online counting (#307): while it is active this tracker reads and counts nothing. */
    private readonly online?: Pick<CloudPlays, "active" | "refreshIfStale">,
    /** Locally's own player (#338): a Spotify read of the track it is playing is ignored, so a play never counts twice. */
    private readonly locally?: Pick<LocallyNowPlaying, "trackId">,
    /** Play events (#398): one is written where a play counts, and its listened time grows with the samples. */
    private readonly events?: Pick<PlayEventStore, "record">,
  ) {}

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.lastStatus = "on";
      this.notPlayingSince = null;
      void this.run();
    } else {
      this.clearTimer();
    }
  }

  status(): PlaysStatus {
    return this.enabled ? this.lastStatus : "off";
  }

  /** True while online counting covers this account, so nothing is polled or counted here. */
  standingDown(): boolean {
    return this.enabled && this.standDown;
  }

  stop(): void {
    this.enabled = false;
    this.clearTimer();
  }

  /** Polls, then schedules the next poll once this one has finished, so polls never stack. */
  private async run(): Promise<void> {
    await this.poll();
    if (!this.enabled) return;
    this.clearTimer();
    const idle =
      this.standDown ||
      this.lastStatus === "spotify-not-running" ||
      (this.notPlayingSince !== null && this.now() - this.notPlayingSince >= IDLE_AFTER_NOT_PLAYING_MS);
    const delay = idle ? this.idleIntervalMs : this.intervalMs;
    this.timer = setTimeout(() => void this.run(), delay);
    this.timer.unref?.();
  }

  /** One poll. Never overlaps with another; exposed for tests. */
  async poll(): Promise<void> {
    if (!this.enabled || this.polling) return;
    this.polling = true;
    try {
      if (this.online) {
        // Reads the link at most every 5 minutes; a change is picked up on the next poll after that.
        await this.online.refreshIfStale().catch(() => undefined);
        if (!this.enabled) return;
        this.standDown = this.online.active();
        if (this.standDown) {
          // End the counter's session so resuming re-anchors instead of crediting the gap.
          this.lastStatus = "on";
          this.eventSession = null;
          this.counter.push({ at: this.now(), running: false, state: "stopped", id: null, positionSec: 0, durationMs: 0 });
          return;
        }
      }
      const result = await this.nowPlaying.read();
      if (!this.enabled) return;
      const at = this.now();
      if ("hold" in result) {
        // The account is down and this Mac isn't playing a local file. End the counter's session into
        // its bounded continuation memory, so recovery re-anchors instead of crediting a jump or
        // keeping a stale "counted". A long outage still drifts to the idle interval.
        this.notPlayingSince ??= at;
        this.lastStatus = "on";
        this.counter.push({ at, running: false, state: "stopped", id: null, positionSec: 0, durationMs: 0 });
        return;
      }
      if ("error" in result || !result.running || result.state !== "playing") {
        this.notPlayingSince ??= at;
      } else {
        this.notPlayingSince = null;
      }
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
      if (result.id && (await this.isLocallyPlaying(result.id))) {
        // Locally is playing this very track: its own player counts it. End Spotify's session.
        this.counter.push({ at, running: false, state: "stopped", id: null, positionSec: 0, durationMs: 0 });
        return;
      }
      const counted = this.counter.push({ at, ...result });
      if (counted) await this.record(counted, at);
      else if (!this.eventSession && this.events) await this.reattach(result.id);

    } catch (err) {
      console.warn("Play tracker poll failed:", err instanceof Error ? err.message : err);
    } finally {
      // Started before `polling` is released, so its reads of the counter are not interleaved with the next poll's.
      const raising = this.eventSession ? this.raiseEvent() : null;
      this.polling = false;
      await raising;
    }
  }

  /** True when Locally's player is playing the Locally track this Spotify id points at. */
  private async isLocallyPlaying(spotifyId: string): Promise<boolean> {
    const playing = this.locally?.trackId();
    if (!playing) return false;
    const settings: Settings = await this.settings.get();
    const resolved = resolveLocalTrack(spotifyId, await this.library.list(settings.libraryDir));
    return resolved.kind === "match" && resolved.trackId === playing;
  }

  /**
   * Raises the open event's `listenedMs` to the counter's, when the play is paused or has gathered `EVENT_STEP_MS`
   * more since the last write, and writes its final value once the session is over (#398). Never throws into the poll.
   */
  private async raiseEvent(): Promise<void> {
    const open = this.eventSession;
    if (!open || !this.events) return;
    const session = this.counter.session();
    const same = session !== null && session.startedAt === open.startedAt && session.counted;
    if (same) open.latest = Math.min(session.listenedMs, MAX_EVENT_LISTENED_MS);
    else this.eventSession = null;
    // Written when paused, when the session is over, or after another EVENT_STEP_MS of listening.
    const due = !same || !session.playing || open.latest - open.written >= EVENT_STEP_MS;
    if (!due || open.latest <= open.written) return;
    open.written = open.latest;
    await this.events
      .record({ releaseId: open.releaseId, trackId: open.trackId, source: "spotify", startedAt: open.startedAt, listenedMs: open.latest, counted: true })
      .catch((err) => console.warn("Play tracker could not update a play event:", err instanceof Error ? err.message : err));
  }

  /**
   * The counter restored a counted session (Spotify came back within ten minutes, or the source switched): its play
   * was counted and its event written before, so listening goes on raising that same event. Nothing is counted or
   * created here; the event is found again by its identity (source, trackId, startedAt). Tried once per session.
   */
  private async reattach(spotifyId: string | null): Promise<void> {
    const session = this.counter.session();
    if (!session || !session.counted || session.id !== spotifyId || this.reattachTried === session.startedAt) return;
    this.reattachTried = session.startedAt;
    const settings: Settings = await this.settings.get();
    const resolved = resolveLocalTrack(session.id, await this.library.list(settings.libraryDir));
    if (resolved.kind !== "match") return;
    const listenedMs = Math.min(session.listenedMs, MAX_EVENT_LISTENED_MS);
    this.eventSession = { trackId: resolved.trackId, releaseId: resolved.releaseId, startedAt: session.startedAt, written: listenedMs, latest: listenedMs };
  }

  private async record(spotifyId: string, at: number): Promise<void> {
    const settings: Settings = await this.settings.get();
    const releases: Release[] = await this.library.list(settings.libraryDir);
    const resolved = resolveLocalTrack(spotifyId, releases);
    if (resolved.kind === "match") {
      // The day is the Mac's local date when the play counted, not when the library lookup finished.
      await this.store.increment(resolved.trackId, resolved.releaseId, localDay(at, this.timeZone));
      const session = this.counter.session();
      if (this.events && session) {
        const listenedMs = Math.min(session.listenedMs, MAX_EVENT_LISTENED_MS);
        this.eventSession = { trackId: resolved.trackId, releaseId: resolved.releaseId, startedAt: session.startedAt, written: listenedMs, latest: listenedMs };
        await this.events
          .record({ releaseId: resolved.releaseId, trackId: resolved.trackId, source: "spotify", startedAt: session.startedAt, listenedMs, counted: true })
          .catch((err) => console.warn("Play tracker could not write a play event:", err instanceof Error ? err.message : err));
      }
    } else if (resolved.kind === "ambiguous" && !this.warnedAmbiguous.has(spotifyId)) {
      this.warnedAmbiguous.add(spotifyId);
      console.warn("Play tracker: a Spotify local file matches more than one Locally track; not counted.");
    }
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
