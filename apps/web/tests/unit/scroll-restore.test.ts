import { describe, expect, it } from "vitest";
import { cancelRestore, restoreStep, startRestore } from "../../src/lib/scroll-restore";

const tall = { scrollHeight: 1500, clientHeight: 600 };
const short = { scrollHeight: 700, clientHeight: 600 };

describe("restoreStep", () => {
  it("waits while the content is too short, then scrolls once it is tall enough", () => {
    const s = startRestore(800, 0);
    expect(restoreStep(s, { ...short, now: 100, ready: true })).toEqual({ done: false });
    expect(restoreStep(s, { ...tall, now: 200, ready: true })).toEqual({ scrollTo: 800, done: true });
  });

  it("gives up 3 s after readiness and goes as far as the page reaches", () => {
    const s = startRestore(800, 0);
    const m = { scrollHeight: 900, clientHeight: 600 };
    expect(restoreStep(s, { ...m, now: 1000, ready: true })).toEqual({ done: false });
    expect(restoreStep(s, { ...m, now: 3999, ready: true })).toEqual({ done: false });
    expect(restoreStep(s, { ...m, now: 4000, ready: true })).toEqual({ scrollTo: 300, done: true });
  });

  it("stops and moves nothing once the user scrolled", () => {
    const s = startRestore(800, 0);
    cancelRestore(s);
    expect(restoreStep(s, { ...tall, now: 50, ready: true })).toEqual({ done: true });
  });

  it("a cancel while waiting for readiness moves nothing", () => {
    const s = startRestore(800, 0);
    expect(restoreStep(s, { ...short, now: 100, ready: false })).toEqual({ done: false });
    cancelRestore(s);
    expect(restoreStep(s, { ...tall, now: 6000, ready: true })).toEqual({ done: true });
  });

  it("readiness after 5 s with tall content scrolls to the target", () => {
    const s = startRestore(800, 0);
    expect(restoreStep(s, { ...short, now: 5000, ready: false })).toEqual({ done: false });
    expect(restoreStep(s, { ...tall, now: 5100, ready: true })).toEqual({ scrollTo: 800, done: true });
  });

  it("never ready: gives up at 20 s without moving", () => {
    const s = startRestore(800, 0);
    expect(restoreStep(s, { ...short, now: 19999, ready: false })).toEqual({ done: false });
    expect(restoreStep(s, { ...short, now: 20000, ready: false })).toEqual({ done: true });
  });

  it("a target of zero finishes at once when ready", () => {
    expect(restoreStep(startRestore(0, 0), { scrollHeight: 100, clientHeight: 600, now: 0, ready: true })).toEqual({ scrollTo: 0, done: true });
  });
});
