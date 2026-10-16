import os from "node:os";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Services } from "../../../src/server/container";
import type { PlaysStatus, PlaysSummaryResponse, Release, ReleasePlaysResponse, Settings } from "../../../src/shared/types";
import type { SyncApi } from "../../../src/server/sync/SyncApi";
import { resetServerSummaryState } from "../../../src/server/plays/serverSummary";
import { FakePlayCountStore } from "../FakePlayCountStore";

let services: Services;
let status: PlaysStatus;
let source: "account" | "this-mac";
let fallingBack: boolean;
let playStore: FakePlayCountStore;
let settingsValue: Settings;
let liveReleases: Release[];
let releasePlays: ReturnType<typeof vi.fn>;
let syncApiFactory: ReturnType<typeof vi.fn>;

vi.mock("../../../src/server/container", () => ({
  getServices: () => services,
}));

import { GET as playsGET } from "../../../src/app/api/plays/route";
import { GET } from "../../../src/app/api/plays/status/route";
import { GET as summaryGET } from "../../../src/app/api/plays/summary/route";

const REL = "3f2a6c1e-8b7d-4e5a-9c1d-2a4b6c8d0e1f";
const TRACK = "a1b2c3d4-0001-4a5b-8c9d-0123456789ab";

beforeEach(() => {
  status = "off";
  source = "this-mac";
  fallingBack = false;
  playStore = new FakePlayCountStore();
  settingsValue = { libraryDir: "/tmp/lib", sync: null };
  liveReleases = [];
  releasePlays = vi.fn(async () => ({ tracks: [] }));
  syncApiFactory = vi.fn(() => ({ releasePlays }) as unknown as SyncApi);
  services = {
    playTracker: { status: () => status },
    nowPlaying: { currentSource: () => source, fallingBack: () => fallingBack },
    playStore,
    library: { list: async () => liveReleases },
    settings: { get: async () => settingsValue, set: async (s: Settings) => s, update: async (m: (c: Settings) => Settings | null) => m(settingsValue) ?? settingsValue },
    syncApiFactory,
  } as unknown as Services;
});

