import { describe, expect, it } from "vitest";
import type { PlayCounts } from "../../src/server/plays/PlayCountStore";
import { localPlayTotals } from "../../src/server/plays/playTotals";

const counts = (tracks: PlayCounts["tracks"]): PlayCounts => ({ version: 1, tracks });

describe("localPlayTotals", () => {
  it("lists the counted tracks of live releases with the release each belongs to", () => {
    const out = localPlayTotals(
      counts({
        t1: { releaseId: "r1", count: 4, pushed: 4 },
        t2: { releaseId: "r2", count: 1, pushed: 0 },
      }),
      new Set(["r1", "r2"]),
    );
    expect(out.tracks).toEqual([
      { releaseId: "r1", trackId: "t1", total: 4 },
      { releaseId: "r2", trackId: "t2", total: 1 },
    ]);
  });

  it("reports this Mac's count, not what was pushed", () => {
    const out = localPlayTotals(counts({ t1: { releaseId: "r1", count: 9, pushed: 2 } }), new Set(["r1"]));
    expect(out.tracks[0].total).toBe(9);
  });

  it("leaves out releases that are not live and counts of zero", () => {
    const out = localPlayTotals(
      counts({
        t1: { releaseId: "deleted", count: 8, pushed: 0 },
        t2: { releaseId: "r1", count: 0, pushed: 0 },
        t3: { releaseId: "r1", count: 2, pushed: 0 },
      }),
      new Set(["r1"]),
    );
    expect(out.tracks).toEqual([{ releaseId: "r1", trackId: "t3", total: 2 }]);
  });

  it("is empty for an empty store or an empty library", () => {
    expect(localPlayTotals(counts({}), new Set(["r1"]))).toEqual({ tracks: [] });
    expect(localPlayTotals(counts({ t1: { releaseId: "r1", count: 3, pushed: 0 } }), new Set())).toEqual({ tracks: [] });
  });
});
