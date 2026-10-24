import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { assertMigrated, createDb, migrateDb } from "../../src/db/client";
import { playCounts, playDays } from "../../src/db/schema";
import { playCountsRequestSchema } from "../../src/shared/types";
import { makeReleaseRecord } from "../support/fixtures";
import { createTestServices, type TestServices } from "../support/testServices";

let services: TestServices;
vi.mock("../../src/server/container", () => ({
  getServices: async () => services,
}));

import * as playsRoute from "../../src/app/v1/plays/route";

const NOW = Date.UTC(2026, 9, 15, 12);
const DAY = "2026-10-14";
const uuid = () => crypto.randomUUID();

describe("play counts by source (#340)", () => {
  let userId: string;
  let deviceId: string;
  let token: string;
  let otherDeviceId: string;
  let releaseId: string;
  const track = uuid();

  async function signIn(deviceName: string, platform: "mac" | "ios") {
    const email = "alice@example.com";
    const code = await services.auth.issueCode(email);
    const res = await services.auth.verify({ email, code, deviceName, platform });
    return { userId: res.user.id, deviceId: res.device.id, token: res.token };
  }
  const push = (counts: Parameters<TestServices["plays"]["push"]>[2], dev = deviceId) => services.plays.push(userId, dev, counts);
  const stored = async (source: string) =>
    (await services.db.select().from(playCounts).where(and(eq(playCounts.trackId, track), eq(playCounts.source, source), eq(playCounts.deviceId, deviceId))))[0]?.count;
  const summary = () => services.plays.summary(userId, deviceId, "2026-10-05", "2026-10-15");

  beforeEach(async () => {
    services = await createTestServices();
    const { PlaysService } = await import("../../src/server/plays/PlaysService");
    services.plays = new PlaysService(services.db, () => NOW);
    const a = await signIn("Mac", "mac");
    ({ userId, deviceId, token } = a);
    otherDeviceId = (await signIn("iPhone", "ios")).deviceId;
    const record = makeReleaseRecord();
    releaseId = record.id;
    await services.releases.upsert(userId, releaseId, record);
  });

  it("counts an entry without source as spotify", async () => {
    await push([{ releaseId, trackId: track, count: 4, days: [{ day: DAY, count: 4 }] }]);
    expect(await stored("spotify")).toBe(4);
    expect(await stored("locally")).toBeUndefined();
    const days = await services.db.select().from(playDays);
    expect(days.map((d) => d.source)).toEqual(["spotify"]);
  });

  it("stores spotify and locally apart, with max per source", async () => {
    await push([{ releaseId, trackId: track, count: 5 }, { releaseId, trackId: track, count: 2, source: "locally" }]);
    await push([{ releaseId, trackId: track, count: 3, source: "spotify" }, { releaseId, trackId: track, count: 7, source: "locally" }]);
    expect(await stored("spotify")).toBe(5);
    expect(await stored("locally")).toBe(7);
    await push([{ releaseId, trackId: track, count: 6 }, { releaseId, trackId: track, count: 1, source: "locally" }]);
    expect(await stored("spotify")).toBe(6);
    expect(await stored("locally")).toBe(7);
  });

  it("keeps days per source with max per source", async () => {
    await push([
      { releaseId, trackId: track, count: 3, days: [{ day: DAY, count: 3 }] },
      { releaseId, trackId: track, count: 2, source: "locally", days: [{ day: DAY, count: 2 }] },
    ]);
    await push([{ releaseId, trackId: track, count: 1, source: "locally", days: [{ day: DAY, count: 1 }] }]);
    const rows = await services.db.select().from(playDays).orderBy(playDays.source);
    expect(rows.map((r) => [r.source, r.count])).toEqual([["locally", 2], ["spotify", 3]]);
  });

  it("sums sources in both reads and reports bySource", async () => {
    await push([
      { releaseId, trackId: track, count: 3, days: [{ day: DAY, count: 3 }] },
      { releaseId, trackId: track, count: 2, source: "locally", days: [{ day: DAY, count: 2 }] },
    ]);
    await push([{ releaseId, trackId: track, count: 4, source: "locally" }], otherDeviceId);

    const res = await summary();
    expect(res.allTime).toEqual([{ trackId: track, releaseId, plays: 9, devicePlays: 5, bySource: { spotify: 3, locally: 6 }, lastPlayedAt: null, listenedMs: 0, events: 0 }]);
    expect(res.tracks).toEqual([{ trackId: track, releaseId, plays: 5, devicePlays: 5, lastPlayedDay: DAY, bySource: { spotify: 3, locally: 2 }, lastPlayedAt: null, listenedMs: 0, events: 0 }]);

    const rel = await services.plays.forRelease(userId, releaseId, deviceId);
    expect(rel!.tracks).toHaveLength(1);
    expect(rel!.tracks[0]!.total).toBe(9);
    expect(rel!.tracks[0]!.devices.map((d) => [d.deviceId, d.count]).sort()).toEqual([[deviceId, 5], [otherDeviceId, 4]].sort());
  });

  it("refuses an unknown source with a 400, and accepts the two known ones", async () => {
    const put = (source: unknown) =>
      playsRoute.PUT(
        new Request("http://localhost/v1/plays", {
          method: "PUT",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ counts: [{ releaseId, trackId: track, count: 1, source }] }),
        })
      );
    expect((await put("deezer")).status).toBe(400);
    expect((await put(null)).status).toBe(400);
    expect((await put("locally")).status).toBe(200);
    expect((await put(undefined)).status).toBe(200);
    expect(playCountsRequestSchema.safeParse({ counts: [{ releaseId, trackId: track, count: 1, source: "Spotify" }] }).success).toBe(false);
  });
});

