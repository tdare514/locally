import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Services } from "../../../src/server/container";
import type { PlayTotalsResponse, Release, Settings } from "../../../src/shared/types";
import { FakePlayCountStore } from "../FakePlayCountStore";

let services: Services;
let playStore: FakePlayCountStore;
let settingsValue: Settings;
let releases: Release[];
let listCalls: string[];
let syncApiFactory: ReturnType<typeof vi.fn>;
let storeError: Error | null;

vi.mock("../../../src/server/container", () => ({
  getServices: () => services,
}));

import { GET } from "../../../src/app/api/plays/totals/route";

const REL_A = "3f2a6c1e-8b7d-4e5a-9c1d-2a4b6c8d0e1f";
const REL_B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const GONE = "11111111-2222-4333-8444-555555555555";
const T1 = "a1b2c3d4-0001-4a5b-8c9d-0123456789ab";
const T2 = "a1b2c3d4-0002-4a5b-8c9d-0123456789ab";
const T3 = "a1b2c3d4-0003-4a5b-8c9d-0123456789ab";

function release(id: string): Release {
  return {
    id,
    kind: "single",
    title: "Title",
    artist: "Artist",
    year: null,
    genre: null,
    coverPath: null,
    folderPath: `/tmp/lib/Artist/${id}`,
    tracks: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  playStore = new FakePlayCountStore();
  settingsValue = { libraryDir: "/tmp/lib", sync: null };
  releases = [release(REL_A), release(REL_B)];
  listCalls = [];
  storeError = null;
  syncApiFactory = vi.fn(() => {
    throw new Error("the sync service must not be asked for the sidebar's totals");
  });
  services = {
    playStore: {
      get: async () => {
        if (storeError) throw storeError;
        return playStore.get();
      },
    },
    settings: { get: async () => settingsValue, set: async (s: Settings) => s },
    library: {
      list: async (dir: string) => {
        listCalls.push(dir);
        return releases;
      },
    },
    syncApiFactory,
  } as unknown as Services;
});

describe("GET /api/plays/totals (#154)", () => {
  it("lists this Mac's count for every counted track of the library in one response", async () => {
    playStore.seed(T1, REL_A, 12);
    playStore.seed(T2, REL_A, 3);
    playStore.seed(T3, REL_B, 40);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = (await res.json()) as PlayTotalsResponse;
    expect([...body.tracks].sort((a, b) => a.trackId.localeCompare(b.trackId))).toEqual([
      { releaseId: REL_A, trackId: T1, total: 12 },
      { releaseId: REL_A, trackId: T2, total: 3 },
      { releaseId: REL_B, trackId: T3, total: 40 },
    ]);
    expect(listCalls).toEqual(["/tmp/lib"]);
  });

  it("leaves out counts for releases that are no longer in the library, and counts of zero", async () => {
    playStore.seed(T1, REL_A, 5);
    playStore.seed(T2, GONE, 99);
    playStore.seed(T3, REL_B, 0);

    const body = (await (await GET()).json()) as PlayTotalsResponse;

    expect(body.tracks).toEqual([{ releaseId: REL_A, trackId: T1, total: 5 }]);
  });

  it("is an empty list when nothing has been counted", async () => {
    expect(await (await GET()).json()).toEqual({ tracks: [] });
  });

  it("never asks the sync service, even when signed in", async () => {
    settingsValue = {
      libraryDir: "/tmp/lib",
      sync: { baseUrl: "http://localhost:4000", deviceToken: "tok-123", email: "a@b.com", lastVersion: 0 },
    };
    playStore.seed(T1, REL_A, 7);

    const res = await GET();

    expect(syncApiFactory).not.toHaveBeenCalled();
    const text = JSON.stringify(await res.json());
    expect(text).toContain('"total":7');
    expect(text).not.toContain("tok-123");
  });

  it("takes no input, so nothing from the request reaches the store", () => {
    expect(GET).toHaveLength(0);
  });

  it("maps a store failure to a 500 without leaking its message", async () => {
    storeError = new Error("EACCES: /Users/someone/secret/path/plays.json");

    const res = await GET();

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain("/Users/someone/secret/path");
  });
});
