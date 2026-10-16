import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpotifyAuth, SpotifyAuthError, challengeFor } from "../../src/server/spotify/SpotifyAuth";
import { SPOTIFY_SCOPES } from "../../src/server/spotify/config";
import { MemorySettings, fakeFetch, formOf, jsonResponse } from "./spotifyFakes";

const CLIENT_ID = "dummy-client-id";
const NOW = 5_000_000;

let settings: MemorySettings;
let auth: SpotifyAuth;
let spotify: ReturnType<typeof fakeFetch>;

function okSpotify() {
  return fakeFetch(({ url }) => {
    if (url === "https://accounts.spotify.com/api/token") {
      return jsonResponse({
        access_token: "AT-new",
        refresh_token: "RT-new",
        expires_in: 3600,
        scope: SPOTIFY_SCOPES,
      });
    }
    if (url === "https://api.spotify.com/v1/me") return jsonResponse({ id: "u9", display_name: "Sam" });
    return new Response("nope", { status: 500 });
  });
}

function makeAuth(opts: { port?: number; fetch?: ReturnType<typeof fakeFetch> } = {}) {
  spotify = opts.fetch ?? okSpotify();
  return new SpotifyAuth({
    settings,
    clientId: CLIENT_ID,
    fetch: spotify.fn,
    now: () => NOW,
    port: opts.port ?? 0,
  });
}

function parse(authorizeUrl: string) {
  const u = new URL(authorizeUrl);
  return { u, q: u.searchParams };
}

/** True when nothing accepts connections on the port any more. */
function refused(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => {
      s.destroy();
      resolve(false);
    });
    s.once("error", () => resolve(true));
  });
}

beforeEach(() => {
  settings = new MemorySettings();
  auth = makeAuth();
});

afterEach(() => {
  auth.cancel();
});

describe("authorize URL", () => {
  it("carries PKCE S256, state, scopes, client id and the loopback redirect", async () => {
    const { authorizeUrl } = await auth.start();
    const { u, q } = parse(authorizeUrl);
    expect(u.origin + u.pathname).toBe("https://accounts.spotify.com/authorize");
    expect(q.get("response_type")).toBe("code");
    expect(q.get("client_id")).toBe(CLIENT_ID);
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get("state")).toMatch(/^[0-9a-f]{32}$/);
    expect(q.get("scope")).toBe("playlist-read-private playlist-read-collaborative user-read-playback-state");
    expect(q.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  });

  it("sends a 64-character verifier whose S256 challenge matches the one in the URL", async () => {
    const { authorizeUrl } = await auth.start();
    const q = parse(authorizeUrl).q;
    await fetch(`${q.get("redirect_uri")}?code=C&state=${q.get("state")}`);
    const exchange = formOf(spotify.calls[0]);
    const verifier = exchange.get("code_verifier") ?? "";
    expect(verifier).toHaveLength(64);
    expect(challengeFor(verifier)).toBe(q.get("code_challenge"));
    expect(crypto.createHash("sha256").update(verifier).digest("base64url")).toBe(q.get("code_challenge"));
  });
});

