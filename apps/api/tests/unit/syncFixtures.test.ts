import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { releaseRecordSchema } from "../../src/shared/types";

const fixturesDir = fileURLToPath(new URL("../../../../spec/fixtures/sync/", import.meta.url));
const fixtureFiles = readdirSync(fixturesDir).filter((name) => name.endsWith(".json"));

/**
 * Valid for the Mac and the iPhone, which must read a release from a client they have never heard
 * of as "another device" (#185). The API rejects them on purpose until #186 lets `origin: "web"`
 * in, so they are not in the "accepts" loop; the test below pins the rejection so that change has
 * to move them here deliberately.
 */
const CLIENT_ONLY_FIXTURES = ["valid-album-origin-web.json", "valid-single-origin-unknown.json"];

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

  it.each(fixtureFiles.filter((name) => name.startsWith("valid-") && !CLIENT_ONLY_FIXTURES.includes(name)))(
    "accepts %s",
    (name) => {
      const result = releaseRecordSchema.safeParse(loadFixture(name));
      expect(result.success).toBe(true);
    },
  );

  it.each(CLIENT_ONLY_FIXTURES)("rejects %s (client-only until #186)", (name) => {
    expect(fixtureFiles).toContain(name);
    const result = releaseRecordSchema.safeParse(loadFixture(name));
    expect(result.success).toBe(false);
  });

  it.each(fixtureFiles.filter((name) => name.startsWith("invalid-")))(
    "rejects %s",
    (name) => {
      const result = releaseRecordSchema.safeParse(loadFixture(name));
      expect(result.success).toBe(false);
    },
  );
});
