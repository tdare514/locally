import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  paletteFromPixels,
  relativeLuminance,
} from "../../src/lib/artwork-palette";

type Colour = [r: number, g: number, b: number, a?: number];

/** Builds RGBA bytes with `counts[i]` pixels of `colours[i]` (alpha defaults to 255). */
function px(colours: Colour[], counts: number[]): Uint8ClampedArray {
  const bytes: number[] = [];
  colours.forEach(([r, g, b, a = 255], i) => {
    for (let n = 0; n < counts[i]; n++) bytes.push(r, g, b, a);
  });
  return new Uint8ClampedArray(bytes);
}

const solid = (colour: Colour) => paletteFromPixels(px([colour], [100]))!;

/** Splits "#rrggbb" into [r, g, b] bytes. */
const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];

describe("artwork-palette", () => {
  describe("paletteFromPixels", () => {
    it("returns null for empty or fully transparent input", () => {
      expect(paletteFromPixels(new Uint8ClampedArray(0))).toBeNull();
      expect(paletteFromPixels(px([[255, 0, 0, 0]], [50]))).toBeNull();
      expect(paletteFromPixels(px([[255, 0, 0, 124]], [50]))).toBeNull();
    });

    it("tones solid red to a red that white text can sit on", () => {
      const { primary } = solid([255, 0, 0]);
      const [r, g, b] = rgb(primary);
      expect(r).toBeGreaterThan(g);
      expect(r).toBeGreaterThan(b);
      expect(relativeLuminance(primary)).toBeLessThanOrEqual(0.12);
      expect(contrastRatio("#ffffff", primary)).toBeGreaterThanOrEqual(4.5);
    });

    it.each([
      ["yellow", [255, 255, 0]],
      ["light green", [128, 255, 128]],
    ] as [string, Colour][])(
      "keeps white readable on bright %s",
      (_name, colour) => {
        const { primary } = solid(colour);
        expect(contrastRatio("#ffffff", primary)).toBeGreaterThanOrEqual(4.5);
      },
    );

    it("penalises near-white so a 70% white cover still picks its blue", () => {
      const pixels = px(
        [
          [255, 255, 255],
          [0x20, 0x50, 0xe0],
        ],
        [70, 30],
      );
      const [r, g, b] = rgb(paletteFromPixels(pixels)!.primary);
      expect(b).toBeGreaterThan(r);
      expect(b).toBeGreaterThan(g);
    });

    it("picks a distinct second hue for secondary", () => {
      const pixels = px(
        [
          [255, 0, 0],
          [0, 0, 255],
        ],
        [60, 40],
      );
      const { primary, secondary } = paletteFromPixels(pixels)!;
      const [pr, pg, pb] = rgb(primary);
      const [sr, sg, sb] = rgb(secondary);
      expect(pr).toBeGreaterThan(pg);
      expect(pr).toBeGreaterThan(pb);
      expect(sb).toBeGreaterThan(sr);
      expect(sb).toBeGreaterThan(sg);
    });

    it("keeps secondary no brighter than primary for a single-hue image", () => {
      const pixels = px(
        [
          [255, 140, 0],
          [250, 160, 20],
        ],
        [70, 30],
      );
      const { primary, secondary } = paletteFromPixels(pixels)!;
      expect(relativeLuminance(secondary)).toBeLessThanOrEqual(
        relativeLuminance(primary),
      );
    });

    it("keeps greyscale input grey", () => {
      const { primary } = solid([128, 128, 128]);
      const [r, g, b] = rgb(primary);
      expect(r).toBe(g);
      expect(g).toBe(b);
    });

    it("gives a black cover a visible dark grey, not pure black", () => {
      const { primary } = solid([0, 0, 0]);
      expect(primary).not.toBe("#000000");
      expect(relativeLuminance(primary)).toBeLessThanOrEqual(0.12);
    });

    it.each([
      ["red", [255, 0, 0]],
      ["yellow", [255, 255, 0]],
    ] as [string, Colour][])(
      "keeps deep within its cap for %s",
      (_name, colour) => {
        expect(relativeLuminance(solid(colour).deep)).toBeLessThanOrEqual(
          0.035,
        );
      },
    );
  });

  describe("relativeLuminance and contrastRatio", () => {
    it("matches the WCAG endpoints", () => {
      expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
      expect(relativeLuminance("#000000")).toBe(0);
      expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    });

    it("is symmetric in its arguments", () => {
      expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    });
  });
});
