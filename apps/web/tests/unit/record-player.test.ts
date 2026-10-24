import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_STEPS,
  RECORD_KEY,
  VIEW_KEY,
  WHEEL,
  arcLen,
  durationLabel,
  easeToward,
  fadeOpacity,
  findByPrefix,
  frontIndex,
  keyTarget,
  loadSpinningRecord,
  loadViewMode,
  nextTyped,
  parseSpinningRecord,
  parseViewMode,
  rowCaption,
  rowLabel,
  rowPose,
  saveSpinningRecord,
  saveViewMode,
  scrollToSteps,
  turnTarget,
  windowIndexes,
  wrapD,
} from "../../src/lib/record-player";

describe("the wheel's geometry", () => {
  it("shrinks each step to 0.87 of the last", () => {
    expect(rowPose(0)!.scale).toBe(1);
    expect(rowPose(1)!.scale).toBeCloseTo(0.87, 6);
    expect(rowPose(2)!.scale).toBeCloseTo(0.87 * 0.87, 6);
    expect(rowPose(-3)!.scale).toBeCloseTo(Math.pow(0.87, 3), 6);
  });

  it("puts the front row level with the dial's centre, on its right edge", () => {
    const p = rowPose(0)!;
    expect(p.y).toBe(0);
    expect(p.x).toBe(WHEEL.cx + WHEEL.radius);
    expect(p.opacity).toBe(1);
  });

  it("is symmetric above and below the front", () => {
    const up = rowPose(-2)!;
    const down = rowPose(2)!;
    expect(up.y).toBeCloseTo(-down.y, 6);
    expect(up.x).toBeCloseTo(down.x, 6);
  });

  it("measures the arc with each step shorter", () => {
    expect(arcLen(0)).toBe(0);
    expect(arcLen(1)).toBeCloseTo((90 + 90 * 0.87) / 2, 6);
    expect(arcLen(2)).toBeGreaterThan(arcLen(1));
    expect(arcLen(2) - arcLen(1)).toBeLessThan(arcLen(1) - arcLen(0));
    expect(arcLen(1.5)).toBeGreaterThan(arcLen(1));
    expect(arcLen(1.5)).toBeLessThan(arcLen(2));
  });

  it("fades from about 49 degrees and is gone 0.5 rad later", () => {
    expect(fadeOpacity(0)).toBe(1);
    expect(fadeOpacity(0.84)).toBe(1);
    expect(fadeOpacity(-0.85)).toBe(1);
    expect(fadeOpacity(1.1)).toBeCloseTo(0.5, 6);
    expect(fadeOpacity(1.35)).toBe(0);
    expect((0.85 * 180) / Math.PI).toBeGreaterThan(48);
    expect((0.85 * 180) / Math.PI).toBeLessThan(50);
  });

  it("shows about seven rows at once", () => {
    const shown = [-8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8].filter((d) => rowPose(d) !== null);
    expect(shown.length).toBeGreaterThanOrEqual(7);
    expect(shown.length).toBeLessThanOrEqual(9);
  });

  it("draws nothing past the cull, and decides it from the distance alone", () => {
    expect(rowPose(MAX_STEPS + 0.01)).toBeNull();
    expect(rowPose(-100)).toBeNull();
    expect(rowPose(1e9)).toBeNull();
  });
});

describe("culling", () => {
  it("looks at the same number of rows whatever the collection count", () => {
    const small = windowIndexes(0, 20).length;
    expect(windowIndexes(0, 200).length).toBe(small);
    expect(windowIndexes(1234.4, 5000).length).toBe(small);
    expect(small).toBe(2 * (MAX_STEPS + 1) + 1);
  });

  it("wraps round the ends and lists each row once on a short wheel", () => {
    expect(windowIndexes(0, 200, 2)).toEqual([198, 199, 0, 1, 2]);
    const three = windowIndexes(0, 3);
    expect(new Set(three).size).toBe(3);
    expect(windowIndexes(0, 0)).toEqual([]);
  });

  it("takes the shortest way round", () => {
    expect(wrapD(199, 0, 200)).toBe(-1);
    expect(wrapD(1, 199, 200)).toBe(2);
    expect(wrapD(5, 2.5, 20)).toBe(2.5);
    expect(turnTarget(0, 198, 200)).toBe(200);
    expect(turnTarget(3, 0, 5)).toBe(-2);
    expect(frontIndex(-1, 24)).toBe(23);
    expect(frontIndex(24.4, 24)).toBe(0);
  });

  it("lays out only rows of the window: far rows never get a pose", () => {
    const n = 200;
    let posed = 0;
    for (let i = 0; i < n; i++) if (rowPose(wrapD(i, 100, n)) !== null) posed++;
    expect(posed).toBeLessThanOrEqual(2 * MAX_STEPS + 1);
    expect(posed).toBeGreaterThanOrEqual(7);
  });
});

