import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TokenCipher } from "../../src/server/crypto/TokenCipher";
import { SpotifyLinkService } from "../../src/server/spotify/SpotifyLinkService";
import { InMemoryRateLimiter } from "../../src/server/ratelimit/InMemoryRateLimiter";
import { createTestServices, type TestServices } from "../support/testServices";

let testServices: TestServices;

vi.mock("../../src/server/container", () => ({
  getServices: async () => testServices,
}));

import * as linkRoute from "../../src/app/v1/spotify/link/route";
import * as callbackRoute from "../../src/app/v1/spotify/callback/route";

const URL_BASE = "http://localhost/v1/spotify";

async function signIn(email: string): Promise<string> {
  const code = await testServices.auth.issueCode(email);
  return (await testServices.auth.verify({ email, code, deviceName: "D", platform: "mac" })).token;
}

function req(path: string, method: string, token?: string, body?: unknown): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(`${URL_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function startLink(token: string, timeZone = "UTC"): Promise<string> {
  const res = await linkRoute.POST(req("/link", "POST", token, { timeZone }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { authorizeUrl: string }).authorizeUrl;
}

beforeEach(async () => {
  testServices = await createTestServices();
  const fakeFetch = (async () =>
    Response.json({ access_token: "A", refresh_token: "R", expires_in: 3600, scope: "user-read-playback-state" })) as unknown as typeof fetch;
  testServices.spotify = new SpotifyLinkService(
    testServices.db,
    new TokenCipher(crypto.randomBytes(32)),
    { clientId: "cid", redirectUri: "https://sync.example.com/v1/spotify/callback" },
    fakeFetch
  );
});

describe("Spotify routes", () => {
  it("link, callback, status and delete work end to end", async () => {
    const token = await signIn("a@example.com");
    const authorizeUrl = await startLink(token);
    const state = new URL(authorizeUrl).searchParams.get("state")!;

    const cb = await callbackRoute.GET(new Request(`${URL_BASE}/callback?code=abc&state=${encodeURIComponent(state)}`));
    expect(cb.status).toBe(200);
    expect(cb.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(cb.headers.get("cache-control")).toBe("no-store");
    expect(cb.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'");
    expect(cb.headers.get("referrer-policy")).toBe("no-referrer");
    expect(cb.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await cb.text()).toContain("Spotify is linked to Locally. You can close this tab.");

    const status = await linkRoute.GET(req("/link", "GET", token));
    expect(await status.json()).toMatchObject({ linked: true, lastSampleAt: null, problem: null });

    const del = await linkRoute.DELETE(req("/link", "DELETE", token));
    expect(del.status).toBe(204);
    expect(await (await linkRoute.GET(req("/link", "GET", token))).json()).toEqual({ linked: false });
    expect((await linkRoute.DELETE(req("/link", "DELETE", token))).status).toBe(204);
  });

  it("callback failures show a fixed page that echoes nothing from the request", async () => {
    const res = await callbackRoute.GET(new Request(`${URL_BASE}/callback?error=%3Cscript%3Eevil%3C/script%3E&state=zzz-marker`));
    const text = await res.text();
    expect(res.status).toBe(400);
    expect(text).toContain("Spotify wasn't linked. Close this tab and try again from Locally.");
    expect(text).not.toContain("evil");
    expect(text).not.toContain("zzz-marker");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'");
    const missing = await callbackRoute.GET(new Request(`${URL_BASE}/callback`));
    expect(missing.status).toBe(400);
  });

  it("requires a device token and a valid body", async () => {
    expect((await linkRoute.POST(req("/link", "POST", undefined, { timeZone: "UTC" }))).status).toBe(401);
    expect((await linkRoute.GET(req("/link", "GET"))).status).toBe(401);
    expect((await linkRoute.DELETE(req("/link", "DELETE"))).status).toBe(401);
    const token = await signIn("a@example.com");
    expect((await linkRoute.POST(req("/link", "POST", token, {}))).status).toBe(400);
    expect((await linkRoute.POST(req("/link", "POST", token, { timeZone: "Nowhere/Land" }))).status).toBe(400);
  });

  it("another user's token cannot see or delete a link", async () => {
    const a = await signIn("a@example.com");
    const b = await signIn("b@example.com");
    const state = new URL(await startLink(a)).searchParams.get("state")!;
    await callbackRoute.GET(new Request(`${URL_BASE}/callback?code=abc&state=${state}`));

    expect(await (await linkRoute.GET(req("/link", "GET", b))).json()).toEqual({ linked: false });
    await linkRoute.DELETE(req("/link", "DELETE", b));
    expect(await (await linkRoute.GET(req("/link", "GET", a))).json()).toMatchObject({ linked: true });
  });

  it("rate limits link starts to 10 an hour per user", async () => {
    const a = await signIn("a@example.com");
    const b = await signIn("b@example.com");
    for (let i = 0; i < 10; i++) await startLink(a);
    expect((await linkRoute.POST(req("/link", "POST", a, { timeZone: "UTC" }))).status).toBe(429);
    expect((await linkRoute.POST(req("/link", "POST", b, { timeZone: "UTC" }))).status).toBe(200);
    expect(testServices.rateLimiters.spotifyLink).toBeInstanceOf(InMemoryRateLimiter);
  });

  it("answers 404 on every route when the feature is off", async () => {
    const token = await signIn("a@example.com");
    testServices.spotify = null;
    expect((await linkRoute.POST(req("/link", "POST", token, { timeZone: "UTC" }))).status).toBe(404);
    expect((await linkRoute.GET(req("/link", "GET", token))).status).toBe(404);
    expect((await linkRoute.DELETE(req("/link", "DELETE", token))).status).toBe(404);
    expect((await callbackRoute.GET(new Request(`${URL_BASE}/callback?code=a&state=b`))).status).toBe(404);
  });
});
