import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Release } from "../../../src/shared/types";
import type { Services } from "../../../src/server/container";
import { FilePlayEventStore } from "../../../src/server/plays/FilePlayEventStore";
import { PlayCountSession, type QueueItem } from "../../../src/lib/play-queue";
import { FakePlayCountStore } from "../FakePlayCountStore";

let services: Services;
vi.mock("../../../src/server/container", () => ({ getServices: () => services }));

import { POST } from "../../../src/app/api/plays/locally/route";

const R1 = "11111111-1111-4111-8111-111111111111";
const T1 = "22222222-2222-4222-8222-222222222222";
const release = { id: R1, tracks: [{ id: T1 }] } as unknown as Release;
let counts: FakePlayCountStore;
let events: FilePlayEventStore;
let trackPlays: boolean;
let root: string;
let originalEnv: string | undefined;

const req = (body: unknown) => new Request("http://localhost/api/plays/locally", { method: "POST", body: JSON.stringify(body) }) as never;
const now = Date.now();

beforeEach(async () => {
  delete process.env.LOCALLY_DEMO;
  originalEnv = process.env.LOCALLY_CONFIG_DIR;
  root = await fs.mkdtemp(path.join(os.tmpdir(), "sli-locally-events-"));
  process.env.LOCALLY_CONFIG_DIR = path.join(root, "config");
  trackPlays = true;
  counts = new FakePlayCountStore();
  events = new FilePlayEventStore();
  services = {
    settings: { get: async () => ({ libraryDir: "/lib", trackPlays }) },
    library: { find: async (_d: string, id: string) => (id === R1 ? release : null) },
    playStore: counts,
    playEvents: events,
  } as unknown as Services;
});

afterEach(async () => {
  if (originalEnv === undefined) delete process.env.LOCALLY_CONFIG_DIR;
  else process.env.LOCALLY_CONFIG_DIR = originalEnv;
  await fs.rm(root, { recursive: true, force: true });
});

