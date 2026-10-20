import { describe, expect, it } from "vitest";
import { watchEscape, type KeyTarget } from "../../src/lib/escape-watch";

function fakeTarget() {
  const listeners = new Set<(e: { key: string; preventDefault(): void }) => void>();
  const target: KeyTarget = {
    addEventListener: (_t, l) => void listeners.add(l),
    removeEventListener: (_t, l) => void listeners.delete(l),
  };
  const press = (key: string) => listeners.forEach((l) => l({ key, preventDefault() {} }));
  return { target, press, count: () => listeners.size };
}

describe("watchEscape (#294 release bar confirm)", () => {
  it("cancels on Escape wherever focus is, ignores other keys", () => {
    const { target, press } = fakeTarget();
    let cancels = 0;
    watchEscape(target, () => cancels++);
    press("Tab");
    press("Enter");
    expect(cancels).toBe(0);
    press("Escape");
    expect(cancels).toBe(1);
  });
  it("removes its one listener when the confirm closes", () => {
    const { target, press, count } = fakeTarget();
    let cancels = 0;
    const stop = watchEscape(target, () => cancels++);
    expect(count()).toBe(1);
    stop();
    expect(count()).toBe(0);
    press("Escape");
    expect(cancels).toBe(0);
  });
});
