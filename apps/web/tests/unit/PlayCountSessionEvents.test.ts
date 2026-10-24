import { describe, expect, it } from "vitest";
import { PlayCountSession, PROGRESS_STEP_MS, type PlayReport, type QueueItem } from "../../src/lib/play-queue";

const item: QueueItem = { releaseId: "r1", trackId: "a1" };

function setup() {
  const counted: PlayReport[] = [];
  const progress: PlayReport[] = [];
  const session = new PlayCountSession((_i, p) => counted.push(p), (_i, p) => progress.push(p));
  let at = 1_000_000;
  const play = (from: number, to: number, playing = true) => {
    for (let pos = from; pos <= to; pos++) session.sample(item, { at: (at += 1000), playing, positionSec: pos, durationSec: 300 });
  };
  const pause = (n: number, pos: number) => {
    for (let i = 0; i < n; i++) session.sample(item, { at: (at += 1000), playing: false, positionSec: pos, durationSec: 300 });
  };
  return { session, counted, progress, play, pause, at: () => at };
}

describe("PlayCountSession reports the session's start and audible time (#398)", () => {
  it("at the count point: the session start and the ms heard so far", () => {
    const s = setup();
    s.play(0, 30);
    expect(s.counted).toEqual([{ startedAt: 1_001_000, listenedMs: 30_000 }]);
    expect(s.progress).toEqual([]);
  });

  it("a pause reports the grown time once; paused time earns nothing", () => {
    const s = setup();
    s.play(0, 35);
    s.pause(20, 35);
    expect(s.progress).toEqual([{ startedAt: 1_001_000, listenedMs: 35_000 }]);
  });

  it("a forward seek is not audible time", () => {
    const s = setup();
    s.play(0, 31);
    s.play(200, 205); // jumped 170 s ahead; the next 5 s are heard
    s.pause(1, 205);
    expect(s.progress.at(-1)?.listenedMs).toBe(36_000);
  });

  it("a skip reports the old session's final time, and the new one is its own session", () => {
    const s = setup();
    s.play(0, 33);
    s.session.sample({ releaseId: "r1", trackId: "a2" }, { at: s.at() + 1000, playing: true, positionSec: 0, durationSec: 300 });
    expect(s.progress).toEqual([{ startedAt: 1_001_000, listenedMs: 33_000 }]);
    expect(s.counted).toHaveLength(1);
  });

  it("finishing (the queue empties) reports the final time", () => {
    const s = setup();
    s.play(0, 45);
    s.session.sample(null, { at: s.at() + 1000, playing: false, positionSec: 0, durationSec: 0 });
    expect(s.progress).toEqual([{ startedAt: 1_001_000, listenedMs: 45_000 }]);
  });

  it("reports again as listening goes on, every PROGRESS_STEP_MS", () => {
    const s = setup();
    s.play(0, 100);
    expect(s.progress.map((p) => p.listenedMs)).toEqual([60_000, 90_000]);
    expect(PROGRESS_STEP_MS).toBe(30_000);
  });

  it("nothing is reported for a play that never counted", () => {
    const s = setup();
    s.play(0, 20);
    s.pause(5, 20);
    s.session.sample(null, { at: s.at() + 1000, playing: false, positionSec: 0, durationSec: 0 });
    expect(s.counted).toEqual([]);
    expect(s.progress).toEqual([]);
  });
});