describe("/api/plays/locally with startedAt and listenedMs (#398)", () => {
  it("writes one event and one count for a counted play", async () => {
    expect((await POST(req({ releaseId: R1, trackId: T1, startedAt: now - 40_000, listenedMs: 31_000 }))).status).toBe(200);
    const list = await events.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ releaseId: R1, trackId: T1, source: "locally", startedAt: now - 40_000, listenedMs: 31_000, pushedListenedMs: null });
    expect(list[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await counts.get()).tracks[T1].locally?.count).toBe(1);
  });

  it("listenedMs grows on later reports of the same session, and the count stays 1", async () => {
    const body = { releaseId: R1, trackId: T1, startedAt: now - 300_000 };
    await POST(req({ ...body, listenedMs: 31_000 }));
    await POST(req({ ...body, listenedMs: 150_000 }));
    await POST(req({ ...body, listenedMs: 90_000 }));
    const list = await events.list();
    expect(list).toHaveLength(1);
    expect(list[0].listenedMs).toBe(150_000);
    expect((await counts.get()).tracks[T1].locally?.count).toBe(1);
  });

  it("a failed increment is counted by the retry exactly once, and a third report does not count again", async () => {
    const body = { releaseId: R1, trackId: T1, startedAt: now - 300_000, listenedMs: 31_000 };
    const real = counts.increment.bind(counts);
    const spy = vi.spyOn(counts, "increment").mockRejectedValueOnce(new Error("disk full"));
    expect((await POST(req(body))).status).toBe(500);
    expect((await events.list())[0].counted).toBe(false);
    expect(Object.keys((await counts.get()).tracks)).toEqual([]);
    spy.mockImplementation(real);
    expect((await POST(req({ ...body, listenedMs: 60_000 }))).status).toBe(200);
    expect((await counts.get()).tracks[T1].locally?.count).toBe(1);
    expect((await events.list())[0].counted).toBe(true);
    await POST(req({ ...body, listenedMs: 90_000 }));
    expect((await counts.get()).tracks[T1].locally?.count).toBe(1);
    expect(await events.list()).toHaveLength(1);
  });

  it("a failed markCounted, then a retry, counts once", async () => {
    const body = { releaseId: R1, trackId: T1, startedAt: now - 300_000, listenedMs: 31_000 };
    vi.spyOn(events, "markCounted").mockRejectedValueOnce(new Error("disk full"));
    expect((await POST(req(body))).status).toBe(500);
    expect((await counts.get()).tracks[T1].locally?.count).toBe(1);
    expect((await POST(req({ ...body, listenedMs: 60_000 }))).status).toBe(200);
    expect((await counts.get()).tracks[T1].locally?.count).toBe(1);
  });

  it("a restart (a new event store over the same file) with the event still uncounted does not count again", async () => {
    const body = { releaseId: R1, trackId: T1, startedAt: now - 300_000, listenedMs: 31_000 };
    vi.spyOn(events, "markCounted").mockRejectedValueOnce(new Error("killed"));
    await POST(req(body));
    services = { ...services, playEvents: new FilePlayEventStore() } as unknown as Services;
    expect((await POST(req({ ...body, listenedMs: 60_000 }))).status).toBe(200);
    expect((await counts.get()).tracks[T1].locally?.count).toBe(1);
  });

  it("another session of the same track is a second event and a second count", async () => {
    await POST(req({ releaseId: R1, trackId: T1, startedAt: now - 600_000, listenedMs: 31_000 }));
    await POST(req({ releaseId: R1, trackId: T1, startedAt: now - 100_000, listenedMs: 31_000 }));
    expect(await events.list()).toHaveLength(2);
    expect((await counts.get()).tracks[T1].locally?.count).toBe(2);
  });

  it("stays backward compatible: without the fields the play counts and no event is written", async () => {
    expect((await POST(req({ releaseId: R1, trackId: T1 }))).status).toBe(200);
    expect(await events.list()).toEqual([]);
    expect((await counts.get()).tracks[T1].locally?.count).toBe(1);
  });

  it("is strict: non-integers, negatives, too large, one without the other, unknown keys and a far-future start are 400", async () => {
    const ok = { releaseId: R1, trackId: T1, startedAt: now, listenedMs: 1000 };
    for (const bad of [
      { ...ok, listenedMs: 1000.5 },
      { ...ok, startedAt: now + 0.5 },
      { ...ok, listenedMs: -1 },
      { ...ok, listenedMs: 86_400_001 },
      { ...ok, startedAt: "1" },
      { releaseId: R1, trackId: T1, startedAt: now },
      { releaseId: R1, trackId: T1, listenedMs: 1000 },
      { ...ok, extra: 1 },
      { ...ok, startedAt: now + 25 * 3600_000 },
      { ...ok, startedAt: now - 401 * 86_400_000 },
    ]) {
      expect((await POST(req(bad))).status, JSON.stringify(bad)).toBe(400);
    }
    expect(await events.list()).toEqual([]);
    expect((await counts.get()).tracks).toEqual({});
  });

  it("writes nothing when Count plays is off", async () => {
    trackPlays = false;
    expect((await POST(req({ releaseId: R1, trackId: T1, startedAt: now, listenedMs: 31_000 }))).status).toBe(204);
    expect(await events.list()).toEqual([]);
    expect((await counts.get()).tracks).toEqual({});
  });

  it("a player session end to end: counted at 30 s, then pause and skip raise the one event", async () => {
    const posts: Promise<unknown>[] = [];
    const send = (item: QueueItem, played: { startedAt: number; listenedMs: number }) =>
      posts.push(POST(req({ releaseId: item.releaseId, trackId: item.trackId, ...played })));
    const session = new PlayCountSession(send, send);
    const item = { releaseId: R1, trackId: T1 };
    const start = now - 200_000;
    let at = start;
    // 40 s of audio, a 10 s pause (does not count), then 20 s more, then a skip to another item.
    for (let pos = 0; pos <= 40; pos++) session.sample(item, { at: (at += 1000), playing: true, positionSec: pos, durationSec: 200 });
    for (let i = 0; i < 10; i++) session.sample(item, { at: (at += 1000), playing: false, positionSec: 40, durationSec: 200 });
    for (let pos = 41; pos <= 60; pos++) session.sample(item, { at: (at += 1000), playing: true, positionSec: pos, durationSec: 200 });
    session.sample({ releaseId: R1, trackId: "other" }, { at: (at += 1000), playing: true, positionSec: 0, durationSec: 200 });
    await Promise.all(posts);
    const list = await events.list();
    expect(list).toHaveLength(1);
    expect(list[0].startedAt).toBe(start + 1000);
    // 40 s, then the paused 10 s earn nothing and the first sample after resuming only re-anchors, then 19 s.
    expect(list[0].listenedMs).toBe(59_000);
    expect((await counts.get()).tracks[T1].locally?.count).toBe(1);
  });
});
