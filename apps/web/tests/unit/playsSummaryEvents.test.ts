import { describe, expect, it } from "vitest";
import type { PlayCounts } from "../../src/server/plays/PlayCountStore";
import type { PlayEvent } from "../../src/server/plays/PlayEventStore";
import { buildPlaysSummary, mergeServerSummary } from "../../src/server/plays/playsSummary";

const live = new Set(["r1"]);
const RANGE = { from: "2026-10-12", to: "2026-10-15" };
const counts: PlayCounts = {
  version: 1,
  tracks: { t1: { releaseId: "r1", count: 0, pushed: 0, locally: { count: 3, pushed: 0, days: { "2026-10-14": 2, "2026-10-15": 1 } } } },
};
const ev = (id: string, startedAt: number, day: string, listenedMs: number, pushedListenedMs: number | null = null, releaseId = "r1"): PlayEvent => ({
  id, releaseId, trackId: "t1", source: "locally", startedAt, day, listenedMs, pushedListenedMs, counted: true,
});
const A = ev("a", Date.UTC(2026, 9, 14, 9), "2026-10-14", 100_000);
const B = ev("b", Date.UTC(2026, 9, 15, 20), "2026-10-15", 50_000);
const OLD = ev("c", Date.UTC(2026, 9, 1, 9), "2026-10-01", 7_000); // outside the range

describe("the local summary with play events (#398)", () => {
  it("a signed-out Mac counts its own events: latest start, summed ms and count, by day for the range", () => {
    const s = buildPlaysSummary(counts, live, RANGE, [A, B, OLD]);
    expect(s.tracks[0]).toMatchObject({ trackId: "t1", plays: 3, lastPlayedAt: B.startedAt, listenedMs: 150_000, events: 2 });
    expect(s.allTime[0]).toMatchObject({ plays: 3, lastPlayedAt: B.startedAt, listenedMs: 157_000, events: 3 });
  });

  it("without events the entries carry no event fields, and events of a removed release are left out", () => {
    const none = buildPlaysSummary(counts, live, RANGE);
    expect(none.tracks[0]).not.toHaveProperty("events");
    const gone = buildPlaysSummary(counts, live, RANGE, [ev("z", B.startedAt, "2026-10-15", 9000, null, "gone")]);
    expect(gone.tracks[0]).not.toHaveProperty("listenedMs");
  });
});

describe("merged with the service's summary (#398)", () => {
  const server = {
    tracks: [{ trackId: "t1", releaseId: "r1", plays: 3, devicePlays: 3, lastPlayedDay: "2026-10-15", lastPlayedAt: 1000, listenedMs: 40_000, events: 1 }],
    allTime: [{ trackId: "t1", releaseId: "r1", plays: 3, devicePlays: 3, lastPlayedAt: 1000, listenedMs: 40_000, events: 1 }],
  };
  const merge = (events: PlayEvent[]) => mergeServerSummary(buildPlaysSummary(counts, live, RANGE, events), counts, live, RANGE, server, events);

  it("takes the max lastPlayedAt and sums listenedMs and events with what this Mac has not pushed", () => {
    const s = merge([A, B]);
    expect(s.tracks[0]).toMatchObject({ lastPlayedAt: B.startedAt, listenedMs: 40_000 + 150_000, events: 1 + 2 });
  });

  it("an event already pushed in full adds nothing (the service holds it), one raised since adds the difference", () => {
    const s = merge([{ ...A, pushedListenedMs: 100_000 }, { ...B, pushedListenedMs: 30_000 }]);
    expect(s.tracks[0]).toMatchObject({ listenedMs: 40_000 + 20_000, events: 1 });
    expect(s.tracks[0].lastPlayedAt).toBe(B.startedAt);
  });

  it("a service without event fields leaves this Mac's own to show", () => {
    const old = { tracks: [{ trackId: "t1", releaseId: "r1", plays: 3, lastPlayedDay: "2026-10-15" }], allTime: [] };
    const s = mergeServerSummary(buildPlaysSummary(counts, live, RANGE, [A]), counts, live, RANGE, old, [A]);
    expect(s.tracks[0]).toMatchObject({ lastPlayedAt: A.startedAt, listenedMs: 100_000, events: 1 });
  });
});
