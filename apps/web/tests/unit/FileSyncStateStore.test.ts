import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncStateFilePath } from "../../src/server/config/paths";
import { FileSyncStateStore } from "../../src/server/sync/FileSyncStateStore";
import { emptySyncState, type SyncState } from "../../src/server/sync/SyncState";
import type { SyncRecord } from "../../src/server/sync/SyncRecord";

let configDir: string;
let originalEnv: string | undefined;
let homedirSpy: ReturnType<typeof vi.spyOn>;

function samplePending(overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    syncVersion: 2,
    id: "rel-1",
    kind: "single",
    title: "From Phone",
    artist: "Artist",
    year: null,
    genre: null,
    cover: null,
    coverHash: null,
    tracks: [
      {
        id: "trk-1",
        title: "From Phone",
        trackNumber: 1,
        file: "01 - From Phone.mp3",
        bytes: 12,
        durationSec: 30,
      },
    ],
    origin: "ios",
    originDevice: "iphone",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deleted: false,
    ...overrides,
  };
}

beforeEach(async () => {
  originalEnv = process.env.LOCALLY_CONFIG_DIR;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sli-sync-state-"));
  configDir = path.join(root, "config");
  process.env.LOCALLY_CONFIG_DIR = configDir;
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));
});

afterEach(async () => {
  homedirSpy.mockRestore();
  if (originalEnv === undefined) delete process.env.LOCALLY_CONFIG_DIR;
  else process.env.LOCALLY_CONFIG_DIR = originalEnv;
  await fs.rm(path.dirname(configDir), { recursive: true, force: true });
});

async function writeSyncStateFile(body: unknown): Promise<void> {
  await fs.mkdir(configDir, { recursive: true });
  const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  await fs.writeFile(syncStateFilePath(), text, "utf-8");
}

describe("FileSyncStateStore", () => {
  it("returns empty state when sync-state.json is missing", async () => {
    const store = new FileSyncStateStore();
    await expect(store.get()).resolves.toEqual(emptySyncState());
  });

  it("round-trips set()/get() through the tmp-file-plus-rename write", async () => {
    const store = new FileSyncStateStore();
    const pending = samplePending();
    const state = {
      pushedUpdatedAt: { "rel-1": "2026-01-01T00:00:00.000Z" },
      uploadedFiles: { "rel-1": ["01 - From Phone.mp3"] },
      coverHash: {
        "rel-1": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      pendingFromPhone: { "rel-1": pending },
    };

    await store.set(state);

    const entries = await fs.readdir(configDir);
    expect(entries.some((e) => e.includes(".tmp-"))).toBe(false);
    expect(entries).toContain("sync-state.json");

    await expect(store.get()).resolves.toEqual(state);
  });

  it("returns empty state when sync-state.json is corrupt JSON", async () => {
    await writeSyncStateFile("{ not valid json");

    const store = new FileSyncStateStore();
    await expect(store.get()).resolves.toEqual(emptySyncState());
  });

  it("returns empty state when sync-state.json fails schema validation", async () => {
    await writeSyncStateFile({ pushedUpdatedAt: "not-a-record" });

    const store = new FileSyncStateStore();
    await expect(store.get()).resolves.toEqual(emptySyncState());
  });

  it("returns empty state when the outer shape is wrong", async () => {
    await writeSyncStateFile({
      pushedUpdatedAt: [],
      uploadedFiles: {},
      coverHash: {},
      pendingFromPhone: {},
    });
    const state = await new FileSyncStateStore().get();
    expect(state).toEqual(emptySyncState());
  });

  it("drops a pendingFromPhone entry whose file name is not a plain child name", async () => {
    await writeSyncStateFile({
      pushedUpdatedAt: { "rel-1": "2026-01-01T00:00:00.000Z" },
      uploadedFiles: { "rel-1": ["01 - From Phone.mp3"] },
      coverHash: {
        "rel-1": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      pendingFromPhone: {
        "rel-1": {
          ...samplePending(),
          tracks: [
            {
              id: "trk-1",
              title: "Bad",
              trackNumber: 1,
              file: "../escape.mp3",
              bytes: 1,
              durationSec: null,
            },
          ],
        },
      },
    });

    const store = new FileSyncStateStore();
    await expect(store.get()).resolves.toEqual({
      pushedUpdatedAt: { "rel-1": "2026-01-01T00:00:00.000Z" },
      uploadedFiles: { "rel-1": ["01 - From Phone.mp3"] },
      coverHash: {
        "rel-1": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      pendingFromPhone: {},
    });
  });

  it("drops a pendingFromPhone entry with a bad extension and keeps the rest of the file", async () => {
    const goodId = "11111111-1111-4111-8111-111111111111";
    const badId = "33333333-3333-4333-8333-333333333333";
    await writeSyncStateFile({
      pushedUpdatedAt: { [goodId]: "2026-09-27T20:00:00Z" },
      uploadedFiles: { [goodId]: ["01 - Track.mp3"] },
      coverHash: { [goodId]: "a".repeat(64) },
      pendingFromPhone: {
        [goodId]: samplePending({ id: goodId }),
        [badId]: samplePending({
          id: badId,
          tracks: [
            {
              id: "44444444-4444-4444-8444-444444444444",
              title: "Bad",
              trackNumber: 1,
              file: "01 - Bad.wav",
              bytes: 100,
              durationSec: null,
            },
          ],
        }),
      },
    });

    const state = await new FileSyncStateStore().get();

    expect(Object.keys(state.pendingFromPhone)).toEqual([goodId]);
    expect(state.pushedUpdatedAt).toEqual({ [goodId]: "2026-09-27T20:00:00Z" });
    expect(state.uploadedFiles).toEqual({ [goodId]: ["01 - Track.mp3"] });
    expect(state.coverHash).toEqual({ [goodId]: "a".repeat(64) });
  });

  it("drops a pendingFromPhone entry that is not an object", async () => {
    const goodId = "11111111-1111-4111-8111-111111111111";
    await writeSyncStateFile({
      pushedUpdatedAt: {},
      uploadedFiles: {},
      coverHash: {},
      pendingFromPhone: {
        [goodId]: samplePending({ id: goodId }),
        "not-a-record": "oops",
      },
    });

    const state = await new FileSyncStateStore().get();
    expect(Object.keys(state.pendingFromPhone)).toEqual([goodId]);
  });

  it("round-trips a state with one valid pending record through set and get", async () => {
    const store = new FileSyncStateStore();
    const input: SyncState = {
      pushedUpdatedAt: {},
      uploadedFiles: {},
      coverHash: {},
      pendingFromPhone: {
        "11111111-1111-4111-8111-111111111111": samplePending({
          id: "11111111-1111-4111-8111-111111111111",
        }),
      },
    };
    await store.set(input);
    const loaded = await store.get();
    expect(loaded).toEqual(input);
  });
});
