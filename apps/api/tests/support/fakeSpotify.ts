import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../../src/db/client";
import { spotifyLinks } from "../../src/db/schema";
import { TokenCipher } from "../../src/server/crypto/TokenCipher";
import { spotifyLinkAad } from "../../src/server/spotify/SpotifyLinkService";
import { SpotifyPlayerClient } from "../../src/server/spotify/SpotifyPlayerClient";
import { SpotifySampler } from "../../src/server/spotify/SpotifySampler";

export const PLAYER_URL = "https://api.spotify.com/v1/me/player";
export const TOKEN_URL = "https://accounts.spotify.com/api/token";

export interface FakeCall {
  url: string;
  method: string;
  body: string;
  authorization: string | null;
}

/** A Spotify with no network: queue answers per URL, read what was called. An empty queue repeats the last answer. */
export class FakeSpotify {
  readonly calls: FakeCall[] = [];
  private readonly queues = new Map<string, (() => Response)[]>();
  private readonly last = new Map<string, () => Response>();
  /** Runs when a call arrives, before it is answered (to look at the database at that moment). */
  onCall: ((call: FakeCall) => Promise<void>) | null = null;

  answer(url: string, ...responses: (() => Response)[]): void {
    this.queues.set(url, [...responses]);
  }

  readonly fetch = (async (url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call: FakeCall = { url, method: String(init.method), body: String(init.body ?? ""), authorization: headers.authorization ?? null };
    this.calls.push(call);
    if (this.onCall) await this.onCall(call);
    const queue = this.queues.get(url) ?? [];
    const next = queue.shift() ?? this.last.get(url);
    if (!next) throw new Error(`unexpected fetch to ${url}`);
    this.last.set(url, next);
    return next();
  }) as unknown as typeof fetch;

  callsTo(url: string): FakeCall[] {
    return this.calls.filter((c) => c.url === url);
  }
}

export const playing = (uri: string, progressMs: number, durationMs = 200_000, isPlaying = true) => () =>
  Response.json({ is_playing: isPlaying, progress_ms: progressMs, item: { uri, duration_ms: durationMs, name: "never read" } });
export const idle = () => new Response(null, { status: 204 });

export interface SamplerKit {
  cipher: TokenCipher;
  spotify: FakeSpotify;
  clock: { now: number };
  sampler: SpotifySampler;
  player: SpotifyPlayerClient;
}

export function makeSamplerKit(db: Db, startMs: number): SamplerKit {
  const cipher = new TokenCipher(crypto.randomBytes(32));
  const spotify = new FakeSpotify();
  const clock = { now: startMs };
  const player = new SpotifyPlayerClient(db, cipher, "client-123", spotify.fetch, () => clock.now);
  const sampler = new SpotifySampler(db, player, () => clock.now);
  return { cipher, spotify, clock, sampler, player };
}

/** Insert a link row with encrypted tokens (as step 1's callback would). */
export async function insertLink(
  db: Db,
  cipher: TokenCipher,
  userId: string,
  now: number,
  over: Partial<typeof spotifyLinks.$inferInsert> & { access?: string; refresh?: string } = {}
): Promise<void> {
  const { access = "ACCESS-0", refresh = "REFRESH-0", ...rest } = over;
  const aad = spotifyLinkAad(userId);
  await db.insert(spotifyLinks).values({
    userId,
    refreshTokenEnc: cipher.encrypt(refresh, aad),
    accessTokenEnc: cipher.encrypt(access, aad),
    accessExpiresAt: now + 3_600_000,
    scope: "user-read-playback-state",
    timeZone: "UTC",
    createdAt: now,
    updatedAt: now,
    ...rest,
  });
}

export async function getLink(db: Db, userId: string) {
  const [row] = await db.select().from(spotifyLinks).where(eq(spotifyLinks.userId, userId));
  return row!;
}
