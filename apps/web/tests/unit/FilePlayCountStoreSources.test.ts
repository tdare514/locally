import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { playsFilePath } from "../../src/server/config/paths";
import { FilePlayCountStore } from "../../src/server/plays/FilePlayCountStore";
import { totalCount, totalDays } from "../../src/server/plays/PlayCountStore";
import { batchPlayEntries, mergeReleasePlays, pendingPlayEntries } from "../../src/server/plays/releasePlays";
import { PlayEntrySchema } from "../../src/server/plays/playsWire";

const DAY = "2026-10-15";
const NOW = Date.UTC(2026, 9, 15, 12);
const R1 = "11111111-1111-4111-8111-111111111111";
const T1 = "22222222-2222-4222-8222-222222222222";
const newStore = () => new FilePlayCountStore(() => NOW, "UTC");

let root: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  originalEnv = process.env.LOCALLY_CONFIG_DIR;
  root = await fs.mkdtemp(path.join(os.tmpdir(), "sli-plays-sources-"));
  process.env.LOCALLY_CONFIG_DIR = path.join(root, "config");
});

afterEach(async () => {
  if (originalEnv === undefined) delete process.env.LOCALLY_CONFIG_DIR;
  else process.env.LOCALLY_CONFIG_DIR = originalEnv;
  await fs.rm(root, { recursive: true, force: true });
});

describe("play counts per source (#338)", () => {
  it("loads a plays.json written before sources unchanged, every count read as Spotify", async () => {
    const old = {
      version: 1,
      tracks: { [T1]: { releaseId: R1, count: 5, pushed: 3, days: { [DAY]: 2, "2026-10-14": 3 }, pushedDays: { "2026-10-14": 3 } } },
      daysInSync: true,
    };
    await fs.mkdir(path.dirname(playsFilePath()), { recursive: true });
    await fs.writeFile(playsFilePath(), JSON.stringify(old));
    expect(await newStore().get()).toEqual(old);
    // No Locally entry appears, and what would be pushed carries no `source` field.
    const pending = pendingPlayEntries(await newStore().get());
    expect(pending).toHaveLength(1);
    expect(pending[0]).not.toHaveProperty("source");
  });

  it("keeps Locally plays apart from Spotify's, in the all-time count and the day buckets", async () => {
    const store = newStore();
    await store.increment(T1, R1, DAY);
    await store.increment(T1, R1, DAY, "locally");
    await store.increment(T1, R1, "2026-10-14", "locally");
    const entry = (await newStore().get()).tracks[T1];
    expect(entry).toMatchObject({ count: 1, pushed: 0, days: { [DAY]: 1 } });
    expect(entry.locally).toEqual({ count: 2, pushed: 0, days: { [DAY]: 1, "2026-10-14": 1 } });
    expect(totalCount(entry)).toBe(3);
    expect(totalDays(entry)).toEqual({ [DAY]: 2, "2026-10-14": 1 });
  });

  it("a Locally play of a track with no Spotify plays creates the entry with a zero Spotify count", async () => {
    await newStore().increment(T1, R1, DAY, "locally");
    const entry = (await newStore().get()).tracks[T1];
    expect(entry.count).toBe(0);
    expect(entry.locally?.count).toBe(1);
  });

  it("drops a malformed locally block without costing the Spotify totals", async () => {
    await fs.mkdir(path.dirname(playsFilePath()), { recursive: true });
    await fs.writeFile(playsFilePath(), JSON.stringify({ version: 1, tracks: { [T1]: { releaseId: R1, count: 4, pushed: 0, locally: { count: "x" } } } }));
    expect((await newStore().get()).tracks[T1]).toEqual({ releaseId: R1, count: 4, pushed: 0 });
  });

  it("markPushed and resetPushed work per source", async () => {
    const store = newStore();
    await store.increment(T1, R1, DAY);
    await store.increment(T1, R1, DAY, "locally");
    await store.markPushed({ [T1]: 1 }, store.pushedEpoch(), { [T1]: { [DAY]: 1 } }, "locally");
    let entry = (await store.get()).tracks[T1];
    expect(entry.pushed).toBe(0);
    expect(entry.locally).toMatchObject({ pushed: 1, pushedDays: { [DAY]: 1 } });
    await store.resetPushed();
    entry = (await store.get()).tracks[T1];
    expect(entry.locally).toEqual({ count: 1, pushed: 0, days: { [DAY]: 1 } });
  });

  it("pushes one entry per (track, source), with `source` on the Locally one only, in separate batches", async () => {
    const store = newStore();
    await store.increment(T1, R1, DAY);
    await store.increment(T1, R1, DAY, "locally");
    const pending = pendingPlayEntries(await store.get());
    expect(pending).toEqual([
      { releaseId: R1, trackId: T1, count: 1, days: [{ day: DAY, count: 1 }] },
      { releaseId: R1, trackId: T1, count: 1, source: "locally", days: [{ day: DAY, count: 1 }] },
    ]);
    expect(batchPlayEntries(pending)).toHaveLength(2);
    expect(PlayEntrySchema.safeParse({ releaseId: R1, trackId: T1, count: 1, source: "radio" }).success).toBe(false);
  });

  it("the release view shows one total per track: the sources added together", async () => {
    const store = newStore();
    await store.increment(T1, R1, DAY);
    await store.increment(T1, R1, DAY, "locally");
    const merged = mergeReleasePlays(await store.get(), R1, null);
    expect(merged.tracks[0].total).toBe(2);
  });

  it("incrementOnce counts a session key once, across a new store over the same file, and old files load without the key set", async () => {
    const old = { version: 1, tracks: { [T1]: { releaseId: R1, count: 1, pushed: 0 } } };
    await fs.mkdir(path.dirname(playsFilePath()), { recursive: true });
    await fs.writeFile(playsFilePath(), JSON.stringify(old));
    expect(await newStore().get()).toEqual(old);
    expect(await newStore().incrementOnce(T1, R1, DAY, "locally", "locally:t:1")).toBe(true);
    expect(await newStore().incrementOnce(T1, R1, DAY, "locally", "locally:t:1")).toBe(false);
    expect(await newStore().incrementOnce(T1, R1, DAY, "locally", "locally:t:2")).toBe(true);
    const got = await newStore().get();
    expect(got.tracks[T1].locally?.count).toBe(2);
    expect(Object.keys(got.countedSessions ?? {}).sort()).toEqual(["locally:t:1", "locally:t:2"]);
  });

  it("prunes session keys older than 400 days, and keeps a 399-day-old one", async () => {
    await new FilePlayCountStore(() => NOW - 401 * 86_400_000, "UTC").incrementOnce(T1, R1, DAY, "locally", "old");
    await new FilePlayCountStore(() => NOW - 399 * 86_400_000, "UTC").incrementOnce(T1, R1, DAY, "locally", "recent");
    await newStore().incrementOnce(T1, R1, DAY, "locally", "new");
    expect(Object.keys((await newStore().get()).countedSessions ?? {}).sort()).toEqual(["new", "recent"]);
  });

  it("releaseSession deletes the key, and is a no-op for a missing one", async () => {
    await newStore().incrementOnce(T1, R1, DAY, "locally", "k");
    await newStore().releaseSession("missing");
    expect(Object.keys((await newStore().get()).countedSessions ?? {})).toEqual(["k"]);
    await newStore().releaseSession("k");
    expect((await newStore().get()).countedSessions).toBeUndefined();
  });
});
