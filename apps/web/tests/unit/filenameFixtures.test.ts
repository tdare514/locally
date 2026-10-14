import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ReleaseLayout } from "../../src/server/releases/ReleaseLayout";

const fixturesDir = fileURLToPath(new URL("../../../../spec/fixtures/filenames/", import.meta.url));
const categories = ["illegal-characters", "dots", "control-and-bidi", "whitespace", "length"];

interface FilenameCase {
  name: string;
  input: string | null;
  expected: string;
}

function loadCases(category: string): FilenameCase[] {
  return JSON.parse(readFileSync(`${fixturesDir}${category}.json`, "utf8")) as FilenameCase[];
}

describe("filename fixtures", () => {
  it("has a non-empty file for every category", () => {
    for (const category of categories) {
      expect(loadCases(category).length, `${category}.json is empty`).toBeGreaterThan(0);
    }
  });

  for (const category of categories) {
    describe(category, () => {
      it.each(loadCases(category).map((c) => [c.name, c] as const))("%s", (_name, c) => {
        expect(new ReleaseLayout().sanitizeSegment(c.input)).toBe(c.expected);
      });
    });
  }
});
