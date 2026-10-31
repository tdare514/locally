import { describe, expect, it } from "vitest";
import { HIGHLIGHT_MIN_BRIGHTNESS, liftBrightness } from "../../src/lib/artwork-palette";

/** The three 0..255 channels of a "#rrggbb" colour. */
function rgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

describe("liftBrightness (#413)", () => {
  it("raises a dark colour's brightest channel to the minimum and keeps the channel ratio", () => {
    const [r, g, b] = rgb(liftBrightness("#402010"));
    expect(Math.max(r, g, b)).toBe(Math.round(HIGHLIGHT_MIN_BRIGHTNESS * 255));
    expect(r).toBe(217);
    expect(Math.abs(g - r / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(b - r / 4)).toBeLessThanOrEqual(1);
  });

  it("returns a colour that is already bright enough unchanged", () => {
    expect(liftBrightness("#f0f0f0")).toBe("#f0f0f0");
  });

  it("returns anything that is not #rrggbb unchanged", () => {
    expect(liftBrightness("rebeccapurple")).toBe("rebeccapurple");
    expect(liftBrightness("#fff")).toBe("#fff");
  });
});
