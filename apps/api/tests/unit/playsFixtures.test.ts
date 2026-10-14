import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { playCountsRequestSchema } from "../../src/shared/types";

const fixturesDir = fileURLToPath(new URL("../../../../spec/fixtures/plays/", import.meta.url));
const fixtureFiles = readdirSync(fixturesDir).filter((name) => name.endsWith(".json"));

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(`${fixturesDir}${name}`, "utf8"));
}

describe("play counts fixtures", () => {
  it("finds fixtures and every file matches a known prefix", () => {
    expect(fixtureFiles.some((name) => name.startsWith("valid-"))).toBe(true);
    expect(fixtureFiles.some((name) => name.startsWith("invalid-"))).toBe(true);
    for (const name of fixtureFiles) {
      expect(name.startsWith("valid-") || name.startsWith("invalid-"), `${name} has an unknown prefix`).toBe(true);
    }
  });

  it.each(fixtureFiles.filter((name) => name.startsWith("valid-")))("accepts %s", (name) => {
    expect(playCountsRequestSchema.safeParse(loadFixture(name)).success).toBe(true);
  });

  it.each(fixtureFiles.filter((name) => name.startsWith("invalid-")))("rejects %s", (name) => {
    expect(playCountsRequestSchema.safeParse(loadFixture(name)).success).toBe(false);
  });
});
