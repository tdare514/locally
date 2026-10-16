import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Release } from "../../src/shared/types";
import type { PlayCounts } from "../../src/server/plays/PlayCountStore";
import { buildPlaysSummary, loadPlaysSummary, mergeServerSummary } from "../../src/server/plays/playsSummary";
import {
  resetServerSummaryState,
  SUMMARY_BACKOFF_MS,
  SUMMARY_CACHE_MS,
} from "../../src/server/plays/serverSummary";
import { SyncRequestError, type SyncApi } from "../../src/server/sync/SyncApi";
import { FakePlayCountStore } from "./FakePlayCountStore";

const R1 = "r1";
const GONE = "r-gone";
const NOW = Date.UTC(2026, 9, 15, 12);
const RANGE = { from: "2026-10-12", to: "2026-10-15" };
const live = new Set([R1]);

function counts(tracks: PlayCounts["tracks"], daysInSync?: boolean): PlayCounts {
  return daysInSync ? { version: 1, tracks, daysInSync } : { version: 1, tracks };
}

function merge(c: PlayCounts, server: { tracks?: { trackId: string; releaseId: string; plays: number; lastPlayedDay: string }[]; allTime?: { trackId: string; releaseId: string; plays: number }[] }) {
  return mergeServerSummary(buildPlaysSummary(c, live, RANGE), c, live, RANGE, {
    tracks: server.tracks ?? [],
    allTime: server.allTime ?? [],
  });
}

describe("mergeServerSummary (#202)", () => {
  it("other device only: adds the service's plays to a track this Mac never played", () => {
    const out = merge(counts({}), {
      tracks: [{ trackId: "t1", releaseId: R1, plays: 3, lastPlayedDay: "2026-10-14" }],
      allTime: [{ trackId: "t1", releaseId: R1, plays: 7 }],
    });
    expect(out.tracks).toEqual([{ trackId: "t1", releaseId: R1, plays: 3, lastPlayedDay: "2026-10-14" }]);
    expect(out.allTime).toEqual([{ trackId: "t1", releaseId: R1, plays: 7 }]);
    expect(out.includesOtherDevices).toBe(true);
  });

  it("this Mac only with every day pushed: no double count", () => {
    const c = counts({ t1: { releaseId: R1, count: 5, pushed: 5, days: { "2026-10-14": 2, "2026-10-15": 3 }, pushedDays: { "2026-10-14": 2, "2026-10-15": 3 } } }, true);
    const out = merge(c, {
      tracks: [{ trackId: "t1", releaseId: R1, plays: 5, lastPlayedDay: "2026-10-15" }],
      allTime: [{ trackId: "t1", releaseId: R1, plays: 5 }],
    });
    expect(out.tracks).toEqual([{ trackId: "t1", releaseId: R1, plays: 5, lastPlayedDay: "2026-10-15" }]);
    expect(out.allTime).toEqual([{ trackId: "t1", releaseId: R1, plays: 5 }]);
  });

  it("right after a reset (markers gone, daysInSync false) with the service holding this Mac's old days: no double count", () => {
    const c = counts({ t1: { releaseId: R1, count: 5, pushed: 0, days: { "2026-10-14": 2, "2026-10-15": 3 } } });
    const out = merge(c, {
      tracks: [{ trackId: "t1", releaseId: R1, plays: 5, lastPlayedDay: "2026-10-15" }],
      allTime: [{ trackId: "t1", releaseId: R1, plays: 5 }],
    });
    expect(out.tracks[0].plays).toBe(5);
    expect(out.allTime[0].plays).toBe(5);
  });

  it("an unpushed new local day with daysInSync true is exact", () => {
    const c = counts(
      { t1: { releaseId: R1, count: 6, pushed: 5, days: { "2026-10-14": 2, "2026-10-15": 4 }, pushedDays: { "2026-10-14": 2, "2026-10-15": 3 } } },
      true,
    );
    const out = merge(c, {
      tracks: [{ trackId: "t1", releaseId: R1, plays: 5, lastPlayedDay: "2026-10-15" }],
      allTime: [{ trackId: "t1", releaseId: R1, plays: 5 }],
    });
    expect(out.tracks[0].plays).toBe(6);
    expect(out.allTime[0].plays).toBe(6);
  });

  it("a day with no marker while in sync was never accepted, so another device's plays still add", () => {
    const c = counts({ t1: { releaseId: R1, count: 2, pushed: 2, days: { "2026-10-15": 2 } } }, true);
    const out = merge(c, { tracks: [{ trackId: "t1", releaseId: R1, plays: 3, lastPlayedDay: "2026-10-15" }] });
    expect(out.tracks[0].plays).toBe(5);
  });

  it("lastPlayedDay comes from another device when it is later", () => {
    const c = counts({ t1: { releaseId: R1, count: 1, pushed: 1, days: { "2026-10-12": 1 }, pushedDays: { "2026-10-12": 1 } } }, true);
    const out = merge(c, { tracks: [{ trackId: "t1", releaseId: R1, plays: 3, lastPlayedDay: "2026-10-15" }] });
    expect(out.tracks).toEqual([{ trackId: "t1", releaseId: R1, plays: 3, lastPlayedDay: "2026-10-15" }]);
  });

  it("all time: local count plus what the service holds beyond this Mac's pushed count", () => {
    const c = counts({ t1: { releaseId: R1, count: 8, pushed: 5 } }, true);
    const out = merge(c, { allTime: [{ trackId: "t1", releaseId: R1, plays: 9 }] });
    // service 9 = 5 from this Mac + 4 elsewhere; local 8 -> 12.
    expect(out.allTime).toEqual([{ trackId: "t1", releaseId: R1, plays: 12 }]);
  });

  it("drops a release that is not in the library, from both lists", () => {
    const out = merge(counts({}), {
      tracks: [{ trackId: "t9", releaseId: GONE, plays: 4, lastPlayedDay: "2026-10-14" }],
      allTime: [{ trackId: "t9", releaseId: GONE, plays: 4 }],
    });
    expect(out.tracks).toEqual([]);
    expect(out.allTime).toEqual([]);
  });

  it("keeps countingSince as this Mac's", () => {
    const c = counts({ t1: { releaseId: R1, count: 1, pushed: 0, days: { "2026-10-01": 1 } } });
    expect(merge(c, {}).countingSince).toBe("2026-10-01");
  });
});