describe("GET /api/plays/status", () => {
  it("returns the tracker status", async () => {
    for (const s of ["off", "on", "spotify-not-running", "permission-denied"] as const) {
      status = s;
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: s, source: "this-mac", fallingBack: false });
    }
  });

  it("returns the source and whether it is falling back (#228)", async () => {
    status = "on";
    source = "account";
    expect(await (await GET()).json()).toEqual({ status: "on", source: "account", fallingBack: false });
    source = "this-mac";
    fallingBack = true;
    expect(await (await GET()).json()).toEqual({ status: "on", source: "this-mac", fallingBack: true });
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

describe("GET /api/plays/summary (#200)", () => {
  const REL2 = "9b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8";
  const TRACK2 = "a1b2c3d4-0002-4a5b-8c9d-0123456789ab";
  const GONE_REL = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b";
  const GONE_TRACK = "a1b2c3d4-0003-4a5b-8c9d-0123456789ab";

  function summaryRequest(query: string): NextRequest {
    return new NextRequest(`http://localhost/api/plays/summary${query}`);
  }

  beforeEach(() => {
    // Only Date is faked. Noon UTC on 15 Oct is the 15th or, east of UTC+12, the 16th, so the
    // dates below keep clear of that edge; the exact zone edge is tested in playsSummary.test.ts.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    liveReleases = [{ id: REL } as Release, { id: REL2 } as Release];
    playStore.seed(TRACK, REL, 10, 0, { "2026-10-12": 2, "2026-10-14": 1, "2026-10-15": 3 });
    playStore.seed(TRACK2, REL2, 4); // counted before days were recorded
    playStore.seed(GONE_TRACK, GONE_REL, 9, 0, { "2026-10-14": 9 }); // a release that is no longer in the library
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("returns the plays in the range with the last day played, and all-time totals, for live releases only", async () => {
    const res = await summaryGET(summaryRequest("?from=2026-10-12&to=2026-10-15"));

    expect(res.status).toBe(200);
    expect((await res.json()) as PlaysSummaryResponse).toEqual({
      tracks: [{ trackId: TRACK, releaseId: REL, plays: 6, lastPlayedDay: "2026-10-15" }],
      allTime: [
        { trackId: TRACK, releaseId: REL, plays: 10 },
        { trackId: TRACK2, releaseId: REL2, plays: 4 },
      ],
      countingSince: "2026-10-12",
      includesOtherDevices: false,
    });
  });

  it("totals a different period from the same store", async () => {
    const res = await summaryGET(summaryRequest("?from=2026-10-13&to=2026-10-14"));

    expect(((await res.json()) as PlaysSummaryResponse).tracks).toEqual([
      { trackId: TRACK, releaseId: REL, plays: 1, lastPlayedDay: "2026-10-14" },
    ]);
  });

  it("drops a deleted or tombstoned release from both lists", async () => {
    liveReleases = [{ id: REL2 } as Release];

    const res = await summaryGET(summaryRequest("?from=2026-10-01&to=2026-10-15"));

    expect((await res.json()) as PlaysSummaryResponse).toEqual({
      tracks: [],
      allTime: [{ trackId: TRACK2, releaseId: REL2, plays: 4 }],
      countingSince: null,
      includesOtherDevices: false,
    });
  });

  it("merges the service's summary when signed in, and answers local-only when it fails", async () => {
    resetServerSummaryState();
    settingsValue = {
      libraryDir: "/tmp/lib",
      sync: { baseUrl: "http://localhost:4000", deviceToken: "tok-123", email: "a@b.com", lastVersion: 0 },
    };
    const playsSummary = vi.fn(async () => ({
      tracks: [{ trackId: TRACK, releaseId: REL, plays: 9, lastPlayedDay: "2026-10-15" }],
      allTime: [{ trackId: TRACK, releaseId: REL, plays: 14 }],
      nextCursor: null,
    }));
    syncApiFactory = vi.fn(() => ({ playsSummary }) as unknown as SyncApi);
    (services as { syncApiFactory: unknown }).syncApiFactory = syncApiFactory;

    const res = await summaryGET(summaryRequest("?from=2026-10-12&to=2026-10-15"));

    const body = (await res.json()) as PlaysSummaryResponse;
    expect(res.status).toBe(200);
    expect(playsSummary).toHaveBeenCalledWith("2026-10-12", "2026-10-15", undefined);
    // Nothing pushed and not in sync: the service's 9 may be this Mac's own 6, so +3 from elsewhere.
    expect(body.includesOtherDevices).toBe(true);
    expect(body.tracks).toEqual([{ trackId: TRACK, releaseId: REL, plays: 9, lastPlayedDay: "2026-10-15" }]);
    expect(JSON.stringify(body)).not.toContain("tok-123");

    resetServerSummaryState();
    playsSummary.mockRejectedValueOnce(new Error("offline"));
    const failed = await summaryGET(summaryRequest("?from=2026-10-12&to=2026-10-15"));
    expect(((await failed.json()) as PlaysSummaryResponse).includesOtherDevices).toBe(false);
  });

  it("accepts a range that ends tomorrow", async () => {
    const res = await summaryGET(summaryRequest("?from=2026-10-12&to=2026-10-16"));
    expect(res.status).toBe(200);
  });

  it.each([
    ["no dates", ""],
    ["no to", "?from=2026-10-01"],
    ["no from", "?to=2026-10-15"],
    ["empty dates", "?from=&to="],
    ["a day that does not exist", "?from=2026-02-30&to=2026-10-15"],
    ["a to that does not exist", "?from=2026-10-01&to=2026-02-30"],
    ["garbage", "?from=garbage&to=2026-10-15"],
    ["a timestamp", `?from=${encodeURIComponent("2026-10-01T00:00:00Z")}&to=2026-10-15`],
    ["from after to", "?from=2026-10-15&to=2026-10-14"],
    ["a range over 400 days", "?from=2025-09-01&to=2026-10-15"],
    ["a to beyond tomorrow", "?from=2026-10-12&to=2026-10-20"],
  ])("is 400 with the usual error shape for %s, before anything is read", async (_name, query) => {
    const get = vi.spyOn(playStore, "get");

    const res = await summaryGET(summaryRequest(query));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: unknown };
    expect(Object.keys(body)).toEqual(["error"]);
    expect(typeof body.error).toBe("string");
    expect(get).not.toHaveBeenCalled();
    expect(syncApiFactory).not.toHaveBeenCalled();
  });

  it("answers an empty summary in the public demo without touching the services", async () => {
    vi.stubEnv("LOCALLY_DEMO", "1");
    services = {} as unknown as Services;

    const res = await summaryGET(summaryRequest("?from=2026-10-12&to=2026-10-15"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tracks: [], allTime: [], countingSince: null, includesOtherDevices: false });
  });
});
