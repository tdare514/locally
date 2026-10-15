import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PlayCountsRequestSchema } from "../../src/server/plays/playsWire";

// A separate folder from spec/fixtures/sync/, whose readers parse every file as a release record.
const fixturesDir = fileURLToPath(new URL("../../../../spec/fixtures/plays/", import.meta.url));
const fixtureFiles = readdirSync(fixturesDir).filter((name) => name.endsWith(".json"));

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(`${fixturesDir}${name}`, "utf8"));
}

describe("play count fixtures", () => {
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
    expect(PlayCountsRequestSchema.safeParse(loadFixture(name)).success).toBe(true);
  });

  it.each(fixtureFiles.filter((name) => name.startsWith("invalid-")))("rejects %s", (name) => {
    expect(PlayCountsRequestSchema.safeParse(loadFixture(name)).success).toBe(false);
  });
});
