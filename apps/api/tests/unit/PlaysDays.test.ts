import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { playCounts, playDays, releases } from "../../src/db/schema";
import { InMemoryRateLimiter } from "../../src/server/ratelimit/InMemoryRateLimiter";
import { ValidationError } from "../../src/shared/errors";
import { playCountsRequestSchema } from "../../src/shared/types";
import { makeReleaseRecord } from "../support/fixtures";
import { createTestServices, type TestServices } from "../support/testServices";

let testServices: TestServices;
vi.mock("../../src/server/container", () => ({
  getServices: async () => testServices,
}));

import * as playsSummaryRoute from "../../src/app/v1/plays/summary/route";

interface Account {
  userId: string;
  deviceId: string;
  token: string;
}

const NOW = Date.UTC(2026, 9, 15, 12); // 2026-10-15 UTC
const TODAY = "2026-10-15";
const uuid = () => crypto.randomUUID();

describe("play days", () => {
  let alice: Account;
  let aliceIos: Account;
  let bob: Account;
  let releaseId: string;
  const trackA = uuid();
  const trackB = uuid();

  async function signIn(email: string, deviceName: string, platform: "mac" | "ios"): Promise<Account> {
    const code = await testServices.auth.issueCode(email);
    const res = await testServices.auth.verify({ email, code, deviceName, platform });
    return { userId: res.user.id, deviceId: res.device.id, token: res.token };
  }

  const push = (acc: Account, counts: Parameters<TestServices["plays"]["push"]>[2]) =>
    testServices.plays.push(acc.userId, acc.deviceId, counts);

  async function storedDay(deviceId: string, trackId: string, day: string): Promise<number | undefined> {
    const [row] = await testServices.db
      .select()
      .from(playDays)
      .where(and(eq(playDays.deviceId, deviceId), eq(playDays.trackId, trackId), eq(playDays.day, day)));
    return row?.count;
  }

  beforeEach(async () => {
    testServices = await createTestServices();
    // Fixed clock for the service (the route reads the same service).
    const { PlaysService } = await import("../../src/server/plays/PlaysService");
    testServices.plays = new PlaysService(testServices.db, () => NOW);
    alice = await signIn("alice@example.com", "Alice Mac", "mac");
    aliceIos = await signIn("alice@example.com", "Alice iPhone", "ios");
    bob = await signIn("bob@example.com", "Bob Mac", "mac");
    const record = makeReleaseRecord();
    releaseId = record.id;
    await testServices.releases.upsert(alice.userId, releaseId, record);
  });

  describe("push", () => {
    it("merges per (device, track, day) as max(stored, sent)", async () => {
      await push(alice, [{ releaseId, trackId: trackA, count: 5, days: [{ day: "2026-10-14", count: 4 }] }]);
      await push(alice, [{ releaseId, trackId: trackA, count: 5, days: [{ day: "2026-10-14", count: 2 }] }]);
      expect(await storedDay(alice.deviceId, trackA, "2026-10-14")).toBe(4);
      await push(alice, [{ releaseId, trackId: trackA, count: 6, days: [{ day: "2026-10-14", count: 7 }] }]);
      expect(await storedDay(alice.deviceId, trackA, "2026-10-14")).toBe(7);
    });

    it("leaves entries without days exactly as before", async () => {
      const res = await push(alice, [{ releaseId, trackId: trackA, count: 3 }]);
      expect(res).toEqual({ accepted: 1, ignored: 0 });
      expect(await testServices.db.select().from(playDays)).toHaveLength(0);
    });

    it("ignores days (and the entry) for a release that isn't the user's", async () => {
      const res = await push(bob, [{ releaseId, trackId: trackA, count: 3, days: [{ day: TODAY, count: 3 }] }]);
      expect(res).toEqual({ accepted: 0, ignored: 1 });
      expect(await testServices.db.select().from(playDays)).toHaveLength(0);
    });

    it("ignores days for a tombstoned release", async () => {
      await testServices.db.update(releases).set({ deleted: true }).where(eq(releases.id, releaseId));
      const res = await push(alice, [{ releaseId, trackId: trackA, count: 3, days: [{ day: TODAY, count: 3 }] }]);
      expect(res).toEqual({ accepted: 0, ignored: 1 });
      expect(await testServices.db.select().from(playDays)).toHaveLength(0);
    });

    it("accepts tomorrow, refuses the day after with a ValidationError", async () => {
      await push(alice, [{ releaseId, trackId: trackA, count: 1, days: [{ day: "2026-10-16", count: 1 }] }]);
      expect(await storedDay(alice.deviceId, trackA, "2026-10-16")).toBe(1);
      await expect(
        push(alice, [{ releaseId, trackId: trackA, count: 1, days: [{ day: "2026-10-17", count: 1 }] }])
      ).rejects.toThrow(ValidationError);
    });

    it("silently drops days older than 400 days and keeps the 400th", async () => {
      // 400 days before 2026-10-15 is 2025-09-10.
      const res = await push(alice, [
        {
          releaseId,
          trackId: trackA,
          count: 2,
          days: [
            { day: "2025-09-09", count: 1 },
            { day: "2025-09-10", count: 1 },
          ],
        },
      ]);
      expect(res).toEqual({ accepted: 1, ignored: 0 });
      expect(await storedDay(alice.deviceId, trackA, "2025-09-09")).toBeUndefined();
      expect(await storedDay(alice.deviceId, trackA, "2025-09-10")).toBe(1);
    });
  });

  describe("request schema", () => {
    const entry = (days: unknown) => ({ counts: [{ releaseId: uuid(), trackId: uuid(), count: 1, days }] });
    const ok = (body: unknown) => playCountsRequestSchema.safeParse(body).success;

    it("accepts good days and refuses bad shapes, impossible dates and bad counts", () => {
      expect(ok(entry([{ day: "2026-10-15", count: 1 }]))).toBe(true);
      expect(ok(entry([]))).toBe(true);
      expect(ok(entry([{ day: "2026-1-5", count: 1 }]))).toBe(false);
      expect(ok(entry([{ day: "2026-10-15T00:00:00Z", count: 1 }]))).toBe(false);
      expect(ok(entry([{ day: "2026-02-30", count: 1 }]))).toBe(false);
      expect(ok(entry([{ day: "2026-10-15", count: -1 }]))).toBe(false);
      expect(ok(entry([{ day: "2026-10-15", count: 1_000_001 }]))).toBe(false);
      expect(ok(entry([{ day: "2026-10-15", count: 1.5 }]))).toBe(false);
      expect(ok(entry([{ day: "2026-10-15", count: 1, extra: 1 }]))).toBe(false);
    });

    it("refuses a duplicate day, more than 400 days per entry, and more than 2,000 per request", () => {
      expect(
        ok(entry([{ day: "2026-10-15", count: 1 }, { day: "2026-10-15", count: 2 }]))
      ).toBe(false);
      const dayList = (n: number, start = Date.UTC(2020, 0, 1)) =>
        Array.from({ length: n }, (_, i) => ({ day: new Date(start + i * 86_400_000).toISOString().slice(0, 10), count: 1 }));
      expect(ok(entry(dayList(400)))).toBe(true);
      expect(ok(entry(dayList(401)))).toBe(false);
      const entries = (n: number) => ({
        counts: Array.from({ length: n }, () => ({ releaseId: uuid(), trackId: uuid(), count: 1, days: dayList(400) })),
      });
      expect(ok(entries(5))).toBe(true); // 2,000
      expect(ok(entries(6))).toBe(false); // 2,400
    });
  });

  describe("summary", () => {
    async function seedTwoDevices() {
      await push(alice, [
        {
          releaseId,
          trackId: trackA,
          count: 10,
          days: [
            { day: "2026-10-01", count: 1 },
            { day: "2026-10-10", count: 2 },
            { day: "2026-10-14", count: 3 },
          ],
        },
        { releaseId, trackId: trackB, count: 4, days: [{ day: "2026-09-01", count: 4 }] },
      ]);
      await push(aliceIos, [
        { releaseId, trackId: trackA, count: 5, days: [{ day: "2026-10-12", count: 5 }, { day: "2026-10-13", count: 0 }] },
      ]);
    }

    it("sums across devices for the range, with lastPlayedDay, leaving out days and tracks outside it", async () => {
      await seedTwoDevices();
      const res = await testServices.plays.summary(alice.userId, alice.deviceId, "2026-10-05", "2026-10-15");
      expect(res.tracks).toEqual([{ trackId: trackA, releaseId, plays: 10, devicePlays: 5, lastPlayedDay: "2026-10-14", bySource: { spotify: 10, locally: 0 } }]);
      expect(res.allTime).toEqual(
        [
          { trackId: trackA, releaseId, plays: 15, devicePlays: 10, bySource: { spotify: 15, locally: 0 } },
          { trackId: trackB, releaseId, plays: 4, devicePlays: 4, bySource: { spotify: 4, locally: 0 } },
        ].sort((x, y) => (x.trackId < y.trackId ? -1 : 1))
      );
      expect(res.nextCursor).toBeNull();
    });

    it("reports the caller's own share as devicePlays, whichever device calls", async () => {
      await seedTwoDevices();
      const mac = await testServices.plays.summary(alice.userId, alice.deviceId, "2026-10-05", "2026-10-15");
      expect(mac.tracks.map((r) => [r.plays, r.devicePlays])).toEqual([[10, 5]]);
      expect(mac.allTime.map((r) => [r.trackId, r.plays, r.devicePlays]).sort()).toEqual(
        [[trackA, 15, 10], [trackB, 4, 4]].sort()
      );
      const ios = await testServices.plays.summary(alice.userId, aliceIos.deviceId, "2026-10-05", "2026-10-15");
      expect(ios.tracks.map((r) => [r.plays, r.devicePlays])).toEqual([[10, 5]]);
      expect(ios.allTime.map((r) => [r.trackId, r.plays, r.devicePlays]).sort()).toEqual(
        [[trackA, 15, 5], [trackB, 4, 0]].sort()
      );
    });

    it("leaves a revoked device of the caller out of devicePlays but in plays", async () => {
      await seedTwoDevices();
      await testServices.auth.revokeDevice(alice.userId, aliceIos.deviceId);
      const res = await testServices.plays.summary(alice.userId, alice.deviceId, "2026-10-05", "2026-10-15");
      expect(res.tracks.map((r) => [r.plays, r.devicePlays])).toEqual([[10, 5]]);
      expect(res.allTime.find((r) => r.trackId === trackA)).toMatchObject({ plays: 15, devicePlays: 10, bySource: { spotify: 15, locally: 0 } });
    });

    it("shows another user's caller no devicePlays of this user's tracks", async () => {
      await seedTwoDevices();
      const res = await testServices.plays.summary(bob.userId, bob.deviceId, "2026-09-01", TODAY);
      expect(res).toEqual({ tracks: [], allTime: [], nextCursor: null });
    });

    it("ignores a zero-count day for lastPlayedDay", async () => {
      await seedTwoDevices();
      const res = await testServices.plays.summary(alice.userId, alice.deviceId, "2026-10-13", "2026-10-13");
      expect(res.tracks).toEqual([]);
    });

    it("excludes tombstoned releases from both lists", async () => {
      await seedTwoDevices();
      await testServices.db.update(releases).set({ deleted: true }).where(eq(releases.id, releaseId));
      expect(await testServices.plays.summary(alice.userId, alice.deviceId, "2026-09-01", TODAY)).toEqual({
        tracks: [],
        allTime: [],
        nextCursor: null,
      });
    });

    it("gives another account nothing of this user's tracks", async () => {
      await seedTwoDevices();
      expect(await testServices.plays.summary(bob.userId, bob.deviceId, "2026-09-01", TODAY)).toEqual({
        tracks: [],
        allTime: [],
        nextCursor: null,
      });
    });

    it("refuses a reversed range", async () => {
      await expect(testServices.plays.summary(alice.userId, alice.deviceId, "2026-10-15", "2026-10-14")).rejects.toThrow(ValidationError);
    });

    it("allows exactly 400 days and refuses 401", async () => {
      await expect(testServices.plays.summary(alice.userId, alice.deviceId, "2025-09-11", TODAY)).resolves.toBeDefined(); // 400 days
      await expect(testServices.plays.summary(alice.userId, alice.deviceId, "2025-09-10", TODAY)).rejects.toThrow(ValidationError); // 401
    });

    it("allows to = tomorrow and refuses the day after", async () => {
      await expect(testServices.plays.summary(alice.userId, alice.deviceId, "2026-10-16", "2026-10-16")).resolves.toBeDefined();
      await expect(testServices.plays.summary(alice.userId, alice.deviceId, "2026-10-17", "2026-10-17")).rejects.toThrow(ValidationError);
    });

    it("pages by track id: 1,000 per page, nextCursor continues, both lists cover the same page", async () => {
      const ids = Array.from({ length: 1_001 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
      await testServices.db.insert(playCounts).values(
        ids.map((trackId) => ({ userId: alice.userId, deviceId: alice.deviceId, releaseId, trackId, count: 1, updatedAt: NOW }))
      );
      await testServices.db.insert(playDays).values(
        ids.map((trackId) => ({ userId: alice.userId, deviceId: alice.deviceId, releaseId, trackId, day: "2026-10-14", count: 1, updatedAt: NOW }))
      );
      const first = await testServices.plays.summary(alice.userId, alice.deviceId, "2026-10-14", "2026-10-14");
      expect(first.allTime).toHaveLength(1_000);
      expect(first.tracks).toHaveLength(1_000);
      expect(first.nextCursor).toBe(ids[999]);
      expect(first.tracks.every((r) => r.plays === 1 && r.devicePlays === 1)).toBe(true);
      expect(first.allTime.every((r) => r.plays === 1 && r.devicePlays === 1)).toBe(true);
      const second = await testServices.plays.summary(alice.userId, alice.deviceId, "2026-10-14", "2026-10-14", first.nextCursor!);
      expect(second.allTime.map((r) => r.trackId)).toEqual([ids[1_000]]);
      expect(second.tracks.map((r) => r.trackId)).toEqual([ids[1_000]]);
      expect(second.nextCursor).toBeNull();
      expect(second.tracks[0]).toMatchObject({ plays: 1, devicePlays: 1 });
      expect(second.allTime[0]).toMatchObject({ plays: 1, devicePlays: 1 });
      // The other device of the user sees the same pages with no share of its own.
      const other = await testServices.plays.summary(alice.userId, aliceIos.deviceId, "2026-10-14", "2026-10-14");
      expect(other.tracks.every((r) => r.plays === 1 && r.devicePlays === 0)).toBe(true);
    });

    it("keeps a track's live days when its count row moved to a release that was then tombstoned", async () => {
      // Codex #214: T pushed with days under release A, then without days under B (the count row
      // follows to B), then B is tombstoned. A's day rows are still live and must still be served.
      const recordB = makeReleaseRecord();
      await testServices.releases.upsert(alice.userId, recordB.id, recordB);
      await push(alice, [{ releaseId, trackId: trackA, count: 3, days: [{ day: "2026-10-14", count: 3 }] }]);
      await push(alice, [{ releaseId: recordB.id, trackId: trackA, count: 4 }]);
      await testServices.db.update(releases).set({ deleted: true }).where(eq(releases.id, recordB.id));

      expect(await testServices.plays.summary(alice.userId, alice.deviceId, "2026-10-14", "2026-10-14")).toEqual({
        tracks: [{ trackId: trackA, releaseId, plays: 3, devicePlays: 3, lastPlayedDay: "2026-10-14", bySource: { spotify: 3, locally: 0 } }],
        allTime: [],
        nextCursor: null,
      });
    });
  });

  describe("account deletion", () => {
    it("removes play days when the user row is deleted by any code, not only AccountService", async () => {
      // The migration's trigger: a rolled-back deploy deletes the user without knowing play_days.
      await push(alice, [{ releaseId, trackId: trackA, count: 2, days: [{ day: "2026-10-14", count: 2 }] }]);
      await push(bob, [{ releaseId, trackId: trackA, count: 1, days: [{ day: "2026-10-14", count: 1 }] }]);
      const before = await testServices.db.select().from(playDays);
      expect(before.map((r) => r.userId)).toEqual([alice.userId]); // bob's release isn't his: ignored
      await testServices.db.run(sql`delete from users where id = ${alice.userId}`);
      expect(await testServices.db.select().from(playDays)).toEqual([]);
    });
  });

  describe("GET /v1/plays/summary route", () => {
    const get = (qs: string, token = alice.token) =>
      playsSummaryRoute.GET(new Request(`http://localhost/v1/plays/summary${qs}`, { headers: { authorization: `Bearer ${token}` } }));

    it("answers 200 with the response shape", async () => {
      await push(alice, [{ releaseId, trackId: trackA, count: 2, days: [{ day: "2026-10-14", count: 2 }] }]);
      const res = await get("?from=2026-10-14&to=2026-10-14");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        tracks: [{ trackId: trackA, releaseId, plays: 2, devicePlays: 2, lastPlayedDay: "2026-10-14", bySource: { spotify: 2, locally: 0 } }],
        allTime: [{ trackId: trackA, releaseId, plays: 2, devicePlays: 2, bySource: { spotify: 2, locally: 0 } }],
        nextCursor: null,
      });
    });

    it.each([
      ["missing params", ""],
      ["bad shape", "?from=2026-1-1&to=2026-10-15"],
      ["impossible date", "?from=2026-02-30&to=2026-03-01"],
      ["from after to", "?from=2026-10-15&to=2026-10-14"],
      ["over 400 days", "?from=2025-01-01&to=2026-10-15"],
      ["to after tomorrow", "?from=2026-10-15&to=2026-10-17"],
      ["cursor not a uuid", "?from=2026-10-14&to=2026-10-15&cursor=abc"],
    ])("answers 400 for %s", async (_name, qs) => {
      expect((await get(qs)).status).toBe(400);
    });

    it("refuses the 601st call in an hour with 429", async () => {
      testServices.rateLimiters.playsSummary = new InMemoryRateLimiter(600, 60 * 60 * 1000);
      for (let i = 0; i < 600; i++) {
        expect((await get("?from=2026-10-14&to=2026-10-14")).status).toBe(200);
      }
      expect((await get("?from=2026-10-14&to=2026-10-14")).status).toBe(429);
      // Another user has their own budget.
      expect((await get("?from=2026-10-14&to=2026-10-14", bob.token)).status).toBe(200);
    });
  });
});
