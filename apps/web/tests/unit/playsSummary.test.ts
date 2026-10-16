import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "../../src/shared/errors";
import type { Release } from "../../src/shared/types";
import { formatDay, parseDay } from "../../src/server/plays/playDays";
import {
  buildPlaysSummary,
  loadPlaysSummary,
  MAX_SUMMARY_DAYS,
  parseSummaryRange,
} from "../../src/server/plays/playsSummary";
import { FakePlayCountStore } from "./FakePlayCountStore";

const R1 = "r1";
const R2 = "r2";
const GONE = "r-gone";
/** 03:30 UTC on 2026-10-16 is 23:30 on 2026-10-15 in New York, so "today" there is the 15th. */
const NOW = Date.UTC(2026, 9, 16, 3, 30);
const ZONE = "America/New_York";
const TODAY = "2026-10-15";

function release(id: string): Release {
  return { id } as Release;
}

function seededStore(): FakePlayCountStore {
  const store = new FakePlayCountStore();
  store.seed("t1", R1, 10, 0, { "2026-10-12": 2, "2026-10-14": 1, "2026-10-15": 3 });
  store.seed("t2", R1, 4); // counted before days were recorded: all time only
  store.seed("t3", R2, 6, 0, { "2026-09-30": 6 });
  store.seed("t4", GONE, 9, 0, { "2026-10-14": 9 }); // its release is no longer in the library
  return store;
}

function deps(store: FakePlayCountStore, releases: Release[] = [release(R1), release(R2)]) {
  return {
    settings: { get: async () => ({ libraryDir: "/lib", sync: null }) as never },
    library: { list: vi.fn(async () => releases) },
    playStore: store,
    now: () => NOW,
    timeZone: ZONE,
  };
}

describe("parseSummaryRange", () => {
  const parse = (from: string | null, to: string | null) => parseSummaryRange(from, to, TODAY);

  it("accepts a real range up to tomorrow", () => {
    expect(parse("2026-10-12", "2026-10-15")).toEqual({ from: "2026-10-12", to: "2026-10-15" });
    expect(parse("2026-10-16", "2026-10-16")).toEqual({ from: "2026-10-16", to: "2026-10-16" });
    expect(parse("2026-10-15", "2026-10-15")).toEqual({ from: "2026-10-15", to: "2026-10-15" });
  });

  it("refuses dates that are not real calendar dates, or not dates at all", () => {
    const bad: [string | null, string | null][] = [
      ["2026-02-30", "2026-03-05"],
      ["2026-10-01", "2026-02-30"],
      ["garbage", "2026-10-15"],
      ["2026-10-01", "garbage"],
      ["2026-10-1", "2026-10-15"],
      ["", ""],
      [null, "2026-10-15"],
      ["2026-10-01", null],
      [null, null],
    ];
    for (const [from, to] of bad) expect(() => parse(from, to), `${from} ${to}`).toThrow(ValidationError);
  });

  it("refuses from after to", () => {
    expect(() => parse("2026-10-15", "2026-10-14")).toThrow(/from must not be after to/);
  });

  it("allows 400 days with both ends counted and refuses 401", () => {
    expect(MAX_SUMMARY_DAYS).toBe(400);
    const to = parseDay("2026-10-15") as number;
    expect(() => parse(formatDay(to - 399), "2026-10-15")).not.toThrow();
    expect(() => parse(formatDay(to - 400), "2026-10-15")).toThrow(/at most 400 days/);
  });

  it("refuses a start more than 400 days back, where no buckets are kept", () => {
    const today = parseDay("2026-10-15") as number;
    expect(() => parse(formatDay(today - 400), formatDay(today - 300))).not.toThrow();
    expect(() => parse(formatDay(today - 401), formatDay(today - 300))).toThrow(/within the last 400 days/);
  });

  it("allows tomorrow, for clock skew, and refuses anything later", () => {
    expect(() => parse("2026-10-14", "2026-10-16")).not.toThrow();
    expect(() => parse("2026-10-14", "2026-10-17")).toThrow(/after tomorrow/);
    expect(() => parse("2026-10-17", "2026-10-18")).toThrow(/after tomorrow/);
  });
});

