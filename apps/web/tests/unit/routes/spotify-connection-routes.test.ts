import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Services } from "../../../src/server/container";
import { SpotifyAuth } from "../../../src/server/spotify/SpotifyAuth";
import { SpotifyClient } from "../../../src/server/spotify/SpotifyClient";
import { MemorySettings, SAMPLE_SPOTIFY, fakeFetch } from "../spotifyFakes";

let services: Services;
let settings: MemorySettings;
let auth: SpotifyAuth;
let clientId = "dummy";

vi.mock("../../../src/server/container", () => ({
  getServices: () => {
    if (process.env.LOCALLY_DEMO === "1") throw new Error("getServices() is not available in the demo build");
    return services;
  },
}));

// The real id is bundled; tests must not depend on it, and need to turn it off.
vi.mock("../../../src/server/spotify/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/server/spotify/config")>();
  return {
    ...actual,
    spotifyAvailable: () => process.env.LOCALLY_DEMO !== "1" && clientId.length > 0,
  };
});

import { DELETE, GET } from "../../../src/app/api/spotify/connection/route";
import { POST } from "../../../src/app/api/spotify/auth/start/route";

beforeEach(() => {
  clientId = "dummy";
  settings = new MemorySettings();
  const spotify = fakeFetch(() => new Response("", { status: 500 }));
  auth = new SpotifyAuth({ settings, clientId, fetch: spotify.fn, port: 0 });
  services = {
    settings,
    spotifyAuth: auth,
    playlistIndex: { clear: async () => undefined },
    spotifyClient: new SpotifyClient({ settings, clientId, fetch: spotify.fn }),
  } as unknown as Services;
});

afterEach(() => {
  auth.cancel();
  delete process.env.LOCALLY_DEMO;
});

describe("GET /api/spotify/connection", () => {
  it("reports disconnected without any token", async () => {
    const res = await GET();
    expect(await res.json()).toEqual({
      available: true,
      connected: false,
      displayName: null,
      scopes: [],
      pending: false,
      error: null,
    });
  });

  it("reports the name and scopes, never a token", async () => {
    settings.value = { ...settings.value, spotify: SAMPLE_SPOTIFY };
    const body = await (await GET()).text();
    expect(JSON.parse(body)).toMatchObject({ connected: true, displayName: "Sam", scopes: ["playlist-read-private"] });
    expect(body).not.toMatch(/AT-old|RT-old|accessToken|refreshToken/);
  });
});

describe("POST /api/spotify/auth/start", () => {
  it("returns the authorize URL and marks the connection pending", async () => {
    const res = await POST();
    const { authorizeUrl } = await res.json();
    expect(authorizeUrl).toMatch(/^https:\/\/accounts\.spotify\.com\/authorize\?/);
    expect((await (await GET()).json()).pending).toBe(true);
  });
});

describe("DELETE /api/spotify/connection", () => {
  it("disconnects and stops a pending sign-in", async () => {
    settings.value = { ...settings.value, spotify: SAMPLE_SPOTIFY };
    await POST();
    const res = await DELETE();
    expect(await res.json()).toMatchObject({ connected: false, pending: false });
    expect("spotify" in settings.value).toBe(false);
  });
});

describe("when the connection is off", () => {
  it("answers 404 with no client id", async () => {
    clientId = "";
    expect((await GET()).status).toBe(404);
    expect((await DELETE()).status).toBe(404);
    expect((await POST()).status).toBe(404);
  });

  it("answers 404 in the demo", async () => {
    process.env.LOCALLY_DEMO = "1";
    expect((await GET()).status).toBe(404);
    expect((await DELETE()).status).toBe(404);
    expect((await POST()).status).toBe(404);
  });
});
