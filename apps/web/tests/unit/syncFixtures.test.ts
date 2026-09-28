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
    const invalid = fixtureFiles.filter(
      (name) => name.startsWith("invalid-") && !name.startsWith("invalid-api-"),
    );
    const invalidApi = fixtureFiles.filter((name) => name.startsWith("invalid-api-"));
    expect(valid.length).toBeGreaterThan(0);
    expect(invalid.length + invalidApi.length).toBeGreaterThan(0);
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

  it.each(
    fixtureFiles.filter(
      (name) => name.startsWith("invalid-") && !name.startsWith("invalid-api-"),
    ),
  )("rejects %s", (name) => {
    const result = SyncRecordSchema.safeParse(loadFixture(name));
    expect(result.success).toBe(false);
  });
});
