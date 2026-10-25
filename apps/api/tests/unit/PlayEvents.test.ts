import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { playEvents, releases } from "../../src/db/schema";
import { CleanupService } from "../../src/server/cleanup/CleanupService";
import { PlayEventsService } from "../../src/server/plays/PlayEventsService";
import { InMemoryRateLimiter } from "../../src/server/ratelimit/InMemoryRateLimiter";
import { ValidationError } from "../../src/shared/errors";
import { playEventsRequestSchema, type PlayEventInput } from "../../src/shared/types";
import { makeReleaseRecord } from "../support/fixtures";
import { createTestServices, type TestServices } from "../support/testServices";

let testServices: TestServices;
vi.mock("../../src/server/container", () => ({
  getServices: async () => testServices,
}));

import * as eventsRoute from "../../src/app/v1/plays/events/route";
import * as playsSummaryRoute from "../../src/app/v1/plays/summary/route";

interface Account {
  userId: string;
  deviceId: string;
  token: string;
  email: string;
}

const NOW = Date.UTC(2026, 9, 15, 12); // 2026-10-15 12:00 UTC
const DAY_MS = 24 * 60 * 60 * 1000;
const uuid = () => crypto.randomUUID();

describe("play events", () => {
  let alice: Account;
  let aliceIos: Account;
  let bob: Account;
  let releaseId: string;
  const trackA = uuid();
  const trackB = uuid();

  async function signIn(email: string, deviceName: string, platform: "mac" | "ios"): Promise<Account> {
    const code = await testServices.auth.issueCode(email);
    const res = await testServices.auth.verify({ email, code, deviceName, platform });
    return { userId: res.user.id, deviceId: res.device.id, token: res.token, email };
  }

  const event = (over: Partial<PlayEventInput> = {}): PlayEventInput => ({
    id: uuid(),
    releaseId,
    trackId: trackA,
    source: "locally",
    startedAt: NOW - 1000,
    day: "2026-10-15",
    listenedMs: 60_000,
    ...over,
  });
  const push = (acc: Account, events: PlayEventInput[]) => testServices.playEvents.push(acc.userId, acc.deviceId, events);
  const stored = async (id: string, userId = alice.userId) =>
    (await testServices.db.select().from(playEvents)).find((r) => r.id === id && r.userId === userId);

  const putReq = (body: unknown, token = alice.token) =>
    eventsRoute.PUT(
      new Request("http://localhost/v1/plays/events", {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  const getReq = (qs: string, token = alice.token) =>
    eventsRoute.GET(new Request(`http://localhost/v1/plays/events${qs}`, { headers: { authorization: `Bearer ${token}` } }));

  beforeEach(async () => {
    testServices = await createTestServices();
    testServices.playEvents = new PlayEventsService(testServices.db, () => NOW);
    const { PlaysService } = await import("../../src/server/plays/PlaysService");
    testServices.plays = new PlaysService(testServices.db, () => NOW);
    alice = await signIn("alice@example.com", "Alice Mac", "mac");
    aliceIos = await signIn("alice@example.com", "Alice iPhone", "ios");
    bob = await signIn("bob@example.com", "Bob Mac", "mac");
    const record = makeReleaseRecord();
    releaseId = record.id;
    await testServices.releases.upsert(alice.userId, releaseId, record);
  });

  describe("PUT body", () => {
    const parse = (body: unknown) => playEventsRequestSchema.safeParse(body).success;
    it("is strict: unknown keys and deviceId are refused at every level", () => {
      expect(parse({ events: [event()] })).toBe(true);
      expect(parse({ events: [event()], extra: 1 })).toBe(false);
      expect(parse({ events: [{ ...event(), extra: 1 }] })).toBe(false);
      expect(parse({ events: [{ ...event(), deviceId: uuid() }] })).toBe(false);
      expect(parse({ events: [{ ...event(), source: undefined }] })).toBe(false);
    });

    it("bounds listenedMs, day, startedAt type and the batch size", () => {
      expect(parse({ events: [event({ listenedMs: 0 })] })).toBe(true);
      expect(parse({ events: [event({ listenedMs: 86_400_000 })] })).toBe(true);
      expect(parse({ events: [event({ listenedMs: 86_400_001 })] })).toBe(false);
      expect(parse({ events: [event({ listenedMs: -1 })] })).toBe(false);
      expect(parse({ events: [event({ listenedMs: 1.5 })] })).toBe(false);
      expect(parse({ events: [event({ startedAt: 1.5 })] })).toBe(false);
      expect(parse({ events: [event({ day: "2026-02-30" })] })).toBe(false);
      expect(parse({ events: [] })).toBe(false);
      expect(parse({ events: Array.from({ length: 500 }, () => event()) })).toBe(true);
      expect(parse({ events: Array.from({ length: 501 }, () => event()) })).toBe(false);
    });
  });

  describe("push", () => {
    it("inserts new events and answers accepted/ignored", async () => {
      const e = event();
      expect(await push(alice, [e])).toEqual({ accepted: 1, ignored: 0 });
      expect(await stored(e.id)).toMatchObject({ deviceId: alice.deviceId, releaseId, trackId: trackA, listenedMs: 60_000, createdAt: NOW });
    });

    it("refuses startedAt past now + 24 h for the whole request, applying nothing; the edge is allowed", async () => {
      const ok = event({ startedAt: NOW + DAY_MS });
      const late = event({ startedAt: NOW + DAY_MS + 1 });
      await expect(push(alice, [ok, late])).rejects.toThrow(ValidationError);
      expect(await testServices.db.select().from(playEvents)).toHaveLength(0);
      expect(await push(alice, [ok])).toEqual({ accepted: 1, ignored: 0 });
    });

    it("refuses a day later than UTC tomorrow, accepts tomorrow", async () => {
      await expect(push(alice, [event({ day: "2026-10-17" })])).rejects.toThrow(ValidationError);
      expect(await push(alice, [event({ day: "2026-10-16" })])).toEqual({ accepted: 1, ignored: 0 });
    });

    it("silently drops an event older than 400 days into ignored, and keeps the 400th day", async () => {
      const old = event({ startedAt: NOW - 400 * DAY_MS - 1, day: "2025-09-10" });
      const edge = event({ startedAt: NOW - 400 * DAY_MS, day: "2025-09-10" });
      const fresh = event();
      expect(await push(alice, [old, edge, fresh])).toEqual({ accepted: 2, ignored: 1 });
      expect(await stored(old.id)).toBeUndefined();
      expect(await stored(edge.id)).toBeDefined();
    });

    it("is idempotent: listenedMs only grows and the fixed fields cannot change", async () => {
      const e = event({ listenedMs: 50_000 });
      await push(alice, [e]);
      expect(await push(alice, [{ ...e, listenedMs: 20_000 }])).toEqual({ accepted: 1, ignored: 0 });
      expect((await stored(e.id))?.listenedMs).toBe(50_000);
      expect(await push(alice, [{ ...e, listenedMs: 90_000 }])).toEqual({ accepted: 1, ignored: 0 });
      expect((await stored(e.id))?.listenedMs).toBe(90_000);
      expect(await testServices.db.select().from(playEvents)).toHaveLength(1);

      for (const changed of [
        { trackId: trackB },
        { source: "spotify" as const },
        { startedAt: e.startedAt - 5 },
        { day: "2026-10-14" },
        { releaseId: uuid() },
      ]) {
        expect(await push(alice, [{ ...e, ...changed, listenedMs: 99_000 }]), JSON.stringify(changed)).toEqual({ accepted: 0, ignored: 1 });
      }
      expect(await stored(e.id)).toMatchObject({ trackId: trackA, source: "locally", listenedMs: 90_000, day: "2026-10-15" });
    });

    it("ignores another device's id, even for the same account", async () => {
      const e = event({ listenedMs: 10_000 });
      await push(alice, [e]);
      expect(await push(aliceIos, [{ ...e, listenedMs: 99_000 }])).toEqual({ accepted: 0, ignored: 1 });
      expect(await stored(e.id)).toMatchObject({ deviceId: alice.deviceId, listenedMs: 10_000 });
    });

    it("ignores events of a tombstoned release or another account's release, applying the rest", async () => {
      expect(await push(bob, [event()])).toEqual({ accepted: 0, ignored: 1 });
      const live = event();
      const dead = event();
      await testServices.db.update(releases).set({ deleted: true }).where(eq(releases.id, releaseId));
      expect(await push(alice, [dead])).toEqual({ accepted: 0, ignored: 1 });
      await testServices.db.update(releases).set({ deleted: false }).where(eq(releases.id, releaseId));
      expect(await push(alice, [live])).toEqual({ accepted: 1, ignored: 0 });
      await testServices.db.update(releases).set({ deleted: true }).where(eq(releases.id, releaseId));
      expect(await push(alice, [{ ...live, listenedMs: 99_000 }])).toEqual({ accepted: 0, ignored: 1 });
    });

    it("keeps two accounts with the same event id apart", async () => {
      const bobRecord = makeReleaseRecord();
      await testServices.releases.upsert(bob.userId, bobRecord.id, bobRecord);
      const id = uuid();
      await push(alice, [event({ id, listenedMs: 1_000 })]);
      expect(await push(bob, [event({ id, releaseId: bobRecord.id, listenedMs: 7_000 })])).toEqual({ accepted: 1, ignored: 0 });
      expect((await stored(id, alice.userId))?.listenedMs).toBe(1_000);
      expect((await stored(id, bob.userId))?.listenedMs).toBe(7_000);
    });

    it("exposes upsertStatement for a caller's own batch", async () => {
      const e = event();
      const [rows] = await testServices.db.batch([testServices.playEvents.upsertStatement(alice.userId, alice.deviceId, e)]);
      expect(rows).toHaveLength(1);
      expect(await stored(e.id)).toBeDefined();
    });
  });

  describe("PUT route", () => {
    it("answers 200 with the counts, 401 without a token, 400 for a bad body", async () => {
      const res = await putReq({ events: [event()] });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ accepted: 1, ignored: 0 });
      expect((await eventsRoute.PUT(new Request("http://localhost/v1/plays/events", { method: "PUT", body: "{}" }))).status).toBe(401);
      expect((await putReq({ events: [] })).status).toBe(400);
      expect((await putReq({ events: [{ ...event(), deviceId: uuid() }] })).status).toBe(400);
      expect((await putReq({ events: [event({ startedAt: NOW + 2 * DAY_MS })] })).status).toBe(400);
    });

    it("refuses the 121st request in an hour with 429, per user", async () => {
      testServices.rateLimiters.playEvents = new InMemoryRateLimiter(120, 60 * 60 * 1000);
      for (let i = 0; i < 120; i++) expect((await putReq({ events: [event()] })).status).toBe(200);
      expect((await putReq({ events: [event()] })).status).toBe(429);
      expect((await putReq({ events: [event()] }, bob.token)).status).toBe(200);
    });
  });

  describe("GET /v1/plays/events", () => {
    it("answers the window checks with 400", async () => {
      const ok = `?from=${NOW - DAY_MS}&to=${NOW}`;
      expect((await getReq(ok)).status).toBe(200);
      for (const qs of [
        "",
        `?from=${NOW}`,
        `?from=${NOW}&to=${NOW - 1}`,
        `?from=0&to=${400 * DAY_MS + 1}`,
        "?from=abc&to=5",
        "?from=1.5&to=5",
        "?from=&to=5",
        "?from=-1&to=5",
        `${ok}&cursor=***`,
        `${ok}&cursor=${Buffer.from("not json").toString("base64url")}`,
        `${ok}&cursor=${Buffer.from(JSON.stringify(["x", "y"])).toString("base64url")}`,
      ]) {
        expect((await getReq(qs)).status, qs).toBe(400);
      }
      expect((await getReq(`?from=0&to=${400 * DAY_MS}`)).status).toBe(200);
      expect((await eventsRoute.GET(new Request(`http://localhost/v1/plays/events${ok}`))).status).toBe(401);
    });

    it("serves newest first with the device object, matching from <= startedAt < to", async () => {
      const a = event({ startedAt: NOW - 3000 });
      const b = event({ startedAt: NOW - 1000 });
      const c = event({ startedAt: NOW - 2000, trackId: trackB });
      await push(alice, [a, b, c]);
      const d = event({ startedAt: NOW - 500 });
      await push(aliceIos, [d]);
      const res = await getReq(`?from=${NOW - 3000}&to=${NOW - 500}`);
      const body = await res.json();
      expect(body.events.map((e: { id: string }) => e.id)).toEqual([b.id, c.id, a.id]);
      expect(body.nextCursor).toBeNull();
      expect(body.events[0]).toEqual({ ...b, device: { id: alice.deviceId, name: "Alice Mac", platform: "mac", current: true } });
      const ios = await (await getReq(`?from=${NOW - 3000}&to=${NOW}`, aliceIos.token)).json();
      expect(ios.events[0].device).toEqual({ id: aliceIos.deviceId, name: "Alice iPhone", platform: "ios", current: true });
      expect(ios.events[1].device.current).toBe(false);
    });

    it("lists a revoked device's events and never a tombstoned release's", async () => {
      const e = event({ listenedMs: 5 });
      await push(aliceIos, [e]);
      await testServices.db.run(sql`update devices set revoked_at = ${NOW} where id = ${aliceIos.deviceId}`);
      const body = await (await getReq(`?from=${NOW - 300 * DAY_MS}&to=${NOW}`)).json();
      expect(body.events).toHaveLength(1);
      expect(body.events[0].device).toMatchObject({ id: aliceIos.deviceId, current: false });
      await testServices.db.update(releases).set({ deleted: true }).where(eq(releases.id, releaseId));
      expect((await (await getReq(`?from=${NOW - 300 * DAY_MS}&to=${NOW}`)).json()).events).toEqual([]);
    });

    it("pages 500 at a time through an opaque cursor, ties broken by id, with no repeats or gaps", async () => {
      const events = Array.from({ length: 501 }, (_, i) => event({ startedAt: NOW - 10_000 - Math.floor(i / 2) }));
      for (let i = 0; i < events.length; i += 500) await push(alice, events.slice(i, i + 500));
      const first = await (await getReq(`?from=${NOW - 300 * DAY_MS}&to=${NOW}`)).json();
      expect(first.events).toHaveLength(500);
      expect(typeof first.nextCursor).toBe("string");
      expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
      const second = await (await getReq(`?from=${NOW - 300 * DAY_MS}&to=${NOW}&cursor=${first.nextCursor}`)).json();
      expect(second.events).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
      const all = [...first.events, ...second.events] as Array<{ id: string; startedAt: number }>;
      expect(new Set(all.map((e) => e.id)).size).toBe(501);
      const expected = [...events].sort((x, y) => y.startedAt - x.startedAt || (x.id < y.id ? -1 : 1)).map((e) => e.id);
      expect(all.map((e) => e.id)).toEqual(expected);
    });

    it("keeps its own events from another account", async () => {
      await push(alice, [event()]);
      expect((await (await getReq(`?from=${NOW - 300 * DAY_MS}&to=${NOW}`, bob.token)).json())).toEqual({ events: [], nextCursor: null });
    });

    it("shares the playsSummary limit", async () => {
      testServices.rateLimiters.playsSummary = new InMemoryRateLimiter(2, 60 * 60 * 1000);
      expect((await getReq(`?from=${NOW - 300 * DAY_MS}&to=${NOW}`)).status).toBe(200);
      expect((await playsSummaryRoute.GET(new Request("http://localhost/v1/plays/summary?from=2026-10-14&to=2026-10-15", { headers: { authorization: `Bearer ${alice.token}` } }))).status).toBe(200);
      expect((await getReq(`?from=${NOW - 300 * DAY_MS}&to=${NOW}`)).status).toBe(429);
    });
  });

  describe("summary fields", () => {
    it("adds lastPlayedAt, listenedMs and events over the window (by day) and over all events", async () => {
      await testServices.plays.push(alice.userId, alice.deviceId, [
        { releaseId, trackId: trackA, count: 5, days: [{ day: "2026-10-14", count: 3 }, { day: "2026-10-15", count: 2 }] },
        { releaseId, trackId: trackB, count: 1, days: [{ day: "2026-10-14", count: 1 }] },
      ]);
      await push(alice, [
        event({ startedAt: Date.UTC(2026, 9, 14, 10), day: "2026-10-14", listenedMs: 1_000 }),
        event({ startedAt: Date.UTC(2026, 9, 15, 9), day: "2026-10-15", listenedMs: 2_000 }),
        event({ startedAt: Date.UTC(2026, 8, 1, 9), day: "2026-09-01", listenedMs: 4_000 }),
      ]);
      await push(aliceIos, [event({ startedAt: Date.UTC(2026, 9, 14, 11), day: "2026-10-14", listenedMs: 8_000 })]);

      const res = await testServices.plays.summary(alice.userId, alice.deviceId, "2026-10-14", "2026-10-15");
      const a = res.tracks.find((t) => t.trackId === trackA)!;
      expect(a).toMatchObject({ lastPlayedAt: Date.UTC(2026, 9, 15, 9), listenedMs: 11_000, events: 3 });
      // A track with no events in the window: null, 0, 0.
      expect(res.tracks.find((t) => t.trackId === trackB)).toMatchObject({ lastPlayedAt: null, listenedMs: 0, events: 0 });
      expect(res.allTime.find((t) => t.trackId === trackA)).toMatchObject({ lastPlayedAt: Date.UTC(2026, 9, 15, 9), listenedMs: 15_000, events: 4 });
      expect(res.allTime.find((t) => t.trackId === trackB)).toMatchObject({ lastPlayedAt: null, listenedMs: 0, events: 0 });
      // The existing fields are unchanged.
      expect(a).toMatchObject({ plays: 5, devicePlays: 5, lastPlayedDay: "2026-10-15" });
    });

    it("leaves tombstoned releases' events out", async () => {
      await testServices.plays.push(alice.userId, alice.deviceId, [{ releaseId, trackId: trackA, count: 1, days: [{ day: "2026-10-15", count: 1 }] }]);
      await push(alice, [event()]);
      const other = makeReleaseRecord();
      await testServices.releases.upsert(alice.userId, other.id, other);
      await push(alice, [event({ releaseId: other.id })]);
      await testServices.db.update(releases).set({ deleted: true }).where(eq(releases.id, other.id));
      const res = await testServices.plays.summary(alice.userId, alice.deviceId, "2026-10-15", "2026-10-15");
      expect(res.allTime).toHaveLength(1);
      expect(res.allTime[0]).toMatchObject({ events: 1 });
    });
  });

  describe("retention and deletion", () => {
    it("cleanup deletes events of releases tombstoned 30+ days ago and events older than 400 days, in pages", async () => {
      const oldTomb = makeReleaseRecord();
      await testServices.releases.upsert(alice.userId, oldTomb.id, oldTomb);
      await testServices.db.update(releases).set({ deleted: true, serverUpdatedAt: NOW - 31 * DAY_MS }).where(eq(releases.id, oldTomb.id));
      const newTomb = makeReleaseRecord();
      await testServices.releases.upsert(alice.userId, newTomb.id, newTomb);
      await testServices.db.update(releases).set({ deleted: true, serverUpdatedAt: NOW - 5 * DAY_MS }).where(eq(releases.id, newTomb.id));

      const row = (over: Partial<typeof playEvents.$inferInsert>) => ({
        userId: alice.userId,
        id: uuid(),
        deviceId: alice.deviceId,
        releaseId,
        trackId: trackA,
        source: "locally",
        startedAt: NOW - DAY_MS,
        day: "2026-10-14",
        listenedMs: 1,
        createdAt: NOW,
        updatedAt: NOW,
        ...over,
      });
      const expired = Array.from({ length: 450 }, () => row({ startedAt: NOW - 401 * DAY_MS }));
      const keep = [row({}), row({ startedAt: NOW - 400 * DAY_MS }), row({ releaseId: newTomb.id })];
      const gone = row({ releaseId: oldTomb.id });
      const all = [...expired, ...keep, gone];
      for (let i = 0; i < all.length; i += 50) await testServices.db.insert(playEvents).values(all.slice(i, i + 50));

      const result = await new CleanupService(testServices.db, testServices.fileStore, () => NOW).run();

      expect(result.deletedPlayEvents).toBe(1);
      expect(result.expiredPlayEvents).toBe(450);
      expect((await testServices.db.select().from(playEvents)).map((r) => r.id).sort()).toEqual(keep.map((r) => r.id).sort());
    });

    it("account deletion removes every event of the account and keeps the other's", async () => {
      const bobRecord = makeReleaseRecord();
      await testServices.releases.upsert(bob.userId, bobRecord.id, bobRecord);
      await push(alice, [event(), event()]);
      await push(aliceIos, [event()]);
      await push(bob, [event({ releaseId: bobRecord.id })]);
      await testServices.account.deleteAccount(alice.userId, alice.email);
      const left = await testServices.db.select().from(playEvents);
      expect(left.map((r) => r.userId)).toEqual([bob.userId]);
    });

    it("the users trigger removes events when the user row is deleted by any code", async () => {
      await push(alice, [event()]);
      await testServices.db.run(sql`delete from users where id = ${alice.userId}`);
      expect(await testServices.db.select().from(playEvents)).toEqual([]);
    });
  });
});
