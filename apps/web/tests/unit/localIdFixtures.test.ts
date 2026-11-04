import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildLocalId } from "../../src/server/adopt/localId";

// The shared `spotify:local:` cases (#332 step 1). The iPhone's `LocalIdFixtureTests` runs the same file.
const file = fileURLToPath(new URL("../../../../spec/fixtures/local-id/cases.json", import.meta.url));

interface LocalIdCase {
  name: string;
  artist: string;
  album: string;
  title: string;
  durationSec: number;
  expected: string;
}

const cases = JSON.parse(readFileSync(file, "utf8")) as LocalIdCase[];

describe("local-id fixtures", () => {
  it("has cases", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(buildLocalId(c.artist, c.album, c.title, c.durationSec)).toBe(c.expected);
  });
});