describe("loadPlaysSummary with the service (#202)", () => {
  let store: FakePlayCountStore;
  let playsSummary: ReturnType<typeof vi.fn>;
  let nowMs: number;
  let signedIn: boolean;

  const page = { tracks: [{ trackId: "t1", releaseId: R1, plays: 4, lastPlayedDay: "2026-10-14" }], allTime: [{ trackId: "t1", releaseId: R1, plays: 4 }], nextCursor: null };

  const load = () =>
    loadPlaysSummary(
      {
        settings: { get: async () => ({ libraryDir: "/lib", sync: signedIn ? { baseUrl: "http://x", deviceToken: "tok", email: "a@b", lastVersion: 0 } : null }) as never },
        library: { list: async () => [{ id: R1 } as Release] },
        playStore: store,
        syncApiFactory: () => ({ playsSummary }) as unknown as SyncApi,
        now: () => nowMs,
        timeZone: "UTC",
      },
      RANGE.from,
      RANGE.to,
    );

  beforeEach(() => {
    resetServerSummaryState();
    store = new FakePlayCountStore();
    playsSummary = vi.fn(async () => page);
    nowMs = NOW;
    signedIn = true;
  });

  it("signed out never asks the service", async () => {
    signedIn = false;
    const out = await load();
    expect(playsSummary).not.toHaveBeenCalled();
    expect(out.includesOtherDevices).toBe(false);
  });

  it("merges, and a second call within 60 s uses the cache", async () => {
    expect((await load()).includesOtherDevices).toBe(true);
    nowMs += SUMMARY_CACHE_MS - 1;
    expect((await load()).includesOtherDevices).toBe(true);
    expect(playsSummary).toHaveBeenCalledTimes(1);
    nowMs += 2;
    await load();
    expect(playsSummary).toHaveBeenCalledTimes(2);
  });

  it("follows nextCursor, at most 20 pages", async () => {
    playsSummary.mockImplementation(async () => ({ tracks: [], allTime: [], nextCursor: "c" }));
    await load();
    expect(playsSummary).toHaveBeenCalledTimes(20);
    playsSummary.mockClear();
    resetServerSummaryState();
    playsSummary.mockImplementationOnce(async () => ({ ...page, nextCursor: "t1" })).mockImplementationOnce(async () => ({ tracks: [], allTime: [], nextCursor: null }));
    await load();
    expect(playsSummary.mock.calls.map((c) => c[2])).toEqual([undefined, "t1"]);
  });

  it("a failing service gives local-only, and is asked again next time", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    playsSummary.mockRejectedValueOnce(new Error("offline"));
    expect((await load()).includesOtherDevices).toBe(false);
    expect((await load()).includesOtherDevices).toBe(true);
  });

  it.each([429, 404])("after a %i the service is left alone for 10 minutes", async (status) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    playsSummary.mockRejectedValueOnce(new SyncRequestError("no", status));
    expect((await load()).includesOtherDevices).toBe(false);
    nowMs += SUMMARY_BACKOFF_MS - 1;
    expect((await load()).includesOtherDevices).toBe(false);
    expect(playsSummary).toHaveBeenCalledTimes(1);
    nowMs += 2;
    expect((await load()).includesOtherDevices).toBe(true);
    expect(playsSummary).toHaveBeenCalledTimes(2);
  });
});
