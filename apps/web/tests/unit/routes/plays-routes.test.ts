import os from "node:os";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Services } from "../../../src/server/container";
import type { PlaysStatus, ReleasePlaysResponse, Settings } from "../../../src/shared/types";
import type { SyncApi } from "../../../src/server/sync/SyncApi";
import { FakePlayCountStore } from "../FakePlayCountStore";

let services: Services;
let status: PlaysStatus;
let playStore: FakePlayCountStore;
let settingsValue: Settings;
let releasePlays: ReturnType<typeof vi.fn>;
let syncApiFactory: ReturnType<typeof vi.fn>;

vi.mock("../../../src/server/container", () => ({
  getServices: () => services,
}));

import { GET as playsGET } from "../../../src/app/api/plays/route";
import { GET } from "../../../src/app/api/plays/status/route";

const REL = "3f2a6c1e-8b7d-4e5a-9c1d-2a4b6c8d0e1f";
const TRACK = "a1b2c3d4-0001-4a5b-8c9d-0123456789ab";

beforeEach(() => {
  status = "off";
  playStore = new FakePlayCountStore();
  settingsValue = { libraryDir: "/tmp/lib", sync: null };
  releasePlays = vi.fn(async () => ({ tracks: [] }));
  syncApiFactory = vi.fn(() => ({ releasePlays }) as unknown as SyncApi);
  services = {
    playTracker: { status: () => status },
    playStore,
    settings: { get: async () => settingsValue, set: async (s: Settings) => s },
    syncApiFactory,
  } as unknown as Services;
});

describe("GET /api/plays/status", () => {
  it("returns the tracker status", async () => {
    for (const s of ["off", "on", "spotify-not-running", "permission-denied"] as const) {
      status = s;
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: s });
    }
  });
});

function playsRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/plays${query}`);
}

describe("GET /api/plays", () => {
  it("returns this Mac's total for the release when signed out, without calling the service", async () => {
    playStore.seed(TRACK, REL, 12);

    const res = await playsGET(playsRequest(`?releaseId=${REL}`));

    expect(res.status).toBe(200);
    const body = (await res.json()) as ReleasePlaysResponse;
    expect(body.tracks).toEqual([
      { trackId: TRACK, total: 12, devices: [{ name: "This Mac", platform: "mac", count: 12, current: true }] },
    ]);
    expect(syncApiFactory).not.toHaveBeenCalled();
  });

  it("is an empty list for a release with no plays", async () => {
    const res = await playsGET(playsRequest(`?releaseId=${REL}`));
    expect(await res.json()).toEqual({ tracks: [] });
  });

  it("merges the service's other devices when signed in, with one service call and the device token", async () => {
    settingsValue = {
      libraryDir: "/tmp/lib",
      sync: { baseUrl: "http://localhost:4000", deviceToken: "tok-123", email: "a@b.com", lastVersion: 0 },
    };
    playStore.seed(TRACK, REL, 3);
    releasePlays.mockResolvedValueOnce({
      tracks: [
        {
          trackId: TRACK,
          total: 6,
          devices: [
            { deviceId: "d1", name: "Mac", platform: "mac", count: 1, current: true },
            { deviceId: "d2", name: "iPhone 14", platform: "ios", count: 5, current: false },
          ],
        },
      ],
    });

    const res = await playsGET(playsRequest(`?releaseId=${REL}`));

    const body = (await res.json()) as ReleasePlaysResponse;
    expect(body.tracks).toHaveLength(1);
    expect(body.tracks[0].total).toBe(8); // 3 here (ahead of the service's 1) + 5 on the phone
    expect(syncApiFactory).toHaveBeenCalledTimes(1);
    expect(syncApiFactory).toHaveBeenCalledWith("http://localhost:4000", "tok-123");
    expect(releasePlays).toHaveBeenCalledWith(REL);
    expect(JSON.stringify(body)).not.toContain("tok-123");
  });

  it("counts this Mac's revoked old device row once, matching it by os.hostname()", async () => {
    settingsValue = {
      libraryDir: "/tmp/lib",
      sync: { baseUrl: "http://localhost:4000", deviceToken: "tok-123", email: "a@b.com", lastVersion: 0 },
    };
    playStore.seed(TRACK, REL, 5);
    releasePlays.mockResolvedValueOnce({
      tracks: [
        {
          trackId: TRACK,
          total: 5,
          devices: [{ deviceId: "old", name: os.hostname(), platform: "mac", count: 5, current: false }],
        },
      ],
    });

    const res = await playsGET(playsRequest(`?releaseId=${REL}`));

    expect(((await res.json()) as ReleasePlaysResponse).tracks[0].total).toBe(5);
  });

  it("still answers with this Mac's counts when the service is unreachable", async () => {
    settingsValue = {
      libraryDir: "/tmp/lib",
      sync: { baseUrl: "http://localhost:4000", deviceToken: "tok-123", email: "a@b.com", lastVersion: 0 },
    };
    playStore.seed(TRACK, REL, 3);
    releasePlays.mockRejectedValueOnce(new Error("network unreachable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const res = await playsGET(playsRequest(`?releaseId=${REL}`));
    warn.mockRestore();

    expect(res.status).toBe(200);
    expect(((await res.json()) as ReleasePlaysResponse).tracks[0].total).toBe(3);
  });

  it.each([
    ["no releaseId", ""],
    ["an empty releaseId", "?releaseId="],
    ["a word", "?releaseId=abc"],
    ["a path", "?releaseId=../../etc/passwd"],
    ["an encoded path", `?releaseId=${encodeURIComponent("../x")}`],
    ["a UUID with a suffix", `?releaseId=${REL}/plays`],
    ["a UUID with a space", `?releaseId=${encodeURIComponent(`${REL} `)}`],
  ])("is 400 for %s, before anything is read or sent", async (_name, query) => {
    const res = await playsGET(playsRequest(query));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "releaseId must be a UUID" });
    expect(syncApiFactory).not.toHaveBeenCalled();
  });
});
