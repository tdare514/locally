import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { spotifyLinkRequests, spotifyLinks } from "../../src/db/schema";
import { CleanupService } from "../../src/server/cleanup/CleanupService";
import { TokenCipher } from "../../src/server/crypto/TokenCipher";
import { SpotifyLinkService, spotifyLinkAad } from "../../src/server/spotify/SpotifyLinkService";
import { ValidationError } from "../../src/shared/errors";
import { createTestServices, type TestServices } from "../support/testServices";

const CONFIG = { clientId: "client-123", redirectUri: "https://sync.example.com/v1/spotify/callback" };

let services: TestServices;
let clock: number;
let cipher: TokenCipher;
let calls: { url: string; body: string; method: string }[];
let tokenResponse: () => Response;
let spotify: SpotifyLinkService;

async function newUser(email: string): Promise<string> {
  const code = await services.auth.issueCode(email);
  return (await services.auth.verify({ email, code, deviceName: "D", platform: "mac" })).user.id;
}

function stateOf(authorizeUrl: string): string {
  return new URL(authorizeUrl).searchParams.get("state")!;
}

beforeEach(async () => {
  services = await createTestServices();
  clock = 1_800_000_000_000;
  cipher = new TokenCipher(crypto.randomBytes(32));
  calls = [];
  tokenResponse = () =>
    Response.json({ access_token: "ACCESS-1", refresh_token: "REFRESH-1", expires_in: 3600, scope: "user-read-playback-state" });
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body), method: String(init.method) });
    return tokenResponse();
  }) as unknown as typeof fetch;
  spotify = new SpotifyLinkService(services.db, cipher, CONFIG, fakeFetch, () => clock);
});

describe("SpotifyLinkService.start", () => {
  it("builds an S256 authorize URL with the state and the single scope, and stores only the state hash", async () => {
    const userId = await newUser("a@example.com");
    const { authorizeUrl } = await spotify.start(userId, "Europe/London");
    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe("https://accounts.spotify.com/authorize");
    const p = url.searchParams;
    expect(p.get("client_id")).toBe("client-123");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("redirect_uri")).toBe(CONFIG.redirectUri);
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("scope")).toBe("user-read-playback-state");
    const state = p.get("state")!;
    expect(Buffer.from(state, "base64url")).toHaveLength(32);

    const [row] = await services.db.select().from(spotifyLinkRequests);
    expect(row!.stateHash).toBe(crypto.createHash("sha256").update(state).digest("hex"));
    expect(row!.stateHash).not.toBe(state);
    expect(row!.expiresAt).toBe(clock + 10 * 60 * 1000);
    expect(row!.userId).toBe(userId);
    expect(p.get("code_challenge")).toBe(crypto.createHash("sha256").update(row!.verifier).digest("base64url"));
  });

  it("rejects an invalid time zone", async () => {
    const userId = await newUser("a@example.com");
    await expect(spotify.start(userId, "Mars/Olympus")).rejects.toThrow(ValidationError);
    await expect(spotify.start(userId, "")).rejects.toThrow(ValidationError);
  });
});

