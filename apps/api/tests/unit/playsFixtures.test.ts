import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeReleaseRecord } from "../support/fixtures";
import { createTestServices } from "../support/testServices";
import { ValidationError } from "../../src/shared/errors";
import { PlayEventsService } from "../../src/server/plays/PlayEventsService";
import { playCountsRequestSchema, playEventsRequestSchema } from "../../src/shared/types";

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

// `play-events/` (#368): the push bodies are `valid-push.json` and `invalid-*.json`; the other `valid-*`
// files are server replies, which each client parses and the API does not read.
const eventsDir = fileURLToPath(new URL("../../../../spec/fixtures/play-events/", import.meta.url));
const eventFiles = readdirSync(eventsDir).filter((name) => name.endsWith(".json"));
const eventBodies = (prefix: (name: string) => boolean) => eventFiles.filter(prefix).map((name) => [name, `${eventsDir}${name}`]);

describe("play events fixtures", () => {
  it("finds the push body and the invalid bodies", () => {
    expect(eventFiles).toContain("valid-push.json");
    expect(eventFiles.some((name) => name.startsWith("invalid-"))).toBe(true);
  });

  it.each(eventBodies((name) => name === "valid-push.json"))("accepts %s through the schema and the service", async (_name, path) => {
    const body = playEventsRequestSchema.parse(loadFixture(path));
    const services = await createTestServices();
    const service = new PlayEventsService(services.db, () => Date.UTC(2026, 9, 25));
    const code = await services.auth.issueCode("fixture@example.com");
    const signedIn = await services.auth.verify({ email: "fixture@example.com", code, deviceName: "Mac", platform: "mac" });
    for (const id of new Set(body.events.map((e) => e.releaseId))) {
      await services.releases.upsert(signedIn.user.id, id, makeReleaseRecord({ id }));
    }
    await expect(service.push(signedIn.user.id, signedIn.device.id, body.events)).resolves.toEqual({
      accepted: body.events.length,
      ignored: 0,
    });
  });

  it.each(eventBodies((name) => name.startsWith("invalid-")))("rejects %s with a 400", async (_name, path) => {
    const parsed = playEventsRequestSchema.safeParse(loadFixture(path));
    if (!parsed.success) return;
    // Only the future-startedAt fixture passes the schema: the clock check is the service's.
    const services = await createTestServices();
    const service = new PlayEventsService(services.db, () => Date.UTC(2026, 9, 25));
    await expect(service.push(crypto.randomUUID(), crypto.randomUUID(), parsed.data.events)).rejects.toThrow(ValidationError);
  });

  it("refuses a batch of 501 built here, and takes 500", () => {
    const event = (loadFixture(`${eventsDir}valid-push.json`) as { events: unknown[] }).events[0];
    expect(playEventsRequestSchema.safeParse({ events: Array.from({ length: 500 }, () => event) }).success).toBe(true);
    expect(playEventsRequestSchema.safeParse({ events: Array.from({ length: 501 }, () => event) }).success).toBe(false);
  });
});
