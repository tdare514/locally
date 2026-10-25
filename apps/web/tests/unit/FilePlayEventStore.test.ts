import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { playEventsFilePath } from "../../src/server/config/paths";
import { FilePlayEventStore } from "../../src/server/plays/FilePlayEventStore";
import { MAX_PLAY_EVENTS } from "../../src/server/plays/PlayEventStore";

/** Noon UTC on 15 Oct 2026; the clock and zone are injected so no test depends on today or the machine's zone. */
const NOW = Date.UTC(2026, 9, 15, 12);
const newStore = () => new FilePlayEventStore(() => NOW, "UTC");
const DAY_MS = 86_400_000;

let root: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  originalEnv = process.env.LOCALLY_CONFIG_DIR;
  root = await fs.mkdtemp(path.join(os.tmpdir(), "sli-play-events-"));
  process.env.LOCALLY_CONFIG_DIR = path.join(root, "config");
});

afterEach(async () => {
  if (originalEnv === undefined) delete process.env.LOCALLY_CONFIG_DIR;
  else process.env.LOCALLY_CONFIG_DIR = originalEnv;
  await fs.rm(root, { recursive: true, force: true });
});

const input = (over: Partial<{ trackId: string; startedAt: number; listenedMs: number; source: "spotify" | "locally" }> = {}) => ({
  releaseId: "r1",
  trackId: "t1",
  source: "locally" as const,
  startedAt: NOW - 1000,
  listenedMs: 31_000,
  ...over,
});

