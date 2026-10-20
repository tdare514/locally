import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Release, Settings } from "../../../src/shared/types";
import type { Services } from "../../../src/server/container";
import { NodeFileSystem } from "../../../src/server/fs/NodeFileSystem";

type ExecFileCallback = (err: Error | null) => void;

let execCalls: { cmd: string; args: string[] }[];
let execError: Error | null;

vi.mock("node:child_process", () => ({
  execFile: (cmd: string, args: string[], cb: ExecFileCallback) => {
    execCalls.push({ cmd, args });
    queueMicrotask(() => cb(execError));
  },
}));

let services: Services;

vi.mock("../../../src/server/container", () => ({
  getServices: () => services,
}));

import { POST } from "../../../src/app/api/reveal/route";

let settingsValue: Settings;
let libraryDir: string;
let platformDescriptor: PropertyDescriptor | undefined;

class FakeSettingsStore {
  async get(): Promise<Settings> {
    return settingsValue;
  }
  async set(next: Settings): Promise<Settings> {
    settingsValue = next;
    return next;
  }
  async update(mutator: (current: Settings) => Settings | null): Promise<Settings> {
    const next = mutator(settingsValue);
    if (next) settingsValue = next;
    return settingsValue;
  }
}

function revealRequest(body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/reveal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  execCalls = [];
  execError = null;
  libraryDir = await fs.mkdtemp(path.join(os.tmpdir(), "locally-reveal-"));
  settingsValue = { libraryDir, sync: null };
  services = {
    settings: new FakeSettingsStore(),
    fs: new NodeFileSystem(),
  } as unknown as Services;

  platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { configurable: true, value: "darwin" });
});

afterEach(async () => {
  if (platformDescriptor) {
    Object.defineProperty(process, "platform", platformDescriptor);
  }
  await fs.rm(libraryDir, { recursive: true, force: true });
});

describe("POST /api/reveal", () => {
  it("rejects when not running on macOS", async () => {
    Object.defineProperty(process, "platform", { configurable: true, value: "linux" });

    const res = await POST(revealRequest({ path: path.join(libraryDir, "Artist") }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/macOS/);
    expect(execCalls).toEqual([]);
  });

  it("reveals the library dir when the body has no path", async () => {
    const res = await POST(revealRequest({}));

    expect(res.status).toBe(200);
    expect(execCalls).toEqual([{ cmd: "open", args: ["-R", path.resolve(libraryDir)] }]);
  });

  it("reveals a path inside the library", async () => {
    const target = path.join(libraryDir, "Artist", "Title");
    const res = await POST(revealRequest({ path: target }));

    expect(res.status).toBe(200);
    expect(execCalls).toEqual([{ cmd: "open", args: ["-R", path.resolve(target)] }]);
  });

  it.each([
    ["an absolute path elsewhere", () => "/etc/passwd"],
    ["a .. traversal", () => `${libraryDir}/../outside/secret.mp3`],
    ["a sibling-prefix path", () => `${libraryDir}-evil/secret.mp3`],
    ["a relative path", () => "Artist/secret.mp3"],
  ])("rejects %s without shelling out", async (_label, makePath) => {
    const res = await POST(revealRequest({ path: makePath() }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/inside the library/);
    const text = JSON.stringify(body);
    expect(text).not.toContain("secret");
    expect(text).not.toContain("passwd");
    expect(text).not.toContain(libraryDir);
    expect(execCalls).toEqual([]);
  });

  it("rejects an empty path string", async () => {
    const res = await POST(revealRequest({ path: "   " }));

    expect(res.status).toBe(400);
    expect(execCalls).toEqual([]);
  });

  it("maps an open(1) failure to a 500 without leaking the path", async () => {
    execError = new Error("open failed: /Users/someone/secret/path");

    const res = await POST(revealRequest({ path: path.join(libraryDir, "Artist") }));

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain("/Users/someone/secret");
  });
});

describe("POST /api/reveal for releases added from a Spotify folder (#249)", () => {
  let spotifyDir: string;
  let elsewhere: string;
  let releases: Release[];

  function release(folderPath: string, adopted: boolean): Release {
    return {
      id: "r1", kind: "album", title: "T", artist: "A", year: null, genre: null, coverPath: null, folderPath, tracks: [],
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...(adopted ? { adopted: true } : {}),
    };
  }

  beforeEach(async () => {
    spotifyDir = await fs.mkdtemp(path.join(os.tmpdir(), "locally-reveal-spotify-"));
    elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), "locally-reveal-else-"));
    await fs.mkdir(path.join(spotifyDir, "Masters", "Summer EP"), { recursive: true });
    releases = [];
    settingsValue = { libraryDir, sync: null, adoptRoots: [spotifyDir] };
    services = {
      settings: new FakeSettingsStore(),
      fs: new NodeFileSystem(),
      library: { list: async () => releases },
    } as unknown as Services;
  });

  afterEach(async () => {
    await fs.rm(spotifyDir, { recursive: true, force: true });
    await fs.rm(elsewhere, { recursive: true, force: true });
  });

  it("reveals the folder of an added release inside a Spotify folder", async () => {
    const folder = path.join(spotifyDir, "Masters", "Summer EP");
    releases = [release(folder, true)];
    const res = await POST(revealRequest({ path: folder }));
    expect(res.status).toBe(200);
    expect(execCalls).toEqual([{ cmd: "open", args: ["-R", folder] }]);
  });

  it("reveals the Spotify folder itself for a release stored straight in it", async () => {
    releases = [release(spotifyDir, true)];
    const res = await POST(revealRequest({ path: spotifyDir }));
    expect(res.status).toBe(200);
    expect(execCalls).toEqual([{ cmd: "open", args: ["-R", spotifyDir] }]);
  });

  it("still refuses a Spotify folder itself that no added release owns", async () => {
    expect((await POST(revealRequest({ path: spotifyDir }))).status).toBe(400);
  });

  it("refuses a Spotify path that no added release owns", async () => {
    const res = await POST(revealRequest({ path: path.join(spotifyDir, "Masters", "Summer EP") }));
    expect(res.status).toBe(400);
    expect(execCalls).toEqual([]);
  });

  it("refuses a release that is not added in place", async () => {
    const folder = path.join(spotifyDir, "Masters", "Summer EP");
    releases = [release(folder, false)];
    expect((await POST(revealRequest({ path: folder }))).status).toBe(400);
    expect(execCalls).toEqual([]);
  });

  it("refuses an added release whose folder is outside every Spotify folder", async () => {
    releases = [release(elsewhere, true)];
    expect((await POST(revealRequest({ path: elsewhere }))).status).toBe(400);
    expect(execCalls).toEqual([]);
  });

  it("refuses an added release once its Spotify folder is no longer in the list", async () => {
    const folder = path.join(spotifyDir, "Masters", "Summer EP");
    releases = [release(folder, true)];
    settingsValue = { libraryDir, sync: null, adoptRoots: [] };
    expect((await POST(revealRequest({ path: folder }))).status).toBe(400);
  });
});
