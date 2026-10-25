import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Release } from "../../src/shared/types";
import { FilePlayEventStore } from "../../src/server/plays/FilePlayEventStore";
import { PlayTracker } from "../../src/server/plays/PlayTracker";
import type { NowPlayingResult, SpotifyNowPlaying } from "../../src/server/plays/SpotifyNowPlaying";
import { FakePlayCountStore } from "./FakePlayCountStore";

const ID = "spotify:local:Artist:Album:Title:200";
const START = Date.UTC(2026, 9, 16, 12, 0, 0);

const release = {
  id: "r1", kind: "single", title: "Album", artist: "Artist", year: null, genre: null, coverPath: null, folderPath: "/lib/x",
  tracks: [{ id: "t1", title: "Title", trackNumber: 1, filePath: "/lib/x.mp3", originalName: "x.mp3", durationSec: 200 }],
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
} as Release;

class Feed implements SpotifyNowPlaying {
  next: NowPlayingResult = { running: false };
  async read(): Promise<NowPlayingResult> {
    return this.next;
  }
}

let root: string;
let originalEnv: string | undefined;
let clock: number;
let feed: Feed;
let counts: FakePlayCountStore;
let events: FilePlayEventStore;
let linked: boolean;
let tracker: PlayTracker;

const playing = (positionSec: number): NowPlayingResult => ({ running: true, state: "playing", id: ID, positionSec, durationMs: 200_000 });
const paused = (positionSec: number): NowPlayingResult => ({ running: true, state: "paused", id: ID, positionSec, durationMs: 200_000 });
async function tick(result: NowPlayingResult): Promise<void> {
  clock += 5000;
  feed.next = result;
  await tracker.poll();
}

beforeEach(async () => {
  originalEnv = process.env.LOCALLY_CONFIG_DIR;
  root = await fs.mkdtemp(path.join(os.tmpdir(), "sli-tracker-events-"));
  process.env.LOCALLY_CONFIG_DIR = path.join(root, "config");
  clock = START;
  feed = new Feed();
  counts = new FakePlayCountStore();
  events = new FilePlayEventStore(() => clock, "UTC");
  linked = false;
  tracker = new PlayTracker(
    feed,
    { get: async () => ({ libraryDir: "/lib", trackPlays: true }) as never },
    { list: async () => [release] },
    counts,
    () => clock,
    5000,
    30_000,
    "UTC",
    { active: () => linked, refreshIfStale: async () => undefined },
    undefined,
    events,
  );
  (tracker as unknown as { enabled: boolean }).enabled = true;
});

afterEach(async () => {
  tracker.stop();
  if (originalEnv === undefined) delete process.env.LOCALLY_CONFIG_DIR;
  else process.env.LOCALLY_CONFIG_DIR = originalEnv;
  await fs.rm(root, { recursive: true, force: true });
});

describe("PlayTracker writes play events for Spotify plays (#398)", () => {
  it("writes the event at its count point, with the session's start, the local day and the time heard", async () => {
    for (let pos = 0; pos <= 30; pos += 5) await tick(playing(pos));
    const list = await events.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ releaseId: "r1", trackId: "t1", source: "spotify", startedAt: START + 5000, day: "2026-10-16", listenedMs: 30_000 });
    expect((await counts.get()).tracks.t1.count).toBe(1);
  });

  it("raises listenedMs from later samples (every 15 s while playing, and on pause), never writing a second event", async () => {
    for (let pos = 0; pos <= 60; pos += 5) await tick(playing(pos));
    expect((await events.list())[0].listenedMs).toBe(60_000);
    await tick(paused(60));
    await tick(paused(60));
    const list = await events.list();
    expect(list).toHaveLength(1);
    expect(list[0].listenedMs).toBe(60_000);
    expect((await counts.get()).tracks.t1.count).toBe(1);
  });

  it("writes the final time when the session ends", async () => {
    for (let pos = 0; pos <= 40; pos += 5) await tick(playing(pos));
    await tick({ running: false });
    expect((await events.list())[0].listenedMs).toBe(40_000);
  });

  it("writes no event for a play that never counts", async () => {
    for (let pos = 0; pos <= 20; pos += 5) await tick(playing(pos));
    expect(await events.list()).toEqual([]);
  });

  it("writes nothing while the cloud is linked (it stands down)", async () => {
    linked = true;
    for (let pos = 0; pos <= 60; pos += 5) await tick(playing(pos));
    expect(await events.list()).toEqual([]);
    expect((await counts.get()).tracks).toEqual({});
  });

  it("a counted session restored after an outage keeps raising the same event, with no new count or event", async () => {
    for (let pos = 0; pos <= 40; pos += 5) await tick(playing(pos));
    await tick({ running: false }); // the outage ends the session; its final time is written
    const before = (await events.list())[0];
    expect(before.listenedMs).toBe(40_000);
    // Spotify is back within ten minutes, where it left off.
    for (let pos = 45; pos <= 120; pos += 5) await tick(playing(pos));
    await tick(paused(120));
    const list = await events.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(before.id);
    expect(list[0].startedAt).toBe(before.startedAt);
    expect(list[0].listenedMs).toBeGreaterThan(40_000);
    expect((await counts.get()).tracks.t1.count).toBe(1);
  });
});
