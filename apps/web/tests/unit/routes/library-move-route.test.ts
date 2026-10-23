import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Services } from "../../../src/server/container";
import type { Release, Settings } from "../../../src/shared/types";
import { FileSettingsStore } from "../../../src/server/config/FileSettingsStore";
import { JsonLibraryRepository } from "../../../src/server/storage/JsonLibraryRepository";
import { moveLibrary } from "../../../src/server/library/LibraryMover";
import { NodeFileSystem } from "../../../src/server/fs/NodeFileSystem";
import { runLibraryMove, trackLibraryWrite } from "../../../src/server/library/writeActivity";

let services: Services;
let homeDir: string;

vi.mock("../../../src/server/container", () => ({ getServices: () => services }));
vi.mock("../../../src/server/config/paths", async (orig) => ({
  ...(await orig<typeof import("../../../src/server/config/paths")>()),
  homeDir: () => homeDir,
}));

import { POST, GET } from "../../../src/app/api/library/move/route";

let base: string;
let lib: string;
let configDir: string;
let envConfig: string | undefined;
const settings = new FileSettingsStore();
const repo = new JsonLibraryRepository();

function post(destination: unknown): NextRequest {
  return new NextRequest("http://localhost/api/library/move", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ destination }),
  });
}

async function seed(): Promise<Release> {
  const folder = path.join(lib, "Artist", "Album");
  await fs.mkdir(folder, { recursive: true });
  const t1 = path.join(folder, "01.mp3");
  const t2 = path.join(folder, "02.mp3");
  await fs.writeFile(t1, Buffer.from("one-audio"));
  await fs.writeFile(t2, Buffer.from("two-audio"));
  await fs.writeFile(path.join(folder, "cover.jpg"), Buffer.from("img"));
  const release: Release = {
    id: "r1", kind: "album", title: "Album", artist: "Artist", year: null, genre: null,
    coverPath: path.join(folder, "cover.jpg"), folderPath: folder,
    tracks: [
      { id: "t1", title: "One", trackNumber: 1, filePath: t1, originalName: "1.mp3", durationSec: null },
      { id: "t2", title: "Two", trackNumber: 2, filePath: t2, originalName: "2.mp3", durationSec: null },
    ],
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
  await repo.upsert(lib, release);
  return release;
}

beforeEach(async () => {
  envConfig = process.env.LOCALLY_CONFIG_DIR;
  delete process.env.LOCALLY_DEMO;
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "sli-move-")));
  homeDir = path.join(base, "home");
  configDir = path.join(homeDir, "appdata");
  process.env.LOCALLY_CONFIG_DIR = configDir;
  lib = path.join(homeDir, "Music", "Spotify Local Import");
  await fs.mkdir(lib, { recursive: true });
  await settings.set({ libraryDir: lib, sync: null, trackPlays: false, playsPromptAnswered: false, adoptRoots: [] } as Settings);
  services = { settings, library: repo } as unknown as Services;
});

afterEach(async () => {
  delete process.env.LOCALLY_DEMO;
  if (envConfig === undefined) delete process.env.LOCALLY_CONFIG_DIR;
  else process.env.LOCALLY_CONFIG_DIR = envConfig;
  await fs.rm(base, { recursive: true, force: true });
});

