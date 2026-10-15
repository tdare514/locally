import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SyncRecordSchema } from "../../src/server/sync/SyncRecord";

const fixturesDir = fileURLToPath(new URL("../../../../spec/fixtures/sync/", import.meta.url));
const fixtureFiles = readdirSync(fixturesDir).filter((name) => name.endsWith(".json"));

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(`${fixturesDir}${name}`, "utf8"));
}

describe("sync fixtures", () => {
  it("finds fixtures and every file matches a known prefix", () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
    const valid = fixtureFiles.filter((name) => name.startsWith("valid-"));
    const invalid = fixtureFiles.filter((name) => name.startsWith("invalid-"));
    expect(valid.length).toBeGreaterThan(0);
    expect(invalid.length).toBeGreaterThan(0);
    for (const name of fixtureFiles) {
      expect(
        name.startsWith("valid-") || name.startsWith("invalid-"),
        `${name} does not match a known fixture prefix`,
      ).toBe(true);
    }
  });

  it.each(fixtureFiles.filter((name) => name.startsWith("valid-")))(
    "accepts %s",
    (name) => {
      const result = SyncRecordSchema.safeParse(loadFixture(name));
      expect(result.success).toBe(true);
    },
  );

  it("keeps the origin of a release from the web or from a client it has never heard of (#185)", () => {
    const web = SyncRecordSchema.parse(loadFixture("valid-album-origin-web.json"));
    const unknown = SyncRecordSchema.parse(loadFixture("valid-single-origin-unknown.json"));
    expect(web.origin).toBe("web");
    expect(unknown.origin).toBe("future-thing");
  });

  it.each(fixtureFiles.filter((name) => name.startsWith("invalid-")))("rejects %s", (name) => {
    const result = SyncRecordSchema.safeParse(loadFixture(name));
    expect(result.success).toBe(false);
  });
});
