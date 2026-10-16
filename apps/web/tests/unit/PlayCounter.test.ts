import { describe, expect, it } from "vitest";
import { CONTINUATION_WINDOW_MS, PlayCounter, type PlaySample } from "../../src/server/plays/PlayCounter";

const LOCAL = "spotify:local:A:B:C:200";

/** Samples every 5 s of wall clock; `pos` is the track position in seconds. */
function s(t: number, pos: number, over: Partial<PlaySample> = {}): PlaySample {
  return { at: t * 1000, running: true, state: "playing", id: LOCAL, positionSec: pos, durationMs: 200_000, ...over };
}

function run(counter: PlayCounter, samples: PlaySample[]): (string | null)[] {
  return samples.map((x) => counter.push(x));
}

describe("PlayCounter", () => {
  it("counts at 30 s of listening, not before", () => {
    const out = run(new PlayCounter(), [0, 5, 10, 15, 20, 25, 30].map((t) => s(t, t)));
    expect(out.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(out[6]).toBe(LOCAL);
  });

  it("counts once per session", () => {
    const out = run(new PlayCounter(), [0, 5, 10, 15, 20, 25, 30, 35, 40].map((t) => s(t, t)));
    expect(out.filter(Boolean)).toHaveLength(1);
  });

  it("gives no credit across a pause", () => {
    const c = new PlayCounter();
    run(c, [0, 5, 10, 15, 20].map((t) => s(t, t))); // 20 s listened
    expect(c.push(s(25, 20, { state: "paused" }))).toBeNull();
    expect(c.push(s(60, 20, { state: "paused" }))).toBeNull();
    // Resumes: first playing sample only re-anchors, even though position moved 5 s.
    expect(c.push(s(65, 25))).toBeNull(); // would be 25 s if the chain held across the gap
    expect(c.push(s(70, 30))).toBeNull(); // 25 s
    expect(c.push(s(75, 35))).toBe(LOCAL); // 30 s
  });

  it("a forward seek adds nothing", () => {
    const c = new PlayCounter();
    run(c, [0, 5, 10, 15, 20].map((t) => s(t, t))); // 20 s
    expect(c.push(s(25, 120))).toBeNull(); // jump of 100 s in 5 s
    expect(c.push(s(30, 125))).toBeNull(); // 25 s
    expect(c.push(s(35, 130))).toBe(LOCAL); // 30 s
  });

  it("repeat-one: position going back starts a new session that counts again", () => {
    const c = new PlayCounter();
    const first = run(c, [0, 5, 10, 15, 20, 25, 30].map((t) => s(t, t)));
    expect(first[6]).toBe(LOCAL);
    const second = run(c, [0, 5, 10, 15, 20, 25, 30].map((t) => s(100 + t, t)));
    expect(second.slice(0, 6).every((x) => x === null)).toBe(true);
    expect(second[6]).toBe(LOCAL);
  });

  it("a small seek back (3 s or less) stays in the session", () => {
    const c = new PlayCounter();
    run(c, [0, 5, 10, 15, 20, 25].map((t) => s(t, t))); // 25 s
    expect(c.push(s(30, 23))).toBeNull(); // back 2 s: no credit, same session
    expect(c.push(s(35, 28))).toBe(LOCAL); // 25 + 5 = 30 s
  });

  it("a track change resets the session", () => {
    const c = new PlayCounter();
    run(c, [0, 5, 10, 15, 20, 25].map((t) => s(t, t))); // 25 s on LOCAL
    const other = "spotify:local:X:Y:Z:200";
    expect(c.push(s(30, 0, { id: other }))).toBeNull();
    expect(c.push(s(35, 5, { id: other }))).toBeNull();
    // Back on the first track from its start: starts from zero.
    expect(c.push(s(40, 0))).toBeNull();
    expect(c.push(s(45, 5))).toBeNull();
    expect(c.push(s(50, 10))).toBeNull();
  });

  it("counts a 20 s track at 18 s", () => {
    const c = new PlayCounter();
    const d = { durationMs: 20_000 };
    expect(c.push(s(0, 0, d))).toBeNull();
    expect(c.push(s(5, 5, d))).toBeNull();
    expect(c.push(s(10, 10, d))).toBeNull();
    expect(c.push(s(15, 15, d))).toBeNull();
    expect(c.push(s(18, 18, d))).toBe(LOCAL);
  });

  it("uses 30 s when the duration is unknown", () => {
    const c = new PlayCounter();
    const d = { durationMs: 0 };
    const out = run(c, [0, 5, 10, 15, 20, 25, 30].map((t) => s(t, t, d)));
    expect(out.indexOf(LOCAL)).toBe(6);
  });

  it("never counts non-local ids", () => {
    const c = new PlayCounter();
    const out = run(c, [0, 5, 10, 15, 20, 25, 30, 35].map((t) => s(t, t, { id: "spotify:track:abc" })));
    expect(out.every((x) => x === null)).toBe(true);
  });

  it("not-running samples break the chain", () => {
    const c = new PlayCounter();
    run(c, [0, 5, 10, 15, 20, 25].map((t) => s(t, t)));
    expect(c.push({ at: 30_000, running: false, state: "stopped", id: null, positionSec: 0, durationMs: 0 })).toBeNull();
    expect(c.push(s(35, 30))).toBeNull(); // re-anchor only: the closed gap earns no credit
    // The same track resuming where it left off continues the same play (#228): 25 s before + 5 s now.
    expect(c.push(s(40, 35))).toBe(LOCAL);
  });
});

describe("PlayCounter memory of the last session (#228)", () => {
  const OTHER = "spotify:local:A:B:D:200";

  it("a source switch that resumes the same track further on does not count it twice", () => {
    const c = new PlayCounter();
    const out = run(c, [0, 5, 10, 15, 20, 25, 30].map((t) => s(t, t)));
    expect(out.filter(Boolean)).toHaveLength(1);
    c.push(s(35, 0, { running: false, state: "stopped", id: null })); // fell back, Mac not playing
    c.push(s(40, 0, { running: false, state: "stopped", id: null }));
    expect(run(c, [45, 50, 55, 60].map((t) => s(t, t))).filter(Boolean)).toEqual([]); // same track, further along
  });

  it("restores listened time too, so an uncounted play finishes where it left off", () => {
    const c = new PlayCounter();
    run(c, [0, 5, 10, 15, 20].map((t) => s(t, t))); // 20 s
    c.push(s(25, 0, { running: false, state: "stopped", id: null }));
    expect(c.push(s(30, 25))).toBeNull(); // re-anchors, 20 s restored
    expect(c.push(s(35, 30))).toBeNull(); // 25 s
    expect(c.push(s(40, 35))).toBe(LOCAL); // 30 s
  });

  it("a replay from the start after the reset is a new play", () => {
    const c = new PlayCounter();
    run(c, [0, 5, 10, 15, 20, 25, 30].map((t) => s(t, t)));
    c.push(s(35, 0, { running: false, state: "stopped", id: null }));
    const out = run(c, [40, 45, 50, 55, 60, 65, 70].map((t, i) => s(t, i * 5)));
    expect(out.filter(Boolean)).toHaveLength(1);
  });

  it("a position too far ahead for the time passed is a new play", () => {
    const c = new PlayCounter();
    run(c, [0, 5, 10, 15, 20, 25, 30].map((t) => s(t, t)));
    c.push(s(35, 0, { running: false, state: "stopped", id: null }));
    // 5 s later but 100 s further on: a seek, not a continuation.
    const out = run(c, [40, 45, 50, 55, 60, 65, 70].map((t, i) => s(t, 130 + i * 5)));
    expect(out.filter(Boolean)).toHaveLength(1);
  });

  it("A resumed further on after a different track B continues (no second count)", () => {
    const c = new PlayCounter();
    expect(run(c, [0, 5, 10, 15, 20, 25, 30].map((t) => s(t, t))).filter(Boolean)).toHaveLength(1);
    c.push(s(35, 0, { id: OTHER, positionSec: 0, state: "paused" })); // fallback: the Mac's paused track B
    c.push(s(40, 0, { id: OTHER, positionSec: 0, state: "paused" }));
    const out = run(c, [45, 50, 55, 60, 65, 70, 75].map((t, i) => s(t, 40 + i * 5)));
    expect(out.filter(Boolean)).toHaveLength(0);
  });

  it("A started from the beginning after a different track B is a new play", () => {
    const c = new PlayCounter();
    run(c, [0, 5, 10, 15, 20, 25, 30].map((t) => s(t, t)));
    c.push(s(35, 0, { id: OTHER, positionSec: 0, state: "paused" }));
    const out = run(c, [40, 45, 50, 55, 60, 65, 70].map((t, i) => s(t, i * 5)));
    expect(out.filter(Boolean)).toHaveLength(1);
  });

  it("remembers at most 8 tracks, dropping the oldest", () => {
    const c = new PlayCounter();
    run(c, [0, 5, 10, 15, 20, 25, 30].map((t) => s(t, t))); // LOCAL counts
    for (let i = 0; i < 8; i++) c.push(s(35 + i, 0, { id: `spotify:local:X:Y:T${i}:100`, state: "paused" }));
    const out = run(c, [50, 55, 60, 65, 70, 75, 80].map((t, i) => s(t, 40 + i * 5)));
    expect(out.filter(Boolean)).toHaveLength(1); // LOCAL was forgotten: counts again
  });

  it("a replay first seen 20 minutes later, beyond the remembered position, is a new play", () => {
    const c = new PlayCounter();
    run(c, [0, 5, 10, 15, 20, 25, 30].map((t) => s(t, t)));
    c.push(s(35, 0, { running: false, state: "stopped", id: null }));
    const later = 35 + 20 * 60;
    const out = run(c, [0, 5, 10, 15, 20, 25, 30].map((d, i) => s(later + d, 35 + i * 5)));
    expect(out.filter(Boolean)).toHaveLength(1);
    expect(CONTINUATION_WINDOW_MS).toBe(600_000);
  });
});