describe("easing", () => {
  it("eases toward the target the same over the same time at any frame rate", () => {
    let a = 0;
    for (let i = 0; i < 12; i++) a = easeToward(a, 1, 1000 / 120);
    let b = 0;
    for (let i = 0; i < 6; i++) b = easeToward(b, 1, 1000 / 60);
    expect(a).toBeCloseTo(b, 6);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
  });

  it("lands exactly on the target", () => {
    expect(easeToward(0.9985, 1, 16)).toBe(1);
    let p = 0;
    for (let i = 0; i < 200; i++) p = easeToward(p, 3, 16);
    expect(p).toBe(3);
  });

  it("turns scroll into steps, three lines to a row", () => {
    expect(scrollToSteps(0, 110, 0)).toBe(1);
    expect(scrollToSteps(220, 10, 0)).toBe(2);
    expect(scrollToSteps(0, 3, 1)).toBe(1);
  });
});

describe("type-ahead", () => {
  const names = ["late drives", "late drives v2", "sunday slow", "gym", "rainy bus"];
  it("one letter goes to the next name that starts with it", () => {
    expect(findByPrefix(names, "l", 0)).toBe(1);
    expect(findByPrefix(names, "l", 1)).toBe(0);
    expect(findByPrefix(names, "g", 0)).toBe(3);
    expect(findByPrefix(names, "z", 0)).toBeNull();
  });
  it("more letters stay on a name that still matches, from the front", () => {
    expect(findByPrefix(names, "la", 0)).toBe(0);
    expect(findByPrefix(names, "late drives v", 0)).toBe(1);
    expect(findByPrefix(names, "ra", 2)).toBe(4);
  });
  it("is empty-safe", () => {
    expect(findByPrefix([], "a", 0)).toBeNull();
    expect(findByPrefix(names, "", 0)).toBeNull();
  });
  it("restarts the word after a pause", () => {
    expect(nextTyped("la", 1000, "t", 1300)).toBe("lat");
    expect(nextTyped("la", 1000, "t", 1701)).toBe("t");
  });
});

describe("captions", () => {
  it("writes lengths the way the plan does", () => {
    expect(durationLabel(7000)).toBe("1 hr 57 min");
    expect(durationLabel(6960)).toBe("1 hr 56 min");
    expect(durationLabel(7200)).toBe("2 hr");
    expect(durationLabel(24 * 60)).toBe("24 min");
    expect(durationLabel(20)).toBe("1 min");
    expect(durationLabel(0)).toBe("");
  });
  it("captions a row", () => {
    expect(rowCaption(27, 6960)).toBe("27 tracks, 1 hr 56 min");
    expect(rowCaption(1, 180)).toBe("1 track, 3 min");
    expect(rowCaption(0, 0)).toBe("0 tracks");
  });
  it("labels a row from the same state as its tag", () => {
    expect(rowLabel("Late drives", 27, null)).toBe("Late drives, 27 tracks");
    expect(rowLabel("Late drives", 27, "paused")).toBe("Late drives, 27 tracks, paused");
    expect(rowLabel("Late drives", 1, "playing")).toBe("Late drives, 1 track, playing");
  });
});

describe("the per-device choices", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubStorage(store: Record<string, string>, opts: { throws?: boolean } = {}) {
    const boom = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("window", {
      localStorage: {
        getItem: opts.throws ? boom : (k: string) => (k in store ? store[k] : null),
        setItem: opts.throws ? boom : (k: string, v: string) => void (store[k] = v),
      },
    });
  }

  it("defaults to the record player and the picture disc", () => {
    expect(parseViewMode(null)).toBe("player");
    expect(parseViewMode("nonsense")).toBe("player");
    expect(parseViewMode("list")).toBe("list");
    expect(parseSpinningRecord(null)).toBe("picture");
    expect(parseSpinningRecord("junk")).toBe("picture");
    expect(parseSpinningRecord("vinyl")).toBe("vinyl");
  });

  it("writes and reads them back", () => {
    const store: Record<string, string> = {};
    stubStorage(store);
    saveSpinningRecord("vinyl");
    saveViewMode("list");
    expect(store[RECORD_KEY]).toBe("vinyl");
    expect(store[VIEW_KEY]).toBe("list");
    expect(loadSpinningRecord()).toBe("vinyl");
    expect(loadViewMode()).toBe("list");
  });

  it("works without storage: reads fall back, writes are dropped quietly", () => {
    stubStorage({}, { throws: true });
    expect(loadSpinningRecord()).toBe("picture");
    expect(loadViewMode()).toBe("player");
    expect(() => saveSpinningRecord("vinyl")).not.toThrow();
    expect(() => saveViewMode("list")).not.toThrow();
  });

  it("works with no window at all", () => {
    vi.stubGlobal("window", undefined);
    expect(loadSpinningRecord()).toBe("picture");
    expect(() => saveViewMode("list")).not.toThrow();
  });
});

describe("the keyboard's logical selection", () => {
  it("plays the third-next collection after three Down keys, whatever the animation has reached", () => {
    const n = 10;
    let target = 2; // the wheel sits on row 2; its animation (pos) has not moved at all
    for (let k = 0; k < 3; k++) target = keyTarget("ArrowDown", target, n) ?? target;
    expect(frontIndex(target, n)).toBe(5);
  });
  it("wraps, and Home and End take the shortest way", () => {
    expect(frontIndex(keyTarget("ArrowUp", 0, 4)!, 4)).toBe(3);
    expect(frontIndex(keyTarget("End", 1, 4)!, 4)).toBe(3);
    expect(frontIndex(keyTarget("Home", 3, 4)!, 4)).toBe(0);
    expect(keyTarget("a", 0, 4)).toBeNull();
  });
});
