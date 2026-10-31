import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLACEHOLDER_DELAY_MS, revealAfter } from "../../src/lib/use-delayed-flag";

describe("revealAfter (#422: placeholders only after 300 ms)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits 300 ms by default", () => {
    expect(PLACEHOLDER_DELAY_MS).toBe(300);
  });

  it("shows nothing before the delay and shows once it has passed", () => {
    const show = vi.fn();
    revealAfter(true, PLACEHOLDER_DELAY_MS, show);
    vi.advanceTimersByTime(299);
    expect(show).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("never shows a wait that ends first, and hides on cleanup", () => {
    const show = vi.fn();
    const cleanup = revealAfter(true, PLACEHOLDER_DELAY_MS, show);
    vi.advanceTimersByTime(200);
    cleanup?.();
    vi.advanceTimersByTime(1000);
    expect(show.mock.calls).toEqual([[false]]);
  });

  it("hides again when a shown wait ends", () => {
    const show = vi.fn();
    const cleanup = revealAfter(true, PLACEHOLDER_DELAY_MS, show);
    vi.advanceTimersByTime(PLACEHOLDER_DELAY_MS);
    cleanup?.();
    expect(show.mock.calls).toEqual([[true], [false]]);
  });

  it("does nothing while not busy", () => {
    const show = vi.fn();
    expect(revealAfter(false, PLACEHOLDER_DELAY_MS, show)).toBeUndefined();
    vi.advanceTimersByTime(1000);
    expect(show).not.toHaveBeenCalled();
  });
});
