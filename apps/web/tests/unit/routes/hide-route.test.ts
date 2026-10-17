import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Services } from "../../../src/server/container";
import { FileSyncStateStore } from "../../../src/server/sync/FileSyncStateStore";
import { SyncEngine } from "../../../src/server/sync/SyncEngine";
import { visiblePending } from "../../../src/lib/tray-sections";
import type { SyncRecord } from "../../../src/server/sync/SyncRecord";

let services: Services;
vi.mock("../../../src/server/container", () => ({ getServices: () => services }));

import { POST, DELETE } from "../../../src/app/api/sync/hide/route";

let root: string;
let originalEnv: string | undefined;
let homedirSpy: ReturnType<typeof vi.spyOn>;

function record(id: string): SyncRecord {
  return {
    syncVersion: 2,
    id,
    kind: "single",
    title: id,
    artist: "kwaylone",
    year: null,
    genre: null,
    cover: null,
    coverHash: null,
    tracks: [{ id: "t1", title: id, trackNumber: 1, file: "01 - x.mp3", bytes: 1, durationSec: 1 }],
    origin: "ios",
    originDevice: "iphone",
    createdAt: "2026-09-27T12:00:00.000Z",
    updatedAt: "2026-09-27T12:00:00.000Z",
    deleted: false,
  };
}

function req(method: "POST" | "DELETE", body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/sync/hide", {
    method,
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(async () => {
  originalEnv = process.env.LOCALLY_CONFIG_DIR;
  root = await fs.mkdtemp(path.join(os.tmpdir(), "sli-hide-"));
  process.env.LOCALLY_CONFIG_DIR = path.join(root, "config");
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));
  const syncState = new FileSyncStateStore();
  await syncState.update((s) => ({ ...s, pendingFromPhone: { "rel-1": { ...record("rel-1"), version: 3 } as SyncRecord } }));
  const settings = { get: async () => ({ libraryDir: "/x", sync: null }) } as never;
  const engine = new SyncEngine(settings, syncState, {} as never, {} as never, (() => ({})) as never);
  services = { syncEngine: engine, syncState } as unknown as Services;
});

afterEach(async () => {
  homedirSpy.mockRestore();
  if (originalEnv === undefined) delete process.env.LOCALLY_CONFIG_DIR;
  else process.env.LOCALLY_CONFIG_DIR = originalEnv;
  await fs.rm(root, { recursive: true, force: true });
});

describe("/api/sync/hide (#295)", () => {
  it("hides a pending release at its version, and the choice survives a restart", async () => {
    const res = await POST(req("POST", { id: "rel-1" }));
    expect(res.status).toBe(200);
    // A fresh store, as after a restart.
    expect((await new FileSyncStateStore().get()).hiddenFromTray).toEqual({ "rel-1": "v3" });
    const status = await services.syncEngine.status();
    expect(status.hiddenFromTray).toEqual({ "rel-1": "v3" });
    expect(visiblePending(status.pendingFromPhone, status.hiddenFromTray ?? {})).toEqual([]);
  });

  it("a sync pass writing its old snapshot back does not undo the Hide", async () => {
    const store = new FileSyncStateStore();
    const stale = await store.get();
    await POST(req("POST", { id: "rel-1" }));
    await store.set(stale);
    expect((await store.get()).hiddenFromTray).toEqual({ "rel-1": "v3" });
  });

  it("a newer version shows again", async () => {
    await POST(req("POST", { id: "rel-1" }));
    await services.syncState.update((s) => ({
      ...s,
      pendingFromPhone: { "rel-1": { ...record("rel-1"), version: 4 } as SyncRecord },
    }));
    const status = await services.syncEngine.status();
    expect(visiblePending(status.pendingFromPhone, status.hiddenFromTray ?? {})).toHaveLength(1);
  });

  it("Undo shows it again", async () => {
    await POST(req("POST", { id: "rel-1" }));
    expect((await DELETE(req("DELETE", { id: "rel-1" }))).status).toBe(200);
    expect((await services.syncState.get()).hiddenFromTray).toEqual({});
    // Undo of something not hidden is quiet.
    expect((await DELETE(req("DELETE", { id: "rel-1" }))).status).toBe(200);
  });

  it("falls back to updatedAt for a record saved without a version", async () => {
    await services.syncState.update((s) => ({ ...s, pendingFromPhone: { "rel-1": record("rel-1") } }));
    await POST(req("POST", { id: "rel-1" }));
    expect((await services.syncState.get()).hiddenFromTray).toEqual({ "rel-1": "u2026-09-27T12:00:00.000Z" });
  });

  it("refuses a bad body and an unknown release", async () => {
    for (const body of [{}, { id: "" }, { id: 5 }, { id: "../x" }, { id: "a".repeat(300) }, "not json"]) {
      expect((await POST(req("POST", body))).status, JSON.stringify(body)).toBe(400);
    }
    expect((await POST(req("POST", { id: "nope" }))).status).toBe(404);
    expect((await DELETE(req("DELETE", {}))).status).toBe(400);
  });
});
