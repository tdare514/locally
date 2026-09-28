import { describe, expect, it } from "vitest";
import path from "node:path";
import { ReleaseLayout } from "../../src/server/releases/ReleaseLayout";
import { ValidationError } from "../../src/shared/errors";

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

describe("ReleaseLayout hardening", () => {
  const layout = new ReleaseLayout();

  describe("sanitizeSegment", () => {
    it("strips control characters", () => {
      expect(layout.sanitizeSegment("A\u0000B\nC\u001fD\u007fE")).toBe("ABCDE");
      expect(layout.sanitizeSegment("\u0000\n\t")).toBe("Unknown");
    });

    it("caps the result at 200 characters, re-trimming the cut end", () => {
      expect(layout.sanitizeSegment("x".repeat(300))).toHaveLength(200);
      expect(layout.sanitizeSegment("x".repeat(199) + " . y")).toBe("x".repeat(199));
    });

    it("never produces a leading dot (no hidden folders, no traversal look-alikes)", () => {
      expect(layout.sanitizeSegment(".hidden")).toBe("hidden");
      expect(layout.sanitizeSegment("..foo")).toBe("foo");
      expect(layout.sanitizeSegment(" .. bar")).toBe("bar");
      expect(layout.sanitizeSegment("..")).toBe("Unknown");
    });

    it("keeps interior dots", () => {
      expect(layout.sanitizeSegment("Mr. Blue Sky")).toBe("Mr. Blue Sky");
    });
  });

  describe("trackFileName", () => {
    it.each([1.5, -1, 1000, Number.NaN, Number.POSITIVE_INFINITY, "1", "../../../../tmp/x", null, undefined])(
      "throws ValidationError for track number %s",
      (n) => {
        expect(() => layout.trackFileName(n as never, "T")).toThrow(ValidationError);
      }
    );

    it("still accepts the whole 0..999 range", () => {
      expect(layout.trackFileName(0, "T")).toBe("00 - T.mp3");
      expect(layout.trackFileName(999, "T")).toBe("999 - T.mp3");
    });

    it("sanitises a '..foo' title to a plain child name", () => {
      expect(layout.trackFileName(1, "..foo")).toBe("01 - foo.mp3");
    });
  });

  describe("folderFor", () => {
    it("never yields a hidden or traversing folder", () => {
      expect(layout.folderFor("/lib", "..", ".hidden")).toBe(path.join("/lib", "Unknown", "hidden"));
    });
  });

  describe("sanitizeSegment: zero-width/bidi and byte-length hardening", () => {
    it("strips zero-width and bidi control characters", () => {
      // U+200B zero-width space, U+202E right-to-left override, U+2066 left-to-right isolate,
      // U+FEFF BOM, U+061C Arabic letter mark.
      expect(layout.sanitizeSegment("A​B‮C⁦D﻿E؜F")).toBe("ABCDEF");
    });

    it("caps a multibyte-heavy name by UTF-8 bytes, not just code points", () => {
      // 200 code points of a 4-byte emoji is 800 bytes, far past the 255-byte filesystem
      // limit even after the RESERVED_SUFFIX_BYTES headroom for an extension/"(n)" suffix.
      const result = layout.sanitizeSegment("😀".repeat(200));
      expect(Buffer.byteLength(result, "utf-8")).toBeLessThanOrEqual(255 - 16);
      // Never split a surrogate pair: every character in the result must itself be
      // a single valid code point (Array.from would throw/mangle on a lone surrogate).
      expect(Array.from(result).every((ch) => ch.length <= 2)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("assertPlainFileName", () => {
    it.each(["01 - Intro.mp3", "cover.jpg", "Phone Artist - Phone Song - 01 - Phone Song.m4a", "a..b (2).mp3"])(
      "returns a plain child name unchanged: %s",
      (name) => {
        expect(layout.assertPlainFileName(name)).toBe(name);
      }
    );

    it.each([
      "../victim.mp3",
      "..",
      ".",
      "",
      "/etc/passwd",
      "sub/track.mp3",
      "sub\\track.mp3",
      "track.mp3/",
      ".hidden.mp3",
      "trac\u0000k.mp3",
      "trac\nk.mp3",
      `${"a".repeat(252)}.mp3`,
    ])("rejects anything that could name more than a direct child: %j", (name) => {
      expect(() => layout.assertPlainFileName(name)).toThrow(ValidationError);
    });
  });
});
