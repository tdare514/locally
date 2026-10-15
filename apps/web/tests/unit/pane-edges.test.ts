import { describe, expect, it, vi } from "vitest";
import { watchPaneEdges } from "../../src/lib/pane-edges";

/** A pane whose layout reads are counted, and whose geometry a test can change. */
function fakePane(rect = { top: 80, bottom: 920 }, size = { width: 700, height: 840 }) {
  const state = { rect, ...size };
  const getBoundingClientRect = vi.fn(() => state.rect);
  const pane = {
    getBoundingClientRect,
    get clientWidth() {
      return state.width;
    },
    get clientHeight() {
      return state.height;
    },
  } as unknown as HTMLElement;
  return { pane, state, getBoundingClientRect };
}

function fakeWindow(innerHeight = 1000) {
  const listeners = new Map<string, () => void>();
  const win = {
    innerHeight,
    addEventListener: vi.fn((type: string, fn: () => void) => void listeners.set(type, fn)),
    removeEventListener: vi.fn((type: string) => void listeners.delete(type)),
  };
  return { win, listeners };
}

/** A `ResizeObserver` that reports only when the test calls `fire()`. */
function fakeObserver() {
  const observers: { callback: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
  class FakeObserver {
    disconnect = vi.fn();
    observe = vi.fn();
    constructor(callback: () => void) {
      observers.push({ callback, disconnect: this.disconnect });
    }
  }
  return {
    Observer: FakeObserver as unknown as typeof ResizeObserver,
    fire: () => observers.forEach((o) => o.callback()),
    observers,
  };
}

describe("watchPaneEdges", () => {
  it("reads the pane's rect once, however many frames ask for the edges", () => {
    const { pane, getBoundingClientRect } = fakePane();
    const { win } = fakeWindow();
    const watch = watchPaneEdges(pane, win, fakeObserver().Observer);

    for (let frame = 0; frame < 600; frame += 1) {
      expect(watch.edges).toEqual({ top: 80, bottom: 920 });
    }
    expect(getBoundingClientRect).toHaveBeenCalledTimes(1);
  });

  it("clamps the edges to the viewport", () => {
    const { pane } = fakePane({ top: -300, bottom: 2400 });
    const { win } = fakeWindow(1000);
    expect(watchPaneEdges(pane, win, undefined).edges).toEqual({ top: 0, bottom: 1000 });
  });

  it("measures again when the window is resized", () => {
    const { pane, state, getBoundingClientRect } = fakePane();
    const { win, listeners } = fakeWindow(1000);
    const watch = watchPaneEdges(pane, win, undefined);

    state.rect = { top: 60, bottom: 700 };
    win.innerHeight = 800;
    listeners.get("resize")?.();

    expect(watch.edges).toEqual({ top: 60, bottom: 700 });
    expect(getBoundingClientRect).toHaveBeenCalledTimes(2);
  });

  it("measures again when the pane changes size, but not for a report with no change", () => {
    const { pane, state, getBoundingClientRect } = fakePane();
    const { win } = fakeWindow();
    const { Observer, fire } = fakeObserver();
    const watch = watchPaneEdges(pane, win, Observer);

    fire(); // the observer's first report: same size as at the start
    expect(getBoundingClientRect).toHaveBeenCalledTimes(1);

    state.height = 600;
    state.rect = { top: 80, bottom: 680 };
    fire();
    expect(watch.edges).toEqual({ top: 80, bottom: 680 });
    expect(getBoundingClientRect).toHaveBeenCalledTimes(2);

    fire(); // still 600 high
    expect(getBoundingClientRect).toHaveBeenCalledTimes(2);
  });

  it("stops listening and observing on stop()", () => {
    const { pane, state, getBoundingClientRect } = fakePane();
    const { win, listeners } = fakeWindow();
    const { Observer, observers } = fakeObserver();
    const watch = watchPaneEdges(pane, win, Observer);

    watch.stop();
    expect(listeners.has("resize")).toBe(false);
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);

    state.rect = { top: 0, bottom: 500 };
    expect(watch.edges).toEqual({ top: 80, bottom: 920 });
    expect(getBoundingClientRect).toHaveBeenCalledTimes(1);
  });

  it("works where ResizeObserver does not exist", () => {
    const { pane } = fakePane();
    const { win } = fakeWindow();
    const watch = watchPaneEdges(pane, win, undefined);
    expect(watch.edges).toEqual({ top: 80, bottom: 920 });
    expect(() => watch.stop()).not.toThrow();
  });
});
