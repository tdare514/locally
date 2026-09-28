import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSyncStateStore } from "../../src/server/sync/FileSyncStateStore";
import { emptySyncState } from "../../src/server/sync/SyncState";
import { syncStateFilePath } from "../../src/server/config/paths";
import type { SyncRecord } from "../../src/server/sync/SyncRecord";

let configDir: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  originalEnv = process.env.LOCALLY_CONFIG_DIR;
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), "sli-sync-state-"));
  process.env.LOCALLY_CONFIG_DIR = configDir;
});

afterEach(async () => {
  if (originalEnv === undefined) delete process.env.LOCALLY_CONFIG_DIR;
  else process.env.LOCALLY_CONFIG_DIR = originalEnv;
  await fs.rm(configDir, { recursive: true, force: true });
});

function samplePending(): SyncRecord {
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
  };
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
    await fs.writeFile(syncStateFilePath(), "{ not valid json", "utf-8");

    const store = new FileSyncStateStore();
    await expect(store.get()).resolves.toEqual(emptySyncState());
  });

  it("returns empty state when sync-state.json fails schema validation", async () => {
    await fs.writeFile(
      syncStateFilePath(),
      JSON.stringify({ pushedUpdatedAt: "not-a-record" }),
      "utf-8"
    );

    const store = new FileSyncStateStore();
    await expect(store.get()).resolves.toEqual(emptySyncState());
  });

  it("rejects a pendingFromPhone entry whose file name is not a plain child name", async () => {
    await fs.writeFile(
      syncStateFilePath(),
      JSON.stringify({
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
      }),
      "utf-8"
    );

    const store = new FileSyncStateStore();
    await expect(store.get()).resolves.toEqual(emptySyncState());
  });
});
