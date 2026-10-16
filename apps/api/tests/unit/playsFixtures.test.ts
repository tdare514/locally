import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { playCountsRequestSchema } from "../../src/shared/types";

// `plays/` holds pushes every shipped client must agree on. `plays-days/` holds pushes with `days`
// (#201): only the API reads them until the Mac's schema takes `days` (#202), whose tests then read
// this folder too.
const folders = ["plays", "plays-days"].map((folder) => ({
  folder,
  dir: fileURLToPath(new URL(`../../../../spec/fixtures/${folder}/`, import.meta.url)),
}));
const fixtures = folders.flatMap(({ folder, dir }) =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({ id: `${folder}/${name}`, name, path: `${dir}${name}` }))
);

function loadFixture(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("play counts fixtures", () => {
  it("finds fixtures in each folder and every file matches a known prefix", () => {
    for (const { folder } of folders) {
      const names = fixtures.filter((f) => f.id.startsWith(`${folder}/`)).map((f) => f.name);
      expect(names.some((name) => name.startsWith("valid-")), folder).toBe(true);
      expect(names.some((name) => name.startsWith("invalid-")), folder).toBe(true);
    }
    for (const { id, name } of fixtures) {
      expect(name.startsWith("valid-") || name.startsWith("invalid-"), `${id} has an unknown prefix`).toBe(true);
    }
  });

  it.each(fixtures.filter((f) => f.name.startsWith("valid-")).map((f) => [f.id, f.path]))("accepts %s", (_id, path) => {
    expect(playCountsRequestSchema.safeParse(loadFixture(path)).success).toBe(true);
  });

  it.each(fixtures.filter((f) => f.name.startsWith("invalid-")).map((f) => [f.id, f.path]))("rejects %s", (_id, path) => {
    expect(playCountsRequestSchema.safeParse(loadFixture(path)).success).toBe(false);
  });
});