describe("POST /api/library/move", () => {
  it("answers 403 in the demo", async () => {
    process.env.LOCALLY_DEMO = "1";
    expect((await POST(post(path.join(homeDir, "x")))).status).toBe(403);
    expect((await GET()).status).toBe(403);
  });

  it("refuses bad destinations and changes nothing", async () => {
    await seed();
    const cases: unknown[] = [
      "relative/path",
      42,
      path.join(base, "outside-home"),
      homeDir,
      path.join(lib, "inner"),
      lib,
      path.join(configDir, "x"),
    ];
    for (const dest of cases) {
      const res = await POST(post(dest));
      expect(res.status, String(dest)).toBe(400);
    }
    const full = path.join(homeDir, "Full");
    await fs.mkdir(full);
    await fs.writeFile(path.join(full, "a.txt"), "x");
    expect((await POST(post(full))).status).toBe(400);
    const file = path.join(homeDir, "afile");
    await fs.writeFile(file, "x");
    expect((await POST(post(file))).status).toBe(400);
    expect((await settings.get()).libraryDir).toBe(lib);
  });

  it("renames on one volume, rewrites the index and the setting", async () => {
    await seed();
    const dest = path.join(homeDir, "Spotify Music", "Locally");
    const res = await POST(post(dest));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ from: lib, to: dest, releases: 1, songs: 2, oldRemoved: true });
    expect((await settings.get()).libraryDir).toBe(dest);
    await expect(fs.stat(lib)).rejects.toThrow();
    const [r] = await repo.list(dest);
    expect(r.folderPath).toBe(path.join(dest, "Artist", "Album"));
    expect(r.coverPath).toBe(path.join(dest, "Artist", "Album", "cover.jpg"));
    expect(r.tracks.map((t) => t.filePath)).toEqual([
      path.join(dest, "Artist", "Album", "01.mp3"),
      path.join(dest, "Artist", "Album", "02.mp3"),
    ]);
    expect(await fs.readFile(r.tracks[0].filePath, "utf-8")).toBe("one-audio");
  });

  it("onto an existing empty folder works", async () => {
    await seed();
    const dest = path.join(homeDir, "Empty");
    await fs.mkdir(dest);
    expect((await POST(post(dest))).status).toBe(200);
    expect((await settings.get()).libraryDir).toBe(dest);
  });

  it("copies, verifies and removes the old tree when forced across volumes", async () => {
    await seed();
    const dest = path.join(homeDir, "Other", "Locally");
    const out = await moveLibrary(
      { settings, library: repo, fs: new NodeFileSystem(), home: homeDir, dataDir: configDir, forceCrossVolume: true },
      dest
    );
    expect(out.oldRemoved).toBe(true);
    await expect(fs.stat(lib)).rejects.toThrow();
    expect((await settings.get()).libraryDir).toBe(dest);
    const [r] = await repo.list(dest);
    expect(r.tracks[1].filePath).toBe(path.join(dest, "Artist", "Album", "02.mp3"));
    expect(await fs.readFile(r.tracks[1].filePath, "utf-8")).toBe("two-audio");
  });

  it("a failed copy leaves the old library and settings alone and cleans the destination", async () => {
    await seed();
    const dest = path.join(homeDir, "Other", "Locally");
    // a socket-less unreadable file makes the copy fail
    await fs.chmod(path.join(lib, "Artist", "Album", "02.mp3"), 0o000);
    await expect(
      moveLibrary({ settings, library: repo, fs: new NodeFileSystem(), home: homeDir, dataDir: configDir, forceCrossVolume: true }, dest)
    ).rejects.toThrow();
    await fs.chmod(path.join(lib, "Artist", "Album", "02.mp3"), 0o644);
    expect((await settings.get()).libraryDir).toBe(lib);
    await expect(fs.stat(dest)).rejects.toThrow();
    expect((await repo.list(lib))[0].folderPath).toBe(path.join(lib, "Artist", "Album"));
  });

  it("refuses with 409 while an import is running", async () => {
    await seed();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const running = trackLibraryWrite(() => gate);
    const dest = path.join(homeDir, "Locally");
    const res = await POST(post(dest));
    expect(res.status).toBe(409);
    expect((await settings.get()).libraryDir).toBe(lib);
    release();
    await running;
    expect((await POST(post(dest))).status).toBe(200);
  });

  it("holds off writes while the move runs", async () => {
    let inside!: () => void;
    const started = new Promise<void>((r) => (inside = r));
    let finish!: () => void;
    const gate = new Promise<void>((r) => (finish = r));
    const moving = runLibraryMove(async () => {
      inside();
      await gate;
    });
    await started;
    await expect(trackLibraryWrite(async () => 1)).rejects.toThrow(/moving/);
    finish();
    await moving;
    await expect(trackLibraryWrite(async () => 1)).resolves.toBe(1);
  });
});
