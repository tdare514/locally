import { describe, expect, it } from "vitest";
import {
  clamp,
  initialRect,
  panned,
  zoomed,
  type Rect,
  type Size,
} from "../../src/lib/crop-geometry";

/** Mirrors `apps/ios/LocallyTests/CropGeometryTests.swift` test-for-test, so the web and iOS
 * crop UIs are verified against the same behaviour. */

describe("crop-geometry", () => {
  describe("initialRect", () => {
    it("centres a square rect horizontally for a landscape image", () => {
      const rect = initialRect({ width: 400, height: 200 }, "square");
      expect(rect).toEqual({ x: 100, y: 0, width: 200, height: 200 });
    });

    it("centres a square rect vertically for a portrait image", () => {
      const rect = initialRect({ width: 200, height: 400 }, "square");
      expect(rect).toEqual({ x: 0, y: 100, width: 200, height: 200 });
    });

    it("returns the full image for the original ratio", () => {
      const size: Size = { width: 400, height: 200 };
      expect(initialRect(size, "original")).toEqual({ x: 0, y: 0, ...size });

      const portrait: Size = { width: 300, height: 900 };
      expect(initialRect(portrait, "original")).toEqual({
        x: 0,
        y: 0,
        ...portrait,
      });
    });
  });

  describe("clamp", () => {
    const imageSize: Size = { width: 400, height: 300 };

    it("pulls back a rect past the left edge", () => {
      const rect: Rect = { x: -50, y: 50, width: 100, height: 100 };
      expect(clamp(rect, imageSize)).toEqual({
        x: 0,
        y: 50,
        width: 100,
        height: 100,
      });
    });

    it("pulls back a rect past the right edge", () => {
      const rect: Rect = { x: 350, y: 50, width: 100, height: 100 };
      expect(clamp(rect, imageSize)).toEqual({
        x: 300,
        y: 50,
        width: 100,
        height: 100,
      });
    });

    it("pulls back a rect past the top edge", () => {
      const rect: Rect = { x: 50, y: -80, width: 100, height: 100 };
      expect(clamp(rect, imageSize)).toEqual({
        x: 50,
        y: 0,
        width: 100,
        height: 100,
      });
    });

    it("pulls back a rect past the bottom edge", () => {
      const rect: Rect = { x: 50, y: 250, width: 100, height: 100 };
      expect(clamp(rect, imageSize)).toEqual({
        x: 50,
        y: 200,
        width: 100,
        height: 100,
      });
    });

    it("shrinks a rect larger than the image, preserving aspect", () => {
      // 2:1, which does not match the 4:3 image, so this only passes if the aspect ratio is
      // actually preserved rather than the rect being independently clipped per axis.
      const rect: Rect = { x: 0, y: 0, width: 800, height: 400 };
      const clamped = clamp(rect, imageSize);
      expect(clamped.width).toBeLessThanOrEqual(imageSize.width);
      expect(clamped.height).toBeLessThanOrEqual(imageSize.height);
      expect(
        Math.abs(clamped.width / clamped.height - rect.width / rect.height),
      ).toBeLessThan(0.0001);
    });

    it("is a no-op on an already valid rect", () => {
      const rect: Rect = { x: 50, y: 50, width: 100, height: 100 };
      expect(clamp(rect, imageSize)).toEqual(rect);
    });
  });

  describe("zoomed", () => {
    it("zooming in shrinks the rect about its centre", () => {
      const imageSize: Size = { width: 1000, height: 1000 };
      const rect: Rect = { x: 200, y: 200, width: 400, height: 400 };
      const center = {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      };
      const result = zoomed(rect, 2, center, "square", imageSize);
      expect(result.width).toBeLessThan(rect.width);
      expect(Math.abs(result.x + result.width / 2 - center.x)).toBeLessThan(
        0.001,
      );
      expect(Math.abs(result.y + result.height / 2 - center.y)).toBeLessThan(
        0.001,
      );
    });

    it("never exceeds the image bounds", () => {
      const imageSize: Size = { width: 500, height: 500 };
      let rect = initialRect(imageSize, "square");
      // Repeatedly "zoom out" (scale < 1): the rect must never grow past the image.
      for (let i = 0; i < 50; i++) {
        const center = {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        };
        rect = zoomed(rect, 0.5, center, "square", imageSize);
        expect(rect.width).toBeLessThanOrEqual(imageSize.width + 0.001);
        expect(rect.height).toBeLessThanOrEqual(imageSize.height + 0.001);
        expect(rect.x).toBeGreaterThanOrEqual(-0.001);
        expect(rect.y).toBeGreaterThanOrEqual(-0.001);
        expect(rect.x + rect.width).toBeLessThanOrEqual(
          imageSize.width + 0.001,
        );
        expect(rect.y + rect.height).toBeLessThanOrEqual(
          imageSize.height + 0.001,
        );
      }
    });

    it("never shrinks below a minimum size when zooming in", () => {
      const imageSize: Size = { width: 1000, height: 1000 };
      let rect = initialRect(imageSize, "square");
      for (let i = 0; i < 50; i++) {
        const center = {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        };
        rect = zoomed(rect, 2, center, "square", imageSize);
      }
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
    });

    it("keeps the square ratio square", () => {
      const imageSize: Size = { width: 800, height: 600 };
      const rect = initialRect(imageSize, "square");
      const center = {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      };
      const result = zoomed(rect, 1.5, center, "square", imageSize);
      expect(Math.abs(result.width - result.height)).toBeLessThan(0.001);
    });
  });

  describe("panned", () => {
    it("moves the rect by the given delta", () => {
      const imageSize: Size = { width: 400, height: 400 };
      const rect: Rect = { x: 100, y: 100, width: 100, height: 100 };
      const result = panned(rect, { dx: 20, dy: -10 }, imageSize);
      expect(result).toEqual({ x: 120, y: 90, width: 100, height: 100 });
    });

    it("stops at the left and top edges", () => {
      const imageSize: Size = { width: 400, height: 400 };
      const rect: Rect = { x: 50, y: 50, width: 100, height: 100 };
      const result = panned(rect, { dx: -500, dy: -500 }, imageSize);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
      expect(result.width).toBe(100);
      expect(result.height).toBe(100);
    });

    it("stops at the right and bottom edges", () => {
      const imageSize: Size = { width: 400, height: 400 };
      const rect: Rect = { x: 250, y: 250, width: 100, height: 100 };
      const result = panned(rect, { dx: 500, dy: 500 }, imageSize);
      expect(result.x + result.width).toBe(imageSize.width);
      expect(result.y + result.height).toBe(imageSize.height);
      expect(result.width).toBe(100);
      expect(result.height).toBe(100);
    });
  });
});
