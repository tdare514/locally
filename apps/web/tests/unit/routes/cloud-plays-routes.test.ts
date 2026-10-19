import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Services } from "../../../src/server/container";
import { CloudPlays } from "../../../src/server/spotify/CloudPlays";
import { SyncRequestError, SyncUnavailableError, type SpotifyLinkStatus, type SyncApi } from "../../../src/server/sync/SyncApi";
import { MemorySettings } from "../spotifyFakes";

let services: Services;
let status: SpotifyLinkStatus | "unavailable";
let authorizeUrl: string;
let startError: Error | null;
let unlinks: number;

vi.mock("../../../src/server/container", () => ({
  getServices: () => {
    if (process.env.LOCALLY_DEMO === "1") throw new Error("getServices() is not available in the demo build");
    return services;
  },
}));

import { DELETE, GET, POST } from "../../../src/app/api/spotify/cloud/route";

beforeEach(() => {
  status = { linked: false };
  authorizeUrl = "https://accounts.spotify.com/authorize?state=abc";
  startError = null;
  unlinks = 0;
  const settings = new MemorySettings();
  settings.value = {
    libraryDir: "/lib",
    sync: { baseUrl: "http://fake", deviceToken: "tok", email: "a@b.com", lastVersion: 0 },
  };
  const api = {
    spotifyLinkStatus: async () => {
      if (status === "unavailable") throw new SyncUnavailableError("no");
      return status;
    },
    spotifyLinkStart: async () => {
      if (startError) throw startError;
      return { authorizeUrl };
    },
    spotifyUnlink: async () => {
      unlinks++;
      status = { linked: false };
    },
  } as unknown as SyncApi;
  services = { settings, cloudPlays: new CloudPlays({ settings, apiFactory: () => api }) } as unknown as Services;
});

afterEach(() => {
  services.cloudPlays.stop();
  delete process.env.LOCALLY_DEMO;
});

describe("/api/spotify/cloud (#307)", () => {
  it("GET reports the status", async () => {
    status = { linked: true, since: "s", lastSampleAt: "2026-10-19T11:59:00Z", problem: "reconnect" };
    const res = await GET();
    expect(await res.json()).toEqual({
      available: true,
      linked: true,
      lastSampleAt: "2026-10-19T11:59:00Z",
      problem: "reconnect",
      pending: false,
    });
  });

  it("GET says unavailable when signed out", async () => {
    (services.settings as MemorySettings).value = { libraryDir: "/lib", sync: null };
    expect(await (await GET()).json()).toMatchObject({ available: false });
  });

  it("GET says unavailable when the service answers 404", async () => {
    status = "unavailable";
    expect(await (await GET()).json()).toMatchObject({ available: false });
  });

  it("POST returns Spotify's address and the row goes pending", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authorizeUrl });
    expect(await (await GET()).json()).toMatchObject({ pending: true });
  });

  it("POST refuses an address that is not Spotify's", async () => {
    authorizeUrl = "https://evil.example/authorize";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST();
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("evil.example");
  });

  it("POST maps a rate limit to 429 and a missing feature to 404", async () => {
    startError = new SyncRequestError("raw server text", 429);
    const limited = await POST();
    expect(limited.status).toBe(429);
    expect(JSON.stringify(await limited.json())).not.toContain("raw server text");
    startError = new SyncUnavailableError("no");
    expect((await POST()).status).toBe(404);
  });

  it("DELETE unlinks and returns the new status", async () => {
    status = { linked: true, since: "s", lastSampleAt: null, problem: null };
    const res = await DELETE();
    expect(unlinks).toBe(1);
    expect(await res.json()).toMatchObject({ linked: false });
  });

  it("is a 404 in the demo for every method", async () => {
    process.env.LOCALLY_DEMO = "1";
    expect((await GET()).status).toBe(404);
    expect((await POST()).status).toBe(404);
    expect((await DELETE()).status).toBe(404);
  });
});