describe("SpotifyLinkService.callback", () => {
  it("exchanges the code with the right form body and stores encrypted tokens", async () => {
    const userId = await newUser("a@example.com");
    const { authorizeUrl } = await spotify.start(userId, "Asia/Tokyo");
    const [req] = await services.db.select().from(spotifyLinkRequests);

    const result = await spotify.callback({ code: "the-code", state: stateOf(authorizeUrl) });
    expect(result).toEqual({ ok: true });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://accounts.spotify.com/api/token");
    expect(calls[0]!.method).toBe("POST");
    const form = new URLSearchParams(calls[0]!.body);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: CONFIG.redirectUri,
      client_id: "client-123",
      code_verifier: req!.verifier,
    });

    const [row] = await services.db.select().from(spotifyLinks);
    expect(row!.userId).toBe(userId);
    expect(row!.timeZone).toBe("Asia/Tokyo");
    expect(row!.scope).toBe("user-read-playback-state");
    expect(row!.accessExpiresAt).toBe(clock + 3600 * 1000);
    expect(row!.refreshTokenEnc).toMatch(/^v1:/);
    expect(JSON.stringify(row)).not.toContain("REFRESH-1");
    expect(JSON.stringify(row)).not.toContain("ACCESS-1");
    expect(cipher.decrypt(row!.refreshTokenEnc, spotifyLinkAad(userId))).toBe("REFRESH-1");
    expect(cipher.decrypt(row!.accessTokenEnc, spotifyLinkAad(userId))).toBe("ACCESS-1");
    expect(() => cipher.decrypt(row!.refreshTokenEnc, spotifyLinkAad("someone-else"))).toThrow();
  });

  it("makes a state work once", async () => {
    const userId = await newUser("a@example.com");
    const state = stateOf((await spotify.start(userId, "UTC")).authorizeUrl);
    expect(await spotify.callback({ code: "c", state })).toEqual({ ok: true });
    expect(await spotify.callback({ code: "c", state })).toEqual({ ok: false });
    expect(calls).toHaveLength(1);
  });

  it("rejects an expired state and deletes it", async () => {
    const userId = await newUser("a@example.com");
    const state = stateOf((await spotify.start(userId, "UTC")).authorizeUrl);
    clock += 10 * 60 * 1000 + 1;
    expect(await spotify.callback({ code: "c", state })).toEqual({ ok: false });
    expect(calls).toHaveLength(0);
    expect(await services.db.select().from(spotifyLinkRequests)).toHaveLength(0);
    expect(await services.db.select().from(spotifyLinks)).toHaveLength(0);
  });

  it("rejects an unknown or missing state without calling Spotify", async () => {
    expect(await spotify.callback({ code: "c", state: "nope" })).toEqual({ ok: false });
    expect(await spotify.callback({ code: "c" })).toEqual({ ok: false });
    expect(await spotify.callback({ code: "c", state: "" })).toEqual({ ok: false });
    expect(calls).toHaveLength(0);
  });

  it("on error=access_denied changes nothing but still burns the state", async () => {
    const userId = await newUser("a@example.com");
    const state = stateOf((await spotify.start(userId, "UTC")).authorizeUrl);
    expect(await spotify.callback({ error: "access_denied", state })).toEqual({ ok: false });
    expect(calls).toHaveLength(0);
    expect(await services.db.select().from(spotifyLinks)).toHaveLength(0);
    expect(await services.db.select().from(spotifyLinkRequests)).toHaveLength(0);
  });

  it("fails cleanly (and burns the state) when Spotify rejects the exchange", async () => {
    tokenResponse = () => Response.json({ error: "invalid_grant" }, { status: 400 });
    const userId = await newUser("a@example.com");
    const state = stateOf((await spotify.start(userId, "UTC")).authorizeUrl);
    expect(await spotify.callback({ code: "c", state })).toEqual({ ok: false });
    expect(await services.db.select().from(spotifyLinks)).toHaveLength(0);
    expect(await services.db.select().from(spotifyLinkRequests)).toHaveLength(0);
  });

  it("a re-link replaces the tokens and clears problem and backoff", async () => {
    const userId = await newUser("a@example.com");
    await spotify.callback({ code: "c", state: stateOf((await spotify.start(userId, "UTC")).authorizeUrl) });
    await services.db.update(spotifyLinks).set({ problem: "reconnect", backoffUntil: clock + 5000 }).where(eq(spotifyLinks.userId, userId));

    clock += 1000;
    tokenResponse = () => Response.json({ access_token: "ACCESS-2", refresh_token: "REFRESH-2", expires_in: 3600, scope: "user-read-playback-state" });
    await spotify.callback({ code: "c2", state: stateOf((await spotify.start(userId, "Europe/Paris")).authorizeUrl) });

    const rows = await services.db.select().from(spotifyLinks);
    expect(rows).toHaveLength(1);
    expect(cipher.decrypt(rows[0]!.refreshTokenEnc, spotifyLinkAad(userId))).toBe("REFRESH-2");
    expect(rows[0]!.problem).toBeNull();
    expect(rows[0]!.backoffUntil).toBeNull();
    expect(rows[0]!.timeZone).toBe("Europe/Paris");
    expect(rows[0]!.createdAt).toBe(clock - 1000);
  });
});

describe("status, unlink, account deletion and cleanup", () => {
  it("reports status and unlinks idempotently", async () => {
    const userId = await newUser("a@example.com");
    expect(await spotify.status(userId)).toEqual({ linked: false });
    await spotify.callback({ code: "c", state: stateOf((await spotify.start(userId, "UTC")).authorizeUrl) });
    expect(await spotify.status(userId)).toEqual({ linked: true, since: clock, lastSampleAt: null, problem: null });
    await spotify.unlink(userId);
    await spotify.unlink(userId);
    expect(await spotify.status(userId)).toEqual({ linked: false });
  });

  it("account deletion removes the link and pending requests", async () => {
    const userId = await newUser("a@example.com");
    await spotify.callback({ code: "c", state: stateOf((await spotify.start(userId, "UTC")).authorizeUrl) });
    await spotify.start(userId, "UTC");
    await services.account.deleteAccount(userId, "a@example.com");
    expect(await services.db.select().from(spotifyLinks)).toHaveLength(0);
    expect(await services.db.select().from(spotifyLinkRequests)).toHaveLength(0);
  });

  it("daily cleanup prunes expired link requests only", async () => {
    const userId = await newUser("a@example.com");
    await services.db.insert(spotifyLinkRequests).values([
      { stateHash: "old", userId, verifier: "v", timeZone: "UTC", expiresAt: clock - 1 },
      { stateHash: "new", userId, verifier: "v", timeZone: "UTC", expiresAt: clock + 1000 },
    ]);
    const result = await new CleanupService(services.db, services.fileStore, () => clock).run();
    expect(result.deletedSpotifyLinkRequests).toBe(1);
    const left = await services.db.select().from(spotifyLinkRequests);
    expect(left.map((r) => r.stateHash)).toEqual(["new"]);
  });
});
