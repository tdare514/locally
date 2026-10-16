import { describe, expect, it } from "vitest";
import { SpotifyApiError, SpotifyClient } from "../../src/server/spotify/SpotifyClient";
import { MemorySettings, SAMPLE_SPOTIFY, fakeFetch, formOf, jsonResponse, type Call } from "./spotifyFakes";

const NOW = 2_000_000;
const TOKEN_URL = "https://accounts.spotify.com/api/token";

function setup(handler: (call: Call) => Response | Promise<Response>, expiresAt = NOW + 3_600_000) {
  const settings = new MemorySettings();
  settings.value = { ...settings.value, spotify: { ...SAMPLE_SPOTIFY, accessTokenExpiresAt: expiresAt } };
  const spotify = fakeFetch(handler);
  const client = new SpotifyClient({ settings, clientId: "dummy", fetch: spotify.fn, now: () => NOW });
  return { settings, spotify, client };
}

async function fail(p: Promise<unknown>): Promise<SpotifyApiError> {
  try {
    await p;
  } catch (e) {
    return e as SpotifyApiError;
  }
  throw new Error("expected a rejection");
}

const refreshOk = (extra: object = {}) => jsonResponse({ access_token: "AT-new", expires_in: 3600, ...extra });

describe("getAccessToken", () => {
  it("returns the stored token when it is not near expiry", async () => {
    const { client, spotify } = setup(() => refreshOk());
    expect(await client.getAccessToken()).toBe("AT-old");
    expect(spotify.calls).toHaveLength(0);
  });

  it("refreshes within 60 s of expiry and keeps the refresh token when none is returned", async () => {
    const { client, spotify, settings } = setup(() => refreshOk(), NOW + 59_000);
    expect(await client.getAccessToken()).toBe("AT-new");
    const form = formOf(spotify.calls[0]);
    expect(spotify.calls[0].url).toBe(TOKEN_URL);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("RT-old");
    expect(form.get("client_id")).toBe("dummy");
    expect(settings.value.spotify?.refreshToken).toBe("RT-old");
    expect(settings.value.spotify?.accessTokenExpiresAt).toBe(NOW + 3_600_000);
    expect(settings.value.spotify?.userId).toBe("u1");
  });

  it("does not refresh at 61 s left", async () => {
    const { client, spotify } = setup(() => refreshOk(), NOW + 61_000);
    await client.getAccessToken();
    expect(spotify.calls).toHaveLength(0);
  });

  it("keeps a rotated refresh token", async () => {
    const { client, settings } = setup(() => refreshOk({ refresh_token: "RT-rotated" }), NOW + 1000);
    await client.getAccessToken();
    expect(settings.value.spotify?.refreshToken).toBe("RT-rotated");
  });

  it("shares one refresh between concurrent callers", async () => {
    const { client, spotify } = setup(() => refreshOk(), NOW);
    const tokens = await Promise.all([client.getAccessToken(), client.getAccessToken()]);
    expect(tokens).toEqual(["AT-new", "AT-new"]);
    expect(spotify.calls).toHaveLength(1);
  });

  it("invalid_grant clears the stored tokens and says to connect again", async () => {
    const { client, settings } = setup(() => jsonResponse({ error: "invalid_grant" }, { status: 400 }), NOW);
    const err = await fail(client.getAccessToken());
    expect(err).toBeInstanceOf(SpotifyApiError);
    expect(err.code).toBe("disconnected");
    expect(err.message).toBe("Spotify sign-in expired. Connect again.");
    expect("spotify" in settings.value).toBe(false);
    expect(client.lastError).toBe("Spotify sign-in expired. Connect again.");
  });

  it("offline during refresh keeps the tokens", async () => {
    const { client, settings } = setup(() => {
      throw new TypeError("fetch failed");
    }, NOW);
    const err = await fail(client.getAccessToken());
    expect(err.code).toBe("offline");
    expect(settings.value.spotify?.refreshToken).toBe("RT-old");
  });

  it("is disconnected when nothing is stored", async () => {
    const settings = new MemorySettings();
    const client = new SpotifyClient({ settings, clientId: "dummy", fetch: fakeFetch(() => refreshOk()).fn });
    expect((await fail(client.getAccessToken())).code).toBe("disconnected");
  });
});

