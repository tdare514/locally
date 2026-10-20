import type { CloudPlaysStatus } from "../../shared/types";
import type { SettingsStore } from "../config/SettingsStore";
import { SyncAuthError, SyncUnavailableError, type SpotifyLinkStatus } from "../sync/SyncApi";
import type { SyncApiFactory } from "../sync/SyncEngine";

/** The link status is re-read at most this often while the play tracker runs (#307). */
export const CLOUD_REFRESH_MS = 5 * 60_000;
/** While a link is pending (the owner is in the browser) the status is read this often... */
export const CLOUD_PENDING_POLL_MS = 2000;
/** ...for at most this long, the lifetime of the service's pending request. */
export const CLOUD_PENDING_MAX_MS = 10 * 60_000;

const UNAVAILABLE: CloudPlaysStatus = { available: false, linked: false, lastSampleAt: null, problem: null, pending: false };

/** True only for Spotify's own authorize endpoint over https; the one URL a link may open. */
export function isSpotifyAuthorizeUrl(value: string): boolean {
  if (!value.startsWith("https://accounts.spotify.com/authorize")) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.host === "accounts.spotify.com" && u.pathname === "/authorize";
  } catch {
    return false;
  }
}

/**
 * The Mac's view of online play counting (#307): whether the sync service samples this account's
 * Spotify while the Mac is off. It caches `GET /v1/spotify/link`, so `active()` is a cheap
 * synchronous read that `PlayTracker` can ask on every poll. Active only while signed in to sync,
 * linked, and with no problem.
 */
export class CloudPlays {
  private cache: CloudPlaysStatus = UNAVAILABLE;
  private fetchedAt = 0;
  private pendingUntil = 0;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly deps: {
      settings: Pick<SettingsStore, "get">;
      apiFactory: SyncApiFactory;
      now?: () => number;
      /** The Mac's IANA zone, which the service buckets days in. */
      timeZone?: () => string;
    },
  ) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** True while the service counts plays and this Mac should not. */
  active(): boolean {
    const c = this.cache;
    return c.available && c.linked && c.problem === null;
  }

  /** Reads the status now (Settings open). */
  async view(): Promise<CloudPlaysStatus> {
    // While a link is pending its own 2 s loop keeps the cache fresh; don't double the requests.
    if (!this.isPending()) await this.refresh();
    return this.snapshot();
  }

  private snapshot(): CloudPlaysStatus {
    return { ...this.cache, pending: this.cache.available && this.isPending() };
  }

  private isPending(): boolean {
    return this.pendingUntil > this.now();
  }

  /** Re-reads the status only when the cache is older than the 5-minute refresh. For the tracker's loop. */
  async refreshIfStale(): Promise<void> {
    const signedIn = !!(await this.deps.settings.get()).sync?.deviceToken;
    if (!signedIn) {
      this.reset();
      return;
    }
    if (this.now() - this.fetchedAt >= CLOUD_REFRESH_MS) await this.refresh();
  }

  async refresh(): Promise<void> {
    const sync = (await this.deps.settings.get()).sync;
    if (!sync?.deviceToken) {
      this.reset();
      return;
    }
    try {
      const status = await this.deps.apiFactory(sync.baseUrl, sync.deviceToken).spotifyLinkStatus();
      this.cache = viewOf(status);
      this.fetchedAt = this.now();
      if (this.active()) this.endPending();
    } catch (err) {
      if (err instanceof SyncUnavailableError || err instanceof SyncAuthError) {
        // Not on this server, or the sign-in is gone: nothing is counted online.
        this.reset();
        this.fetchedAt = this.now();
        return;
      }
      // A flaky network keeps the last answer; the next read tries again.
      console.warn("Online play counting status could not be read.");
    }
  }

  /** Starts linking (or reconnecting). Returns the URL for the browser; the caller opens it. */
  async start(): Promise<{ authorizeUrl: string }> {
    const sync = (await this.deps.settings.get()).sync;
    if (!sync?.deviceToken) throw new SyncAuthError("Sign in to sync first");
    const timeZone = this.deps.timeZone?.() ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { authorizeUrl } = await this.deps.apiFactory(sync.baseUrl, sync.deviceToken).spotifyLinkStart(timeZone);
    if (!isSpotifyAuthorizeUrl(authorizeUrl)) throw new Error("The sync service sent an unexpected Spotify address.");
    if (!this.cache.available) this.cache = { ...UNAVAILABLE, available: true };
    this.beginPending();
    return { authorizeUrl };
  }

  async unlink(): Promise<void> {
    const sync = (await this.deps.settings.get()).sync;
    if (!sync?.deviceToken) return;
    await this.deps.apiFactory(sync.baseUrl, sync.deviceToken).spotifyUnlink();
    this.endPending();
    this.cache = { ...this.cache, linked: false, lastSampleAt: null, problem: null };
    this.fetchedAt = this.now();
  }

  stop(): void {
    this.endPending();
  }

  private reset(): void {
    this.cache = UNAVAILABLE;
    this.fetchedAt = 0;
    this.endPending();
  }

  private beginPending(): void {
    this.pendingUntil = this.now() + CLOUD_PENDING_MAX_MS;
    this.schedulePendingPoll();
  }

  private endPending(): void {
    this.pendingUntil = 0;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
  }

  private schedulePendingPoll(): void {
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      if (!this.isPending()) return;
      void this.refresh().finally(() => {
        if (this.isPending()) this.schedulePendingPoll();
      });
    }, CLOUD_PENDING_POLL_MS);
    this.pendingTimer.unref?.();
  }
}

function viewOf(status: SpotifyLinkStatus): CloudPlaysStatus {
  return status.linked
    ? { available: true, linked: true, lastSampleAt: status.lastSampleAt, problem: status.problem, pending: false }
    : { available: true, linked: false, lastSampleAt: null, problem: null, pending: false };
}
