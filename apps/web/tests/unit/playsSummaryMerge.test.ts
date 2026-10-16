import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Release } from "../../src/shared/types";
import type { PlayCounts } from "../../src/server/plays/PlayCountStore";
import { buildPlaysSummary, loadPlaysSummary, mergeServerSummary } from "../../src/server/plays/playsSummary";
import {
  invalidateServerSummary,
  MAX_SUMMARY_PAGES,
  readServerSummary,
  resetServerSummaryState,
  SUMMARY_BACKOFF_MS,
  SUMMARY_PAGE_BUDGET,
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

  it("a push landing during the summary read never counts this Mac twice (service read first)", async () => {
    store.seed("t1", R1, 6, 5, { "2026-10-15": 6 }, { "2026-10-15": 5 });
    store.seedDaysInSync(true);
    playsSummary.mockImplementation(async () => {
      // The push lands while the request is in flight: marker 5 -> 6, and the service now holds 6 + 3.
      await store.markPushed({ t1: 6 }, store.pushedEpoch(), { t1: { "2026-10-15": 6 } });
      return { tracks: [{ trackId: "t1", releaseId: R1, plays: 9, lastPlayedDay: "2026-10-15" }], allTime: [], nextCursor: null };
    });

    const out = await load();

    expect(out.tracks[0].plays).toBe(9);
    expect(out.tracks[0].plays).not.toBe(10);
  });

  it("a push invalidates the cached service summary, so the next read refetches and stays exact", async () => {
    store.seed("t1", R1, 5, 5, { "2026-10-15": 5 }, { "2026-10-15": 5 });
    store.seedDaysInSync(true);
    const reply = (plays: number) => ({ tracks: [{ trackId: "t1", releaseId: R1, plays, lastPlayedDay: "2026-10-15" }], allTime: [], nextCursor: null });
    playsSummary.mockResolvedValueOnce(reply(8));
    expect((await load()).tracks[0].plays).toBe(8);

    store.seed("t1", R1, 6, 6, { "2026-10-15": 6 }, { "2026-10-15": 6 });
    store.seedDaysInSync(true);
    invalidateServerSummary();
    playsSummary.mockResolvedValueOnce(reply(9));

    expect((await load()).tracks[0].plays).toBe(9);
    expect(playsSummary).toHaveBeenCalledTimes(2);
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

describe("readServerSummary state (#202)", () => {
  const T0 = Date.UTC(2026, 9, 15, 12);
  const emptyPage = { tracks: [], allTime: [], nextCursor: null };
  const pageOf = (plays: number) => ({
    tracks: [{ trackId: "t1", releaseId: R1, plays, lastPlayedDay: "2026-10-15" }],
    allTime: [],
    nextCursor: null,
  });
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
  const apiOf = (playsSummary: unknown) => ({ playsSummary }) as unknown as SyncApi;

  beforeEach(() => {
    resetServerSummaryState();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("gives null (this Mac only) when pages are still pending after the page guard", async () => {
    let n = 0;
    const endless = vi.fn(async () => ({ ...pageOf(1), nextCursor: `c${++n}` }));
    expect(await readServerSummary(apiOf(endless), "A", "2026-10-01", "2026-10-15", T0)).toBeNull();
    expect(endless).toHaveBeenCalledTimes(MAX_SUMMARY_PAGES);
    // Nothing partial was cached: the next read asks again.
    await readServerSummary(apiOf(endless), "A", "2026-10-01", "2026-10-15", T0 + 1);
    expect(endless).toHaveBeenCalledTimes(SUMMARY_PAGE_BUDGET); // the hourly page budget stops it
  });

  it("a read from a superseded identity neither fills the cache nor backs off the new identity", async () => {
    const a = deferred<typeof emptyPage>();
    const callsA = vi.fn(() => a.promise);
    const readA = readServerSummary(apiOf(callsA), "A", "2026-10-01", "2026-10-15", T0);
    const callsB = vi.fn(async () => pageOf(2));
    const readB = readServerSummary(apiOf(callsB), "B", "2026-10-01", "2026-10-15", T0);
    expect((await readB)?.tracks[0].plays).toBe(2);

    a.reject(new SyncRequestError("slow", 429));
    expect(await readA).toBeNull();

    // B's cached read is B's, and A's late 429 did not back B off.
    expect((await readServerSummary(apiOf(callsB), "B", "2026-10-01", "2026-10-15", T0 + 1))?.tracks[0].plays).toBe(2);
    expect(callsB).toHaveBeenCalledTimes(1);
    expect((await readServerSummary(apiOf(callsB), "B", "2026-10-02", "2026-10-15", T0 + 1))?.tracks[0].plays).toBe(2);
    expect(callsB).toHaveBeenCalledTimes(2);
  });

  it("a late success from a superseded identity is not cached for the new one", async () => {
    const a = deferred<ReturnType<typeof pageOf>>();
    const readA = readServerSummary(apiOf(vi.fn(() => a.promise)), "A", "2026-10-01", "2026-10-15", T0);
    const callsB = vi.fn(async () => pageOf(2));
    await readServerSummary(apiOf(callsB), "B", "2026-10-01", "2026-10-15", T0);
    a.resolve(pageOf(99));
    expect((await readA)?.tracks[0].plays).toBe(99); // its own caller still gets it
    expect((await readServerSummary(apiOf(callsB), "B", "2026-10-01", "2026-10-15", T0 + 1))?.tracks[0].plays).toBe(2);
  });

  it("a read started before an invalidation is not cached", async () => {
    const d = deferred<ReturnType<typeof pageOf>>();
    const calls = vi.fn().mockImplementationOnce(() => d.promise).mockResolvedValue(pageOf(7));
    const first = readServerSummary(apiOf(calls), "A", "2026-10-01", "2026-10-15", T0);
    invalidateServerSummary();
    d.resolve(pageOf(1));
    await first;
    expect((await readServerSummary(apiOf(calls), "A", "2026-10-01", "2026-10-15", T0 + 1))?.tracks[0].plays).toBe(7);
  });

  it("two concurrent reads of the same range make one call", async () => {
    const d = deferred<typeof emptyPage>();
    const calls = vi.fn(() => d.promise);
    const one = readServerSummary(apiOf(calls), "A", "2026-10-01", "2026-10-15", T0);
    const two = readServerSummary(apiOf(calls), "A", "2026-10-01", "2026-10-15", T0);
    d.resolve(emptyPage);
    await Promise.all([one, two]);
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("a 429 on one range stops another loop before its next page", async () => {
    const x = deferred<unknown>();
    const y = deferred<unknown>();
    const calls = vi.fn().mockImplementationOnce(() => x.promise).mockImplementationOnce(() => y.promise);
    const readX = readServerSummary(apiOf(calls), "A", "2026-10-01", "2026-10-15", T0);
    const readY = readServerSummary(apiOf(calls), "A", "2026-09-01", "2026-09-30", T0);
    x.reject(new SyncRequestError("slow", 429));
    await readX;
    y.resolve({ ...emptyPage, nextCursor: "c" });
    expect(await readY).toBeNull();
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("makes no more than 30 page requests in a rolling hour", async () => {
    const calls = vi.fn(async () => emptyPage);
    const api = apiOf(calls);
    for (let i = 0; i < SUMMARY_PAGE_BUDGET + 1; i++) {
      const day = String(1 + (i % 28)).padStart(2, "0");
      const month = i < 28 ? "09" : "08";
      await readServerSummary(api, "A", `2026-${month}-${day}`, "2026-10-15", T0);
    }
    expect(calls).toHaveBeenCalledTimes(SUMMARY_PAGE_BUDGET);
    // An hour later the budget is back.
    await readServerSummary(api, "A", "2026-07-01", "2026-10-15", T0 + 60 * 60_000 + 1);
    expect(calls).toHaveBeenCalledTimes(SUMMARY_PAGE_BUDGET + 1);
  });
});