describe("buildPlaysSummary", () => {
  const live = new Set([R1, R2]);

  it("sums the plays in the range with the last day played, and lists all-time for every live track", async () => {
    const counts = await seededStore().get();
    const summary = buildPlaysSummary(counts, live, { from: "2026-10-12", to: "2026-10-16" });
    expect(summary.tracks).toEqual([{ trackId: "t1", releaseId: R1, plays: 6, lastPlayedDay: "2026-10-15" }]);
    expect(summary.allTime).toEqual([
      { trackId: "t1", releaseId: R1, plays: 10 },
      { trackId: "t2", releaseId: R1, plays: 4 },
      { trackId: "t3", releaseId: R2, plays: 6 },
    ]);
  });

  it("counts only the days inside the range, both ends included", async () => {
    const counts = await seededStore().get();
    const inner = buildPlaysSummary(counts, live, { from: "2026-10-13", to: "2026-10-14" });
    expect(inner.tracks).toEqual([{ trackId: "t1", releaseId: R1, plays: 1, lastPlayedDay: "2026-10-14" }]);
    const edges = buildPlaysSummary(counts, live, { from: "2026-10-12", to: "2026-10-12" });
    expect(edges.tracks).toEqual([{ trackId: "t1", releaseId: R1, plays: 2, lastPlayedDay: "2026-10-12" }]);
  });

  it("covers a wider range with every track that has days in it", async () => {
    const counts = await seededStore().get();
    const summary = buildPlaysSummary(counts, live, { from: "2026-09-01", to: "2026-10-16" });
    expect(summary.tracks).toEqual([
      { trackId: "t1", releaseId: R1, plays: 6, lastPlayedDay: "2026-10-15" },
      { trackId: "t3", releaseId: R2, plays: 6, lastPlayedDay: "2026-09-30" },
    ]);
  });

  it("leaves out a track with no plays in the range but keeps it in all-time", async () => {
    const counts = await seededStore().get();
    const summary = buildPlaysSummary(counts, live, { from: "2026-10-01", to: "2026-10-11" });
    expect(summary.tracks).toEqual([]);
    expect(summary.allTime.map((t) => t.trackId)).toEqual(["t1", "t2", "t3"]);
  });

  it("leaves out releases that are not live, from both lists", async () => {
    const counts = await seededStore().get();
    const summary = buildPlaysSummary(counts, new Set([R2]), { from: "2026-09-01", to: "2026-10-16" });
    expect(summary.tracks.map((t) => t.trackId)).toEqual(["t3"]);
    expect(summary.allTime.map((t) => t.trackId)).toEqual(["t3"]);
  });

  it("is empty for an empty store", () => {
    expect(buildPlaysSummary({ version: 1, tracks: {} }, live, { from: "2026-10-01", to: "2026-10-15" })).toEqual({
      tracks: [],
      allTime: [],
      countingSince: null,
      includesOtherDevices: false,
    });
  });

  it("reports the earliest day among live tracks as countingSince, whatever the range", async () => {
    const counts = await seededStore().get();
    expect(buildPlaysSummary(counts, live, { from: "2026-10-15", to: "2026-10-15" }).countingSince).toBe("2026-09-30");
    expect(buildPlaysSummary(counts, new Set([R1]), { from: "2026-10-01", to: "2026-10-15" }).countingSince).toBe(
      "2026-10-12",
    );
  });

  it("does not let a release that is not live set countingSince, and is null with no days at all", async () => {
    const counts = await seededStore().get();
    // t4 (GONE) has 2026-10-14 only, later than the live ones; give it an earlier day to prove it is ignored.
    const early = { ...counts, tracks: { ...counts.tracks, t4: { ...counts.tracks.t4, days: { "2026-01-01": 1 } } } };
    expect(buildPlaysSummary(early, live, { from: "2026-10-01", to: "2026-10-15" }).countingSince).toBe("2026-09-30");
    const none = buildPlaysSummary(counts, new Set(["no-such-release"]), { from: "2026-10-01", to: "2026-10-15" });
    expect(none.countingSince).toBeNull();
  });
});

describe("loadPlaysSummary", () => {
  it("answers from the store and the library, keeping out a release the library no longer has", async () => {
    const d = deps(seededStore(), [release(R1)]); // R2 was deleted by a sync tombstone
    const summary = await loadPlaysSummary(d, "2026-09-01", "2026-10-16");
    expect(summary.tracks).toEqual([{ trackId: "t1", releaseId: R1, plays: 6, lastPlayedDay: "2026-10-15" }]);
    expect(summary.allTime.map((t) => t.trackId)).toEqual(["t1", "t2"]);
    expect(d.library.list).toHaveBeenCalledTimes(1);
    expect(d.library.list).toHaveBeenCalledWith("/lib");
  });

  it("takes today in the Mac's zone: tomorrow there is the 16th, not the 17th", async () => {
    const d = deps(seededStore());
    await expect(loadPlaysSummary(d, "2026-10-15", "2026-10-16")).resolves.toBeDefined();
    await expect(loadPlaysSummary(d, "2026-10-15", "2026-10-17")).rejects.toBeInstanceOf(ValidationError);
  });

  it("checks the range before it reads anything", async () => {
    const store = seededStore();
    const get = vi.spyOn(store, "get");
    const d = deps(store);
    await expect(loadPlaysSummary(d, "2026-02-30", "2026-03-01")).rejects.toBeInstanceOf(ValidationError);
    expect(get).not.toHaveBeenCalled();
    expect(d.library.list).not.toHaveBeenCalled();
  });
});
