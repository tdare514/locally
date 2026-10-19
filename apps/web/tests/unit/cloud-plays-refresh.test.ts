import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOUD_PLAYS_REREAD_MS, watchCloudPlays } from "../../src/lib/cloud-plays-refresh";

class FakeTarget {
  listeners = new Map<string, Set<() => void>>();
  visibilityState = "visible";
  addEventListener(type: string, fn: () => void) {
    (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string) {
    this.listeners.get(type)?.forEach((fn) => fn());
  }
  count() {
    return [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
  }
}

let win: FakeTarget;
let doc: FakeTarget;
let refresh: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  vi.useFakeTimers();
  win = new FakeTarget();
  doc = new FakeTarget();
  refresh = vi.fn<() => void>();
});
afterEach(() => vi.useRealTimers());

describe("watchCloudPlays (#307)", () => {
  it("re-reads every 60 s", () => {
    watchCloudPlays(refresh, win, doc);
    vi.advanceTimersByTime(CLOUD_PLAYS_REREAD_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("re-reads at once on focus, and on becoming visible but not on hiding", () => {
    watchCloudPlays(refresh, win, doc);
    win.fire("focus");
    expect(refresh).toHaveBeenCalledTimes(1);
    doc.visibilityState = "hidden";
    doc.fire("visibilitychange");
    expect(refresh).toHaveBeenCalledTimes(1);
    doc.visibilityState = "visible";
    doc.fire("visibilitychange");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("removes its timer and listeners on cleanup", () => {
    const stop = watchCloudPlays(refresh, win, doc);
    expect(win.count() + doc.count()).toBe(2);
    stop();
    expect(win.count() + doc.count()).toBe(0);
    vi.advanceTimersByTime(CLOUD_PLAYS_REREAD_MS * 2);
    win.fire("focus");
    expect(refresh).not.toHaveBeenCalled();
  });
});
