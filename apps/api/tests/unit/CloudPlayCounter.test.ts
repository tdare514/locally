import { describe, expect, it } from "vitest";
import { countSample, needsResolve, thresholdMs, type PlayerSample, type SessionState } from "../../src/server/spotify/CloudPlayCounter";

const A = "spotify:local:Artist:Album:Song:200";
const B = "spotify:local:Artist:Album:Other:200";
const SHORT = "spotify:local:Artist:Album:Short:20";
const REMOTE = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";
const IDS: Record<string, { releaseId: string; trackId: string } | null> = {
  [A]: { releaseId: "r1", trackId: "tA" },
  [B]: { releaseId: "r1", trackId: "tB" },
  [SHORT]: { releaseId: "r1", trackId: "tS" },
};

const MIN = 60_000;

/** One row of a table: minute offset, what the player said, and whether this sample must count. */
type Row = { min: number; sample: PlayerSample; counts: boolean };

function item(uri: string | null, progressMs: number, playing = true, durationMs: number | null = 200_000): PlayerSample {
  return { kind: "item", uri, progressMs, durationMs, isPlaying: playing };
}
const idle: PlayerSample = { kind: "idle" };

/** Runs the table as the sampler would: resolves only when `needsResolve` says so. Returns the final state. */
function run(rows: Row[]): { total: number; resolves: number; state: SessionState | null } {
  let state: SessionState | null = null;
  let total = 0;
  let resolves = 0;
  const t0 = 1_800_000_000_000;
  rows.forEach((row, i) => {
    let ids = null;
    if (needsResolve(state, row.sample)) {
      resolves += 1;
      ids = row.sample.kind === "item" && row.sample.uri ? (IDS[row.sample.uri] ?? null) : null;
    }
    const out = countSample(state, row.sample, t0 + row.min * MIN, ids);
    expect(out.counted, `row ${i}`).toBe(row.counts);
    if (out.counted) total += 1;
    state = out.next;
  });
  return { total, resolves, state };
}

describe("thresholdMs", () => {
  it("is min(30 s, 90% of the duration), or 30 s with no duration", () => {
    expect(thresholdMs(200_000)).toBe(30_000);
    expect(thresholdMs(20_000)).toBe(18_000);
    expect(thresholdMs(null)).toBe(30_000);
  });
});