describe("migration 0011 (play_counts / play_days source, #340)", () => {
  const MIGRATION_TAG = "0011_simple_starjammers";
  const drizzleDir = path.join(process.cwd(), "drizzle");
  let previousDir: string;

  beforeEach(() => {
    previousDir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-source-"));
    fs.mkdirSync(path.join(previousDir, "meta"));
    const journal = JSON.parse(fs.readFileSync(path.join(drizzleDir, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
    const index = journal.entries.findIndex((e) => e.tag === MIGRATION_TAG);
    expect(index, "the migration is in the journal").toBeGreaterThan(0);
    const previous = journal.entries.slice(0, index);
    fs.writeFileSync(path.join(previousDir, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: previous }));
    for (const e of previous) fs.copyFileSync(path.join(drizzleDir, `${e.tag}.sql`), path.join(previousDir, `${e.tag}.sql`));
  });

  afterEach(() => {
    fs.rmSync(previousDir, { recursive: true, force: true });
  });

  it("keeps every existing row as spotify with totals unchanged, then takes locally rows beside them", async () => {
    const db = createDb(":memory:");
    await migrate(db, { migrationsFolder: previousDir });
    await db.run(sql`insert into play_counts (user_id, device_id, release_id, track_id, count, updated_at) values ('u', 'd', 'r', 't1', 5, 1), ('u', 'd', 'r', 't2', 7, 1)`);
    await db.run(sql`insert into play_days (user_id, device_id, release_id, track_id, day, count, updated_at) values ('u', 'd', 'r', 't1', '2026-10-14', 2, 1), ('u', 'd', 'r', 't1', '2026-10-15', 3, 1)`);

    await migrateDb(db);

    expect(await db.all(sql`select track_id, source, count from play_counts order by track_id`)).toEqual([
      { track_id: "t1", source: "spotify", count: 5 },
      { track_id: "t2", source: "spotify", count: 7 },
    ]);
    expect(await db.all(sql`select day, source, count from play_days order by day`)).toEqual([
      { day: "2026-10-14", source: "spotify", count: 2 },
      { day: "2026-10-15", source: "spotify", count: 3 },
    ]);
    expect(await db.all(sql`select sum(count) as total from play_counts`)).toEqual([{ total: 12 }]);
    // Indexes survive the rebuild, and the new uniqueness lets a locally row sit beside the spotify one.
    const idx = await db.all<{ name: string }>(sql`select name from sqlite_master where type = 'index' and name in ('play_counts_user_release_idx', 'play_days_user_day_idx')`);
    expect(idx).toHaveLength(2);
    await db.run(sql`insert into play_counts (user_id, device_id, release_id, track_id, source, count, updated_at) values ('u', 'd', 'r', 't1', 'locally', 1, 2)`);
    await expect(
      db.run(sql`insert into play_counts (user_id, device_id, release_id, track_id, source, count, updated_at) values ('u', 'd', 'r', 't1', 'locally', 1, 2)`)
    ).rejects.toThrow();
    await expect(assertMigrated(db)).resolves.toBeUndefined();
  });

  it("migrates a fresh database with source defaulting to spotify", async () => {
    const db = createDb(":memory:");
    await migrateDb(db);
    await db.run(sql`insert into play_counts (user_id, device_id, release_id, track_id, count, updated_at) values ('u', 'd', 'r', 't', 1, 1)`);
    expect(await db.all(sql`select source from play_counts`)).toEqual([{ source: "spotify" }]);
    const pk = await db.all<{ name: string }>(sql`select name from pragma_table_info('play_days') where pk > 0 order by pk`);
    expect(pk.map((c) => c.name)).toEqual(["device_id", "track_id", "source", "day"]);
  });
});