describe("a refresh is bound to its connection", () => {
  const ACCOUNT_B = { ...SAMPLE_SPOTIFY, accessToken: "AT-B", refreshToken: "RT-B", revision: "rev-B", userId: "uB", accessTokenExpiresAt: NOW + 3_600_000 };

  it("a successful refresh for A leaves a reconnected B untouched", async () => {
    const made = setup(() => {
      made.settings.value = { ...made.settings.value, spotify: ACCOUNT_B }; // the user signs in as B mid-refresh
      return refreshOk({ refresh_token: "RT-A-rotated" });
    }, NOW);
    const settings = made.settings;
    expect(await made.client.getAccessToken()).toBe("AT-B");
    expect(settings.value.spotify).toEqual(ACCOUNT_B);
  });

  it("a failing refresh for A does not delete a reconnected B", async () => {
    const made = setup(() => {
      made.settings.value = { ...made.settings.value, spotify: ACCOUNT_B };
      return jsonResponse({ error: "invalid_grant" }, { status: 400 });
    }, NOW);
    const settings = made.settings;
    await fail(made.client.getAccessToken());
    expect(settings.value.spotify).toEqual(ACCOUNT_B);
    expect(made.client.lastError).toBeNull();
  });

  it("a refresh finishing after a disconnect stores nothing", async () => {
    const made = setup(() => {
      const { spotify: _gone, ...rest } = made.settings.value;
      void _gone;
      made.settings.value = rest;
      return refreshOk();
    }, NOW);
    const settings = made.settings;
    expect((await fail(made.client.getAccessToken())).code).toBe("disconnected");
    expect("spotify" in settings.value).toBe(false);
  });
});

describe("request", () => {
  it("sends the bearer token to the API and parses JSON", async () => {
    const { client, spotify } = setup(() => jsonResponse({ id: "x" }));
    expect(await client.request("/me")).toEqual({ id: "x" });
    expect(spotify.calls[0].url).toBe("https://api.spotify.com/v1/me");
    expect((spotify.calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer AT-old");
  });

  it("on a 401 refreshes and retries once", async () => {
    let apiCalls = 0;
    const { client, spotify } = setup(({ url, init }) => {
      if (url === TOKEN_URL) return refreshOk();
      apiCalls++;
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === "Bearer AT-new" ? jsonResponse({ ok: true }) : new Response("", { status: 401 });
    });
    expect(await client.request("/me")).toEqual({ ok: true });
    expect(apiCalls).toBe(2);
    expect(spotify.calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1);
  });

  it("does not retry a second 401", async () => {
    let apiCalls = 0;
    const { client } = setup(({ url }) => {
      if (url === TOKEN_URL) return refreshOk();
      apiCalls++;
      return new Response("", { status: 401 });
    });
    const err = await fail(client.request("/me"));
    expect(err.code).toBe("http");
    expect(apiCalls).toBe(2);
  });

  it("maps a 403 'not registered' to notOnTesterList", async () => {
    const { client } = setup(
      () => new Response(JSON.stringify({ error: { status: 403, message: "User not registered in the Developer Dashboard" } }), { status: 403 }),
    );
    const err = await fail(client.request("/me"));
    expect(err.code).toBe("notOnTesterList");
    expect(err.message).toBe("This Spotify account isn't on Locally's tester list.");
  });

  it("maps a 429 to rateLimited with Retry-After", async () => {
    const { client } = setup(() => new Response("", { status: 429, headers: { "Retry-After": "7" } }));
    const err = await fail(client.request("/me"));
    expect(err.code).toBe("rateLimited");
    expect(err.retryAfterSec).toBe(7);
  });

  it("maps a network error to offline", async () => {
    const { client } = setup(() => {
      throw new TypeError("fetch failed");
    });
    expect((await fail(client.request("/me"))).code).toBe("offline");
  });

  it("refuses to send the token outside api.spotify.com", async () => {
    const { client, spotify } = setup(() => jsonResponse({}));
    await expect(client.request("https://evil.example/v1/me")).rejects.toBeInstanceOf(SpotifyApiError);
    await expect(client.request("https://api.spotify.com.evil.example/v1/me")).rejects.toBeInstanceOf(SpotifyApiError);
    expect(spotify.calls).toHaveLength(0);
  });

  it("never puts a token in an error message", async () => {
    const { client } = setup(() => new Response("AT-old RT-old", { status: 500 }));
    const err = await fail(client.request("/me"));
    expect(err.message).not.toMatch(/AT-old|RT-old/);
  });
});

describe("requestOptional (#228)", () => {
  it("returns null on a 204 and parses JSON otherwise", async () => {
    const { client } = setup((c) => (c.url.endsWith("/none") ? new Response(null, { status: 204 }) : jsonResponse({ a: 1 })));
    expect(await client.requestOptional("/none")).toBeNull();
    expect(await client.requestOptional("/some")).toEqual({ a: 1 });
  });

  it("shares the URL guard and the 401 refresh with request", async () => {
    let n = 0;
    const { client, spotify } = setup((c) => {
      if (c.url === TOKEN_URL) return refreshOk();
      return n++ === 0 ? new Response("", { status: 401 }) : new Response(null, { status: 204 });
    });
    expect(await client.requestOptional("/me/player")).toBeNull();
    expect(spotify.calls.map((c) => c.url)).toEqual([
      "https://api.spotify.com/v1/me/player",
      TOKEN_URL,
      "https://api.spotify.com/v1/me/player",
    ]);
    const e = await fail(client.requestOptional("https://evil.example/x"));
    expect(e.code).toBe("http");
  });
});