describe("countSample (one sample a minute)", () => {
  it("counts a track playing through once, and resolves once", () => {
    const r = run([
      { min: 0, sample: item(A, 5_000), counts: false },
      { min: 1, sample: item(A, 65_000), counts: true },
      { min: 2, sample: item(A, 125_000), counts: false },
      { min: 3, sample: item(A, 185_000), counts: false },
    ]);
    expect(r.total).toBe(1);
    expect(r.resolves).toBe(1);
  });

  it("keeps the session across idle samples", () => {
    const r = run([
      { min: 0, sample: item(A, 65_000), counts: true },
      { min: 1, sample: idle, counts: false },
      { min: 2, sample: idle, counts: false },
      { min: 3, sample: item(A, 70_000), counts: false },
    ]);
    expect(r.total).toBe(1);
    expect(r.resolves).toBe(1);
  });

  it("counts a pause and resume once", () => {
    const r = run([
      { min: 0, sample: item(A, 20_000), counts: false },
      { min: 1, sample: item(A, 35_000, false), counts: true }, // progress moved forward: it played, then paused
      { min: 3, sample: item(A, 35_000, false), counts: false },
      { min: 5, sample: item(A, 45_000, true), counts: false },
      { min: 6, sample: item(A, 105_000), counts: false },
    ]);
    expect(r.total).toBe(1);
  });

  it("never counts a track first seen paused past the threshold, however many samples see it", () => {
    const r = run([
      { min: 0, sample: item(A, 90_000, false), counts: false },
      { min: 1, sample: item(A, 90_000, false), counts: false },
      { min: 2, sample: item(A, 90_000, false), counts: false },
    ]);
    expect(r.total).toBe(0);
    expect(r.state?.counted).toBe(false);
  });

  it("counts a play that passed the threshold and was paused before the next sample, once", () => {
    const r = run([
      { min: 0, sample: item(A, 20_000), counts: false },
      { min: 1, sample: item(A, 45_000, false), counts: true },
      { min: 2, sample: item(A, 45_000, false), counts: false },
    ]);
    expect(r.total).toBe(1);
  });

  it("never counts a new session first seen paused past the threshold, nor one that has not advanced", () => {
    expect(
      run([
        { min: 0, sample: item(A, 120_000, false), counts: false },
        { min: 1, sample: item(A, 120_000, false), counts: false },
      ]).total
    ).toBe(0);
    expect(
      run([
        { min: 0, sample: item(A, 20_000), counts: false },
        { min: 1, sample: item(A, 20_000, false), counts: false },
        { min: 2, sample: item(A, 20_000, false), counts: false },
      ]).total
    ).toBe(0);
  });

  it("does not count a seek back within the same play again", () => {
    const r = run([
      { min: 0, sample: item(A, 65_000), counts: true },
      { min: 1, sample: item(A, 63_000), counts: false }, // 2 s behind: same session
      { min: 2, sample: item(A, 120_000), counts: false },
    ]);
    expect(r.total).toBe(1);
  });

  it("starts a new session on a seek back of more than 3 s, and counts it once past the threshold", () => {
    const r = run([
      { min: 0, sample: item(A, 100_000), counts: true },
      { min: 1, sample: item(A, 10_000), counts: false }, // seeked to near the start: new session
      { min: 2, sample: item(A, 70_000), counts: true },
    ]);
    expect(r.total).toBe(2);
    expect(r.resolves).toBe(1);
  });

  it("counts a replay from the start (repeat) seen past the threshold while playing", () => {
    const r = run([
      { min: 0, sample: item(A, 190_000), counts: true },
      { min: 1, sample: item(A, 50_000), counts: true }, // looped: went back, new session already past 30 s
    ]);
    expect(r.total).toBe(2);
  });

  it("counts a short track at 90% of its length", () => {
    const r = run([
      { min: 0, sample: item(SHORT, 10_000, true, 20_000), counts: false },
      { min: 1, sample: item(SHORT, 18_000, true, 20_000), counts: true },
    ]);
    expect(r.total).toBe(1);
    // and a whole short track seen once at 19 s counts
    expect(run([{ min: 0, sample: item(SHORT, 19_000, true, 20_000), counts: true }]).total).toBe(1);
  });

  it("clears the session on an unmatched local item and on a non-local item, keeping nothing", () => {
    const unmatched = "spotify:local:Nobody:Nothing:Nope:100";
    let r = run([
      { min: 0, sample: item(A, 65_000), counts: true },
      { min: 1, sample: item(unmatched, 65_000), counts: false },
    ]);
    expect(r.state).toBeNull();
    r = run([
      { min: 0, sample: item(A, 65_000), counts: true },
      { min: 1, sample: item(REMOTE, 65_000), counts: false },
    ]);
    expect(r.state).toBeNull();
    r = run([
      { min: 0, sample: item(A, 65_000), counts: true },
      { min: 1, sample: item(null, 0), counts: false },
    ]);
    expect(r.state).toBeNull();
  });

  it("treats a scheduler gap over 10 minutes as a new session", () => {
    const r = run([
      { min: 0, sample: item(A, 65_000), counts: true },
      { min: 11, sample: item(A, 130_000), counts: true }, // gap: new session, already past the threshold and playing
    ]);
    expect(r.total).toBe(2);
    // exactly 10 minutes is still the same session
    expect(
      run([
        { min: 0, sample: item(A, 65_000), counts: true },
        { min: 10, sample: item(A, 130_000), counts: false },
      ]).total
    ).toBe(1);
  });

  it("counts a new session first seen past the threshold while playing (e.g. online counting just turned on)", () => {
    const r = run([{ min: 0, sample: item(A, 120_000), counts: true }]);
    expect(r.total).toBe(1);
    expect(r.state?.counted).toBe(true);
  });

  it("moving to another track starts a new session and resolves again", () => {
    const r = run([
      { min: 0, sample: item(A, 65_000), counts: true },
      { min: 1, sample: item(B, 5_000), counts: false },
      { min: 2, sample: item(B, 65_000), counts: true },
    ]);
    expect(r.total).toBe(2);
    expect(r.resolves).toBe(2);
    expect(r.state?.trackId).toBe("tB");
  });

  it("stores the sample's uri, ids, progress, duration, time and counted flag", () => {
    const r = run([{ min: 0, sample: item(A, 65_000), counts: true }]);
    expect(r.state).toEqual({
      uri: A,
      releaseId: "r1",
      trackId: "tA",
      progressMs: 65_000,
      durationMs: 200_000,
      at: 1_800_000_000_000,
      counted: true,
    });
  });
});
