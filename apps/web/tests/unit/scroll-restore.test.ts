import { describe, expect, it } from "vitest";
import { cancelRestore, restoreStep, startRestore } from "../../src/lib/scroll-restore";

describe("restoreStep", () => {
  it("waits while the content is too short, then scrolls once it is tall enough", () => {
    const s = startRestore(800, 0);
    expect(restoreStep(s, { scrollHeight: 700, clientHeight: 600, now: 100 })).toEqual({ done: false });
    expect(restoreStep(s, { scrollHeight: 1500, clientHeight: 600, now: 200 })).toEqual({ scrollTo: 800, done: true });
  });

  it("gives up after the timeout and goes as far as the page reaches", () => {
    const s = startRestore(800, 0);
    expect(restoreStep(s, { scrollHeight: 900, clientHeight: 600, now: 2999 })).toEqual({ done: false });
    expect(restoreStep(s, { scrollHeight: 900, clientHeight: 600, now: 3000 })).toEqual({ scrollTo: 300, done: true });
  });

  it("stops and moves nothing once the user scrolled", () => {
    const s = startRestore(800, 0);
    cancelRestore(s);
    expect(restoreStep(s, { scrollHeight: 5000, clientHeight: 600, now: 50 })).toEqual({ done: true });
  });

  it("a target of zero finishes at once", () => {
    expect(restoreStep(startRestore(0, 0), { scrollHeight: 100, clientHeight: 600, now: 0 })).toEqual({ scrollTo: 0, done: true });
  });
});
