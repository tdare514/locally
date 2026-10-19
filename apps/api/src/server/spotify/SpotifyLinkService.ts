import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { spotifyLinkRequests, spotifyLinks } from "../../db/schema";
import { ValidationError } from "../../shared/errors";
import type { TokenCipher } from "../crypto/TokenCipher";

export const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
export const SPOTIFY_SCOPE = "user-read-playback-state";
const REQUEST_TTL_MS = 10 * 60 * 1000;

export type SpotifyLinkStatus = { linked: false } | { linked: true; since: number; lastSampleAt: number | null; problem: string | null };

export type SpotifyCallbackResult = { ok: true } | { ok: false };

export interface SpotifyLinkConfig {
  clientId: string;
  redirectUri: string;
}

/** AES-GCM associated data for a user's tokens; binds a ciphertext to its row. */
export function spotifyLinkAad(userId: string): string {
  return `spotify-link:${userId}`;
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Links a user's Spotify account to the sync service with its own PKCE grant (#303 §1, #305).
 * Never logs or returns a token, code, state or verifier; callback failures carry no detail.
 */
export class SpotifyLinkService {
  constructor(
    private readonly db: Db,
    private readonly cipher: TokenCipher,
    private readonly config: SpotifyLinkConfig,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now()
  ) {}

  async start(userId: string, timeZone: string): Promise<{ authorizeUrl: string }> {
    if (!isValidTimeZone(timeZone)) throw new ValidationError("timeZone must be an IANA time zone name");

    const state = crypto.randomBytes(32).toString("base64url");
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

    await this.db.insert(spotifyLinkRequests).values({
      stateHash: sha256Hex(state),
      userId,
      verifier,
      timeZone,
      expiresAt: this.now() + REQUEST_TTL_MS,
    });

    const url = new URL(SPOTIFY_AUTHORIZE_URL);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", SPOTIFY_SCOPE);
    return { authorizeUrl: url.toString() };
  }

  /** Single-use: the request row is deleted whatever happens next. Failures are a bare `{ ok: false }`. */
  async callback(params: { code?: string | null; error?: string | null; state?: string | null }): Promise<SpotifyCallbackResult> {
    if (!params.state) return { ok: false };
    const stateHash = sha256Hex(params.state);

    const [request] = await this.db.delete(spotifyLinkRequests).where(eq(spotifyLinkRequests.stateHash, stateHash)).returning();
    if (!request || request.expiresAt <= this.now()) return { ok: false };
    if (params.error || !params.code) return { ok: false };

    let tokens: { access: string; refresh: string; expiresInS: number; scope: string };
    try {
      tokens = await this.exchange(params.code, request.verifier);
    } catch {
      return { ok: false };
    }

    const now = this.now();
    const aad = spotifyLinkAad(request.userId);
    const values = {
      refreshTokenEnc: this.cipher.encrypt(tokens.refresh, aad),
      accessTokenEnc: this.cipher.encrypt(tokens.access, aad),
      accessExpiresAt: now + tokens.expiresInS * 1000,
      scope: tokens.scope,
      timeZone: request.timeZone,
      updatedAt: now,
      problem: null,
      backoffUntil: null,
    };
    await this.db
      .insert(spotifyLinks)
      .values({ userId: request.userId, createdAt: now, ...values })
      .onConflictDoUpdate({ target: spotifyLinks.userId, set: values });
    return { ok: true };
  }

  private async exchange(code: string, verifier: string) {
    const response = await this.fetchFn(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.config.redirectUri,
        client_id: this.config.clientId,
        code_verifier: verifier,
      }).toString(),
    });
    if (!response.ok) throw new Error("token exchange failed");
    const body = (await response.json()) as Record<string, unknown>;
    if (
      typeof body.access_token !== "string" ||
      typeof body.refresh_token !== "string" ||
      typeof body.expires_in !== "number"
    ) {
      throw new Error("token exchange failed");
    }
    return {
      access: body.access_token,
      refresh: body.refresh_token,
      expiresInS: body.expires_in,
      scope: typeof body.scope === "string" ? body.scope : SPOTIFY_SCOPE,
    };
  }

  async status(userId: string): Promise<SpotifyLinkStatus> {
    const [row] = await this.db.select().from(spotifyLinks).where(eq(spotifyLinks.userId, userId));
    if (!row) return { linked: false };
    return { linked: true, since: row.createdAt, lastSampleAt: row.lastSampleAt, problem: row.problem };
  }

  /** Idempotent. */
  async unlink(userId: string): Promise<void> {
    await this.db.delete(spotifyLinks).where(eq(spotifyLinks.userId, userId));
  }
}
