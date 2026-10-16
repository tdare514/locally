import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PlayCountsRequestSchema } from "../../src/server/plays/playsWire";

// Separate folders from spec/fixtures/sync/, whose readers parse every file as a release record.
// plays-days/ holds the bodies with `days` (#201, #202).
const folders = ["plays", "plays-days"].map((name) => ({
  name,
  dir: fileURLToPath(new URL(`../../../../spec/fixtures/${name}/`, import.meta.url)),
}));

function filesIn(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith(".json"));
}

function loadFixture(dir: string, name: string): unknown {
  return JSON.parse(readFileSync(`${dir}${name}`, "utf8"));
}

describe.each(folders)("play count fixtures in $name", ({ dir }) => {
  const fixtureFiles = filesIn(dir);

  it("finds fixtures and every file matches a known prefix", () => {
    expect(fixtureFiles.filter((name) => name.startsWith("valid-")).length).toBeGreaterThan(0);
    expect(fixtureFiles.filter((name) => name.startsWith("invalid-")).length).toBeGreaterThan(0);
    for (const name of fixtureFiles) {
      expect(
        name.startsWith("valid-") || name.startsWith("invalid-"),
        `${name} does not match a known fixture prefix`,
      ).toBe(true);
    }
  });

  it.each(fixtureFiles.filter((name) => name.startsWith("valid-")))("accepts %s", (name) => {
    expect(PlayCountsRequestSchema.safeParse(loadFixture(dir, name)).success).toBe(true);
  });

  it.each(fixtureFiles.filter((name) => name.startsWith("invalid-")))("rejects %s", (name) => {
    expect(PlayCountsRequestSchema.safeParse(loadFixture(dir, name)).success).toBe(false);
  });
});
