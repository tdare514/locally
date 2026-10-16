import { describe, expect, it } from "vitest";
import { FAN_MAX, fanLayout } from "../../src/lib/fan-layout";

describe("fanLayout", () => {
  it("is empty for nothing and never holds more than five", () => {
    expect(fanLayout(0)).toEqual([]);
    expect(fanLayout(9)).toHaveLength(FAN_MAX);
  });

  it("a lone sleeve sits dead centre, upright", () => {
    expect(fanLayout(1)).toEqual([{ offset: 0, angle: 0, layer: 50 }]);
  });

  it("five: number one in the middle, silver left, bronze right, four and five outside", () => {
    expect(fanLayout(5).map((s) => s.offset)).toEqual([0, -1, 1, -2, 2]);
  });

  it("three is the sidebar's podium, tilted 12 degrees a step", () => {
    const slots = fanLayout(3);
    expect(slots.map((s) => s.offset)).toEqual([0, -1, 1]);
    expect(slots.map((s) => s.angle)).toEqual([0, -12, 12]);
  });

  it("two and four are centred as a set: no empty slot in the middle, gold half a step right of centre", () => {
    expect(fanLayout(2).map((s) => s.offset)).toEqual([0.5, -0.5]);
    expect(fanLayout(4).map((s) => s.offset)).toEqual([0.5, -0.5, 1.5, -1.5]);
  });

  it.each([1, 2, 3, 4, 5])("n=%i: the offsets are distinct, balanced around zero, and the angles follow them", (n) => {
    const slots = fanLayout(n);
    const offsets = slots.map((s) => s.offset);
    expect(new Set(offsets).size).toBe(n);
    expect(offsets.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 10);
    // Evenly spaced, one step apart.
    const sorted = [...offsets].sort((a, b) => a - b);
    sorted.slice(1).forEach((o, i) => expect(o - sorted[i]).toBe(1));
    // Tilt grows with distance from the middle and leans away from it.
    slots.forEach((s) => expect(Math.sign(s.angle)).toBe(Math.sign(s.offset)));
  });

  it("a thinner fan opens a little wider per step", () => {
    const step = (n: number) => Math.abs(fanLayout(n)[n === 1 ? 0 : 1].angle / fanLayout(n)[n === 1 ? 0 : 1].offset);
    expect(step(2)).toBeGreaterThan(step(3));
    expect(step(3)).toBeGreaterThan(step(5));
  });

  it("stacks number one on top and the inner sleeves over the outer", () => {
    const layers = fanLayout(5).map((s) => s.layer);
    expect(layers[0]).toBe(Math.max(...layers));
    expect(layers[1]).toBeGreaterThan(layers[3]);
    expect(layers[2]).toBeGreaterThan(layers[4]);
    expect(new Set(layers).size).toBe(5);
    const two = fanLayout(2).map((s) => s.layer);
    expect(two[0]).toBeGreaterThan(two[1]);
  });
});
