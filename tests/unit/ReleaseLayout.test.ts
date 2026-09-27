import { describe, expect, it } from "vitest";
import path from "node:path";
import { ReleaseLayout } from "../../src/server/releases/ReleaseLayout";

describe("ReleaseLayout", () => {
  const layout = new ReleaseLayout();

  describe("sanitizeSegment", () => {
    it("strips characters that are illegal on common filesystems", () => {
      expect(layout.sanitizeSegment('a/b\\c:d*e?f"g<h>i|j')).toBe("abcdefghij");
    });

    it("trims trailing dots and spaces", () => {
      expect(layout.sanitizeSegment("My Album...   ")).toBe("My Album");
    });

    it("falls back to Unknown when the result is empty", () => {
      expect(layout.sanitizeSegment("")).toBe("Unknown");
      expect(layout.sanitizeSegment(null)).toBe("Unknown");
      expect(layout.sanitizeSegment(undefined)).toBe("Unknown");
      expect(layout.sanitizeSegment("///")).toBe("Unknown");
      expect(layout.sanitizeSegment("...")).toBe("Unknown");
    });
  });

  describe("trackFileName", () => {
    it("pads single-digit track numbers to two digits", () => {
      expect(layout.trackFileName(1, "Intro")).toBe("01 - Intro.mp3");
      expect(layout.trackFileName(9, "Nine")).toBe("09 - Nine.mp3");
    });

    it("does not pad numbers already two or more digits", () => {
      expect(layout.trackFileName(10, "Ten")).toBe("10 - Ten.mp3");
      expect(layout.trackFileName(123, "Big")).toBe("123 - Big.mp3");
    });

    it("sanitises the title portion", () => {
      expect(layout.trackFileName(1, "A/B")).toBe("01 - AB.mp3");
    });
  });

  describe("folderFor", () => {
    it("composes libraryDir/artist/album", () => {
      const result = layout.folderFor("/lib", "The Artist", "The Album");
      expect(result).toBe(path.join("/lib", "The Artist", "The Album"));
    });

    it("sanitises artist and album segments", () => {
      const result = layout.folderFor("/lib", "A/B", "C:D");
      expect(result).toBe(path.join("/lib", "AB", "CD"));
    });
  });

  describe("coverFileName", () => {
    it("returns cover.png for png mime types", () => {
      expect(layout.coverFileName("image/png")).toBe("cover.png");
    });

    it("returns cover.jpg for anything else", () => {
      expect(layout.coverFileName("image/jpeg")).toBe("cover.jpg");
      expect(layout.coverFileName("image/gif")).toBe("cover.jpg");
    });
  });
});