describe("FilePlayEventStore (#398)", () => {
  it("reads empty when there is no file", async () => {
    expect(await newStore().list()).toEqual([]);
  });

  it("adds an event with a uuid, the local day of startedAt and nothing pushed, in an owner-only file", async () => {
    const store = newStore();
    expect(await store.record(input({ startedAt: Date.UTC(2026, 9, 14, 23, 30) }))).toBe(true);
    const [event] = await store.list();
    expect(event).toMatchObject({
      releaseId: "r1",
      trackId: "t1",
      source: "locally",
      startedAt: Date.UTC(2026, 9, 14, 23, 30),
      day: "2026-10-14",
      listenedMs: 31_000,
      pushedListenedMs: null,
    });
    expect(event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((await fs.stat(playEventsFilePath())).mode & 0o777).toBe(0o600);
  });

  it("takes the day in the store's zone", async () => {
    const store = new FilePlayEventStore(() => NOW, "Pacific/Auckland");
    await store.record(input({ startedAt: Date.UTC(2026, 9, 14, 23, 30) }));
    expect((await store.list())[0].day).toBe("2026-10-15");
  });

  it("a second report of the same session raises listenedMs and never lowers it", async () => {
    const store = newStore();
    expect(await store.record(input({ listenedMs: 31_000 }))).toBe(true);
    // Until the count is marked, a report still asks for it.
    expect(await store.record(input({ listenedMs: 60_000 }))).toBe(true);
    await store.markCounted({ source: input().source, trackId: input().trackId, startedAt: input().startedAt });
    expect(await store.record(input({ listenedMs: 120_000 }))).toBe(false);
    expect(await store.record(input({ listenedMs: 50_000 }))).toBe(false);
    const events = await store.list();
    expect(events).toHaveLength(1);
    expect(events[0].listenedMs).toBe(120_000);
  });

  it("a different startedAt, track or source is another event", async () => {
    const store = newStore();
    await store.record(input());
    await store.record(input({ startedAt: NOW - 2000 }));
    await store.record(input({ trackId: "t2" }));
    await store.record(input({ source: "spotify" }));
    expect(await store.list()).toHaveLength(4);
  });

  it("keeps ms within 0..86,400,000", async () => {
    const store = newStore();
    await store.record(input({ listenedMs: 999_999_999 }));
    expect((await store.list())[0].listenedMs).toBe(86_400_000);
  });

  it("marks what was sent, only upward, and a stale epoch changes nothing", async () => {
    const store = newStore();
    await store.record(input());
    const [event] = await store.list();
    const epoch = store.pushedEpoch();
    await store.markPushed({ [event.id]: 31_000 }, epoch);
    expect((await store.list())[0].pushedListenedMs).toBe(31_000);
    await store.markPushed({ [event.id]: 10_000 }, epoch);
    expect((await store.list())[0].pushedListenedMs).toBe(31_000);
    await store.resetPushed();
    expect((await store.list())[0].pushedListenedMs).toBeNull();
    await store.markPushed({ [event.id]: 31_000 }, epoch);
    expect((await store.list())[0].pushedListenedMs).toBeNull();
  });

  it("removes a release's events", async () => {
    const store = newStore();
    await store.record(input());
    await store.record({ ...input({ trackId: "t9" }), releaseId: "r2" });
    await store.removeRelease("r1");
    expect((await store.list()).map((e) => e.releaseId)).toEqual(["r2"]);
  });

  it("drops events older than 400 days when it writes", async () => {
    const store = newStore();
    await store.record(input({ startedAt: NOW - 401 * DAY_MS }));
    await store.record(input({ startedAt: NOW - 399 * DAY_MS, trackId: "t2" }));
    expect((await store.list()).map((e) => e.trackId)).toEqual(["t2"]);
  });

  it("past 20,000 events the oldest pushed ones go first, then the oldest", async () => {
    const mk = (n: number, pushed: boolean) => ({
      id: `id-${n}`,
      releaseId: "r1",
      trackId: `t${n}`,
      source: "locally",
      startedAt: NOW - 100_000 + n,
      day: "2026-10-15",
      listenedMs: 1000,
      pushedListenedMs: pushed ? 1000 : null,
    });
    // Event 0 is the oldest and pending; events 1..5 are pushed; the rest pending.
    const events = Array.from({ length: MAX_PLAY_EVENTS + 3 }, (_, n) => mk(n, n >= 1 && n <= 5));
    await fs.mkdir(path.dirname(playEventsFilePath()), { recursive: true });
    await fs.writeFile(playEventsFilePath(), JSON.stringify({ version: 1, events }));
    const store = newStore();
    await store.record(input({ trackId: "fresh" })); // one write: 20,004 events, 4 over the cap
    const after = await store.list();
    expect(after).toHaveLength(MAX_PLAY_EVENTS);
    const ids = new Set(after.map((e) => e.id));
    expect(ids.has("id-0")).toBe(true); // oldest, but pending: kept while pushed ones can go
    for (const n of [1, 2, 3, 4]) expect(ids.has(`id-${n}`)).toBe(false);
    expect(ids.has("id-5")).toBe(true);
  });

  it("past the cap with nothing pushed, the oldest pending go", async () => {
    const events = Array.from({ length: MAX_PLAY_EVENTS + 1 }, (_, n) => ({
      id: `id-${n}`, releaseId: "r1", trackId: `t${n}`, source: "locally", startedAt: NOW - 100_000 + n,
      day: "2026-10-15", listenedMs: 1000, pushedListenedMs: null,
    }));
    await fs.mkdir(path.dirname(playEventsFilePath()), { recursive: true });
    await fs.writeFile(playEventsFilePath(), JSON.stringify({ version: 1, events }));
    await newStore().removeRelease("none");
    const ids = new Set((await newStore().list()).map((e) => e.id));
    expect(ids.size).toBe(MAX_PLAY_EVENTS);
    expect(ids.has("id-0")).toBe(false);
  });

  it("a damaged file reads as empty, and one bad entry never costs the rest", async () => {
    await fs.mkdir(path.dirname(playEventsFilePath()), { recursive: true });
    await fs.writeFile(playEventsFilePath(), "not json");
    expect(await newStore().list()).toEqual([]);
    const good = { id: "a", releaseId: "r", trackId: "t", source: "spotify", startedAt: NOW, day: "2026-10-15", listenedMs: 5, pushedListenedMs: null };
    await fs.writeFile(playEventsFilePath(), JSON.stringify({ version: 1, events: [good, { id: "b", day: "2026-02-30" }] }));
    expect((await newStore().list()).map((e) => e.id)).toEqual(["a"]);
  });
});
