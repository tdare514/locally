import type { SettingsStore } from "../config/SettingsStore";
import type { SpotifySettings } from "../../shared/types";

export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
export const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

/** Refresh when the access token has less than this left. */
const REFRESH_MARGIN_MS = 60_000;

export const EXPIRED_MESSAGE = "Spotify sign-in expired. Connect again.";
export const TESTER_LIST_MESSAGE = "This Spotify account isn't on Locally's tester list.";

export type SpotifyFailure = "disconnected" | "notOnTesterList" | "rateLimited" | "offline" | "http";

/**
 * A failed Spotify call. The message is safe to show: it never carries a token, a response body
 * or a request URL.
 */
export class SpotifyApiError extends Error {
  readonly code: SpotifyFailure;
  readonly retryAfterSec?: number;
  readonly status?: number;
  constructor(code: SpotifyFailure, message: string, extra: { retryAfterSec?: number; status?: number } = {}) {
    super(message);
    this.name = "SpotifyApiError";
    this.code = code;
    this.retryAfterSec = extra.retryAfterSec;
    this.status = extra.status;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Map a non-ok Spotify API response to an error. Reads the body only to spot "not registered". */
export async function failureFromResponse(res: Response): Promise<SpotifyApiError> {
  if (res.status === 429) {
    const header = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
    const retryAfterSec = Number.isFinite(header) && header >= 0 ? header : undefined;
    return new SpotifyApiError("rateLimited", "Spotify asked us to slow down. Try again shortly.", {
      retryAfterSec,
      status: 429,
    });
  }
  if (res.status === 403) {
    let text = "";
    try {
      text = (await res.text()).toLowerCase();
    } catch {
      // unreadable body: treat as a plain 403
    }
    if (text.includes("not registered")) {
      return new SpotifyApiError("notOnTesterList", TESTER_LIST_MESSAGE, { status: 403 });
    }
  }
  return new SpotifyApiError("http", `Spotify answered with an error (${res.status}).`, { status: res.status });
}

/** `GET /me`, for the user id and display name. Throws {@link SpotifyApiError}. */
export async function fetchMe(
  accessToken: string,
  fetchFn: FetchLike,
): Promise<{ id: string; displayName: string }> {
  let res: Response;
  try {
    res = await fetchFn(`${SPOTIFY_API_BASE}/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch {
    throw new SpotifyApiError("offline", "Couldn't reach Spotify. Check your connection.");
  }
  if (!res.ok) throw await failureFromResponse(res);
  const body = (await res.json().catch(() => null)) as { id?: unknown; display_name?: unknown } | null;
  if (!body || typeof body.id !== "string" || body.id.length === 0) {
    throw new SpotifyApiError("http", "Spotify sent an answer Locally couldn't read.");
  }
  const displayName = typeof body.display_name === "string" && body.display_name ? body.display_name : body.id;
  return { id: body.id, displayName };
}

export interface SpotifyClientOptions {
  settings: SettingsStore;
  clientId: string;
  fetch?: FetchLike;
  now?: () => number;
}

/**
 * Reads the stored Spotify tokens, refreshes them, and makes read-only API calls (#239).
 * Tokens are never logged or put in an error.
 */
export class SpotifyClient {
  private readonly settings: SettingsStore;
  private readonly clientId: string;
  private readonly fetchFn: FetchLike;
  private readonly now: () => number;
  private refreshing: Promise<string> | null = null;
  /** The last failure worth showing in Settings (an expired sign-in); cleared by {@link clearError}. */
  lastError: string | null = null;

  constructor(opts: SpotifyClientOptions) {
    this.settings = opts.settings;
    this.clientId = opts.clientId;
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.now = opts.now ?? Date.now;
  }

  clearError(): void {
    this.lastError = null;
  }

  /** A valid access token, refreshed first when it is within 60 s of expiry. */
  async getAccessToken(): Promise<string> {
    const spotify = (await this.settings.get()).spotify;
    if (!spotify) throw new SpotifyApiError("disconnected", "Spotify isn't connected.");
    if (spotify.accessTokenExpiresAt - this.now() > REFRESH_MARGIN_MS) return spotify.accessToken;
    return this.refresh();
  }

  /** GET `path` (`/me/playlists`, or a full api.spotify.com URL such as a `next` link) and parse the JSON. */
  async request<T = unknown>(path: string): Promise<T> {
    const url = this.resolveUrl(path);
    let token = await this.getAccessToken();
    let res = await this.send(url, token);
    if (res.status === 401) {
      token = await this.refresh();
      res = await this.send(url, token);
    }
    if (!res.ok) throw await failureFromResponse(res);
    try {
      return (await res.json()) as T;
    } catch {
      throw new SpotifyApiError("http", "Spotify sent an answer Locally couldn't read.");
    }
  }

  /** Only Spotify's own API ever sees the access token. */
  private resolveUrl(path: string): string {
    if (path.startsWith("/")) return `${SPOTIFY_API_BASE}${path}`;
    if (path.startsWith(`${SPOTIFY_API_BASE}/`)) return path;
    throw new SpotifyApiError("http", "Refused a request outside the Spotify API.");
  }

  private async send(url: string, token: string): Promise<Response> {
    try {
      return await this.fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch {
      throw new SpotifyApiError("offline", "Couldn't reach Spotify. Check your connection.");
    }
  }

  /** Shared by concurrent callers, so one expired token costs one refresh call. */
  private refresh(): Promise<string> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<string> {
    const current = (await this.settings.get()).spotify;
    if (!current) throw new SpotifyApiError("disconnected", "Spotify isn't connected.");

    let res: Response;
    try {
      res = await this.fetchFn(SPOTIFY_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: current.refreshToken,
          client_id: this.clientId,
        }).toString(),
      });
    } catch {
      throw new SpotifyApiError("offline", "Couldn't reach Spotify. Check your connection.");
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (body && body.error === "invalid_grant") {
        await this.clearTokens();
        this.lastError = EXPIRED_MESSAGE;
        throw new SpotifyApiError("disconnected", EXPIRED_MESSAGE, { status: res.status });
      }
      throw new SpotifyApiError("http", `Spotify couldn't refresh the sign-in (${res.status}).`, {
        status: res.status,
      });
    }

    const body = (await res.json().catch(() => null)) as {
      access_token?: unknown;
      expires_in?: unknown;
      refresh_token?: unknown;
      scope?: unknown;
    } | null;
    if (!body || typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
      throw new SpotifyApiError("http", "Spotify sent an answer Locally couldn't read.");
    }
    // Re-read: the user may have disconnected while the call was in flight.
    const latest = await this.settings.get();
    if (!latest.spotify) throw new SpotifyApiError("disconnected", "Spotify isn't connected.");
    const next: SpotifySettings = {
      ...latest.spotify,
      accessToken: body.access_token,
      accessTokenExpiresAt: this.now() + body.expires_in * 1000,
      refreshToken:
        typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : latest.spotify.refreshToken,
      scopes: typeof body.scope === "string" && body.scope ? body.scope.split(/\s+/) : latest.spotify.scopes,
    };
    await this.settings.set({ ...latest, spotify: next });
    return next.accessToken;
  }

  private async clearTokens(): Promise<void> {
    const latest = await this.settings.get();
    if (!latest.spotify) return;
    const { spotify: _removed, ...rest } = latest;
    void _removed;
    await this.settings.set(rest);
  }
}
