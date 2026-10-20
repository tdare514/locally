import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { spotifyLinks } from "../../db/schema";
import type { TokenCipher } from "../crypto/TokenCipher";
import type { PlayerSample } from "./CloudPlayCounter";
import { SPOTIFY_TOKEN_URL, spotifyLinkAad } from "./SpotifyLinkService";

export const SPOTIFY_PLAYER_URL = "https://api.spotify.com/v1/me/player";
const REQUEST_TIMEOUT_MS = 8000;
const REFRESH_MARGIN_MS = 60_000;
const MIN_BACKOFF_MS = 60_000;

export type SpotifyLinkRow = typeof spotifyLinks.$inferSelect;

/**
 * - `ok`: Spotify answered (204 idle, or 200 with the item).
 * - `stopped`: a problem or back-off was saved on the link; skip the user until it clears.
 * - `skip`: any other failure (network, 5xx, undecryptable token); nothing was changed.
 */
export type PlayerReadResult = { kind: "ok"; sample: PlayerSample } | { kind: "stopped" } | { kind: "skip" };

type RefreshResult = { kind: "ok"; access: string } | { kind: "stopped" } | { kind: "skip" };

/**
 * Reads `GET /v1/me/player` for one linked user (#303 §3). Keeps the tokens fresh: a refresh is saved
 * (encrypted, bound to the user) before its access token is used, because Spotify may rotate the refresh
 * token. Never logs or returns a token, uri or track name.
 */
export class SpotifyPlayerClient {
  constructor(
    private readonly db: Db,
    private readonly cipher: TokenCipher,
    private readonly clientId: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now()
  ) {}

  async read(link: SpotifyLinkRow): Promise<PlayerReadResult> {
    const aad = spotifyLinkAad(link.userId);
    let access: string;
    try {
      access = this.cipher.decrypt(link.accessTokenEnc, aad);
    } catch {
      return { kind: "skip" };
    }

    if (link.accessExpiresAt - this.now() < REFRESH_MARGIN_MS) {
      const refreshed = await this.refresh(link);
      if (refreshed.kind !== "ok") return refreshed;
      access = refreshed.access;
    }

    let response = await this.getPlayer(access);
    if (response?.status === 401) {
      const refreshed = await this.refresh(link);
      if (refreshed.kind !== "ok") return refreshed;
      response = await this.getPlayer(refreshed.access);
    }
    if (!response) return { kind: "skip" };

    if (response.status === 204) return { kind: "ok", sample: { kind: "idle" } };
    if (response.status === 429) {
      const retryAfterS = Number(response.headers.get("retry-after"));
      const waitMs = Math.max(MIN_BACKOFF_MS, Number.isFinite(retryAfterS) ? retryAfterS * 1000 : 0);
      await this.markLink(link.userId, { problem: "rateLimited", backoffUntil: this.now() + waitMs });
      return { kind: "stopped" };
    }
    if (response.status === 403) {
      let text = "";
      try {
        text = await response.text();
      } catch {
        return { kind: "skip" };
      }
      if (/not registered/i.test(text)) {
        await this.markLink(link.userId, { problem: "notOnTesterList" });
        return { kind: "stopped" };
      }
      return { kind: "skip" };
    }
    if (response.status !== 200) return { kind: "skip" };

    try {
      const body = (await response.json()) as Record<string, unknown> | null;
      const item = body && typeof body.item === "object" ? (body.item as Record<string, unknown> | null) : null;
      const uri = item && typeof item.uri === "string" ? item.uri : null;
      const duration = item && typeof item.duration_ms === "number" && item.duration_ms > 0 ? item.duration_ms : null;
      const progress = body && typeof body.progress_ms === "number" ? body.progress_ms : 0;
      return {
        kind: "ok",
        sample: { kind: "item", uri, progressMs: progress, durationMs: duration, isPlaying: body?.is_playing === true },
      };
    } catch {
      return { kind: "skip" };
    }
  }

  /** Null on a network error or timeout. */
  private async getPlayer(access: string): Promise<Response | null> {
    try {
      return await this.fetchFn(SPOTIFY_PLAYER_URL, {
        method: "GET",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { authorization: `Bearer ${access}` },
      });
    } catch {
      return null;
    }
  }

  private async refresh(link: SpotifyLinkRow): Promise<RefreshResult> {
    const aad = spotifyLinkAad(link.userId);
    let refreshToken: string;
    try {
      refreshToken = this.cipher.decrypt(link.refreshTokenEnc, aad);
    } catch {
      return { kind: "skip" };
    }

    let response: Response;
    try {
      response = await this.fetchFn(SPOTIFY_TOKEN_URL, {
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: this.clientId,
        }).toString(),
      });
    } catch {
      return { kind: "skip" };
    }

    let body: Record<string, unknown>;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      return { kind: "skip" };
    }
    if (!response.ok) {
      if (body?.error === "invalid_grant") {
        await this.markLink(link.userId, { problem: "reconnect" });
        return { kind: "stopped" };
      }
      return { kind: "skip" };
    }
    if (typeof body.access_token !== "string" || typeof body.expires_in !== "number") return { kind: "skip" };

    // Save before use: a rotated refresh token must not be lost if anything after this fails.
    const newRefresh = typeof body.refresh_token === "string" ? body.refresh_token : refreshToken;
    const now = this.now();
    const expiresAt = now + body.expires_in * 1000;
    try {
      await this.db
        .update(spotifyLinks)
        .set({
          refreshTokenEnc: this.cipher.encrypt(newRefresh, aad),
          accessTokenEnc: this.cipher.encrypt(body.access_token, aad),
          accessExpiresAt: expiresAt,
          updatedAt: now,
        })
        .where(eq(spotifyLinks.userId, link.userId));
    } catch {
      return { kind: "skip" };
    }
    // The next refresh in this run (a 401 retry) must use the rotated token.
    link.refreshTokenEnc = this.cipher.encrypt(newRefresh, aad);
    link.accessTokenEnc = this.cipher.encrypt(body.access_token, aad);
    link.accessExpiresAt = expiresAt;
    return { kind: "ok", access: body.access_token };
  }

  private async markLink(userId: string, set: { problem: string; backoffUntil?: number }): Promise<void> {
    try {
      await this.db
        .update(spotifyLinks)
        .set({ ...set, updatedAt: this.now() })
        .where(eq(spotifyLinks.userId, userId));
    } catch {
      // A failed write leaves the link as it was; the next run tries again.
    }
  }
}