describe("callback", () => {
  it("good state: exchanges the code, calls /me, stores the tokens, closes the listener", async () => {
    const { authorizeUrl } = await auth.start();
    const q = parse(authorizeUrl).q;
    const redirect = new URL(q.get("redirect_uri") as string);
    const res = await fetch(`${redirect.origin}/callback?code=THECODE&state=${q.get("state")}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("Connected to Spotify. You can close this tab and go back to Locally.");

    const [token, me] = spotify.calls;
    expect(token.url).toBe("https://accounts.spotify.com/api/token");
    const form = formOf(token);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("THECODE");
    expect(form.get("redirect_uri")).toBe(q.get("redirect_uri"));
    expect(form.get("client_id")).toBe(CLIENT_ID);
    expect(me.url).toBe("https://api.spotify.com/v1/me");
    expect((me.init?.headers as Record<string, string>).Authorization).toBe("Bearer AT-new");

    expect(settings.value.spotify).toEqual({
      accessToken: "AT-new",
      accessTokenExpiresAt: NOW + 3600_000,
      refreshToken: "RT-new",
      revision: expect.stringMatching(/^[0-9a-f]{16}$/),
      scopes: SPOTIFY_SCOPES.split(" "),
      userId: "u9",
      displayName: "Sam",
      connectedAt: new Date(NOW).toISOString(),
    });
    expect(auth.isPending()).toBe(false);
    expect(await refused(Number(redirect.port))).toBe(true);
  });

  it("refuses an unknown or missing state and stores nothing", async () => {
    const { authorizeUrl } = await auth.start();
    const q = parse(authorizeUrl).q;
    const origin = new URL(q.get("redirect_uri") as string).origin;
    const unknown = await fetch(`${origin}/callback?code=C&state=${"0".repeat(32)}`);
    const missing = await fetch(`${origin}/callback?code=C`);
    expect(unknown.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(spotify.calls).toHaveLength(0);
    expect(settings.value.spotify).toBeUndefined();
    // The real sign-in is still open and still works.
    expect(auth.isPending()).toBe(true);
    const good = await fetch(`${origin}/callback?code=C&state=${q.get("state")}`);
    expect(good.status).toBe(200);
  });

  it("refuses a reused state", async () => {
    const { authorizeUrl } = await auth.start();
    const state = parse(authorizeUrl).q.get("state") as string;
    const first = await auth.handleCallback(new URLSearchParams({ code: "C", state }));
    expect(first.status).toBe(200);
    const callsAfterFirst = spotify.calls.length;
    const second = await auth.handleCallback(new URLSearchParams({ code: "C2", state }));
    expect(second.status).toBe(400);
    expect(spotify.calls).toHaveLength(callsAfterFirst);
  });

  it("a new start replaces the old sign-in: the old state is refused and the old listener closes", async () => {
    const first = parse((await auth.start()).authorizeUrl).q;
    const firstPort = Number(new URL(first.get("redirect_uri") as string).port);
    await auth.start();
    expect(await refused(firstPort)).toBe(true);
    const result = await auth.handleCallback(new URLSearchParams({ code: "C", state: first.get("state") as string }));
    expect(result.status).toBe(400);
    expect(settings.value.spotify).toBeUndefined();
  });

  it("records error=access_denied, stores nothing and closes the listener", async () => {
    const { authorizeUrl } = await auth.start();
    const q = parse(authorizeUrl).q;
    const redirect = new URL(q.get("redirect_uri") as string);
    const res = await fetch(`${redirect.origin}/callback?error=access_denied&state=${q.get("state")}`);
    expect(res.status).toBe(400);
    expect(auth.lastError).toBe("Spotify sign-in was cancelled.");
    expect(settings.value.spotify).toBeUndefined();
    expect(spotify.calls).toHaveLength(0);
    expect(await refused(Number(redirect.port))).toBe(true);
  });

  it("ignores error= on an unknown state, so a stray request can't set the error", async () => {
    await auth.start();
    const result = await auth.handleCallback(new URLSearchParams({ error: "access_denied", state: "x" }));
    expect(result.status).toBe(400);
    expect(auth.lastError).toBeNull();
    expect(auth.isPending()).toBe(true);
  });

  it("answers 404 to another path or another method", async () => {
    const { authorizeUrl } = await auth.start();
    const q = parse(authorizeUrl).q;
    const origin = new URL(q.get("redirect_uri") as string).origin;
    expect((await fetch(`${origin}/`)).status).toBe(404);
    expect((await fetch(`${origin}/callback/x?state=${q.get("state")}`)).status).toBe(404);
    expect((await fetch(`${origin}/callback?code=C&state=${q.get("state")}`, { method: "POST" })).status).toBe(404);
    expect(spotify.calls).toHaveLength(0);
    expect(auth.isPending()).toBe(true);
  });

  it("HTML-escapes and never echoes request text into the page", async () => {
    const { authorizeUrl } = await auth.start();
    const q = parse(authorizeUrl).q;
    const origin = new URL(q.get("redirect_uri") as string).origin;
    const res = await fetch(`${origin}/callback?error=%3Cscript%3E&state=${q.get("state")}`);
    const html = await res.text();
    expect(html).not.toContain("<script>");
  });

  it("stores nothing and shows the tester-list line when /me says the user isn't registered", async () => {
    auth.cancel();
    auth = makeAuth({
      fetch: fakeFetch(({ url }) =>
        url.endsWith("/api/token")
          ? jsonResponse({ access_token: "A", refresh_token: "R", expires_in: 3600 })
          : new Response("User not registered in the Developer Dashboard", { status: 403 }),
      ),
    });
    const { authorizeUrl } = await auth.start();
    const state = parse(authorizeUrl).q.get("state") as string;
    const result = await auth.handleCallback(new URLSearchParams({ code: "C", state }));
    expect(result.message).toBe("This Spotify account isn't on Locally's tester list.");
    expect(auth.lastError).toBe("This Spotify account isn't on Locally's tester list.");
    expect(settings.value.spotify).toBeUndefined();
  });

  it("a failed exchange stores nothing and leaks nothing", async () => {
    auth.cancel();
    auth = makeAuth({ fetch: fakeFetch(() => new Response("secret-body", { status: 400 })) });
    const { authorizeUrl } = await auth.start();
    const state = parse(authorizeUrl).q.get("state") as string;
    const result = await auth.handleCallback(new URLSearchParams({ code: "C", state }));
    expect(result.status).toBe(400);
    expect(result.message).not.toContain("secret-body");
    expect(settings.value.spotify).toBeUndefined();
  });
});

describe("listener", () => {
  it("fails with the busy message when the port is taken", async () => {
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", r));
    const port = (blocker.address() as net.AddressInfo).port;
    try {
      auth.cancel();
      auth = makeAuth({ port });
      await expect(auth.start()).rejects.toThrow(
        `Port ${port} is in use, so Spotify sign-in can't finish. Quit what's using it and try again.`,
      );
      await expect(auth.start()).rejects.toBeInstanceOf(SpotifyAuthError);
      expect(auth.isPending()).toBe(false);
    } finally {
      blocker.close();
    }
  });

  it("closes itself after the time limit", async () => {
    auth.cancel();
    auth = new SpotifyAuth({ settings, clientId: CLIENT_ID, fetch: spotify.fn, port: 0, ttlMs: 30 });
    const q = parse((await auth.start()).authorizeUrl).q;
    const port = Number(new URL(q.get("redirect_uri") as string).port);
    await new Promise((r) => setTimeout(r, 120));
    expect(await refused(port)).toBe(true);
    expect(auth.isPending()).toBe(false);
    expect(auth.lastError).toBe("Spotify sign-in timed out. Try again.");
  });

  it("binds to 127.0.0.1 only", async () => {
    const q = parse((await auth.start()).authorizeUrl).q;
    expect(new URL(q.get("redirect_uri") as string).hostname).toBe("127.0.0.1");
  });
});

describe("Host check", () => {
  it("answers 400 to a wrong Host without touching the pending sign-in", async () => {
    const { authorizeUrl } = await auth.start();
    const q = parse(authorizeUrl).q;
    const redirect = new URL(q.get("redirect_uri") as string);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port: Number(redirect.port), path: `/callback?code=C&state=${q.get("state")}`, headers: { Host: `evil.example:${redirect.port}` } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(400);
    expect(spotify.calls).toHaveLength(0);
    expect(auth.isPending()).toBe(true);
    // The right Host still completes the sign-in.
    expect((await fetch(`${redirect.origin}/callback?code=C&state=${q.get("state")}`)).status).toBe(200);
  });
});

describe("atomic settings", () => {
  const good = (state: string) => new URLSearchParams({ code: "C", state });

  it("a disconnect during the callback's write wins", async () => {
    const state = parse((await auth.start()).authorizeUrl).q.get("state") as string;
    const release = settings.holdWrites();
    const callback = auth.handleCallback(good(state));
    await settings.holdReached; // the callback's mutator has run; its write is held open
    const disconnect = auth.disconnect();
    release();
    await Promise.all([callback, disconnect]);
    expect("spotify" in settings.value).toBe(false);
  });

  it("a disconnect queued ahead of the callback's write means nothing is stored", async () => {
    const state = parse((await auth.start()).authorizeUrl).q.get("state") as string;
    const release = settings.holdWrites();
    const unrelated = settings.update((c) => ({ ...c, trackPlays: true })); // holds the write lock
    await settings.holdReached;
    const callback = auth.handleCallback(good(state));
    await vi.waitFor(() => expect(spotify.calls).toHaveLength(2)); // exchange and /me are done; the write is queued
    const disconnect = auth.disconnect();
    release();
    await Promise.all([unrelated, callback, disconnect]);
    expect("spotify" in settings.value).toBe(false);
    expect(settings.value.trackPlays).toBe(true);
  });

  it("an unrelated save during a connect neither drops nor is dropped by the spotify block", async () => {
    const state = parse((await auth.start()).authorizeUrl).q.get("state") as string;
    const release = settings.holdWrites();
    const callback = auth.handleCallback(good(state));
    await settings.holdReached;
    const unrelated = settings.update((c) => ({ ...c, trackPlays: true }));
    release();
    await Promise.all([callback, unrelated]);
    expect(settings.value.spotify?.userId).toBe("u9");
    expect(settings.value.trackPlays).toBe(true);
  });

  it("an unrelated save during a disconnect doesn't resurrect the block", async () => {
    settings.value = { ...settings.value, spotify: { accessToken: "a", accessTokenExpiresAt: 1, refreshToken: "r", revision: "x", scopes: [], userId: "u", displayName: "d", connectedAt: "" } };
    const release = settings.holdWrites();
    const disconnect = auth.disconnect();
    await settings.holdReached;
    const unrelated = settings.update((c) => ({ ...c, trackPlays: true }));
    release();
    await Promise.all([disconnect, unrelated]);
    expect("spotify" in settings.value).toBe(false);
    expect(settings.value.trackPlays).toBe(true);
  });
});

describe("disconnect", () => {
  it("deletes the spotify block and stops a pending sign-in", async () => {
    settings.value = { ...settings.value, spotify: { accessToken: "a", accessTokenExpiresAt: 1, refreshToken: "r", revision: "x", scopes: [], userId: "u", displayName: "d", connectedAt: "" } };
    const q = parse((await auth.start()).authorizeUrl).q;
    const port = Number(new URL(q.get("redirect_uri") as string).port);
    await auth.disconnect();
    expect("spotify" in settings.value).toBe(false);
    expect(auth.isPending()).toBe(false);
    expect(await refused(port)).toBe(true);
  });
});
