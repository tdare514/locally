import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileSettingsStore } from "../../src/server/config/FileSettingsStore";
import type { Settings } from "../../src/shared/types";
import { settingsFilePath } from "../../src/server/config/paths";
import { SAMPLE_SPOTIFY } from "./spotifyFakes";

let originalEnv: string | undefined;
let homedirSpy: ReturnType<typeof vi.spyOn>;
let root: string;

beforeEach(async () => {
  originalEnv = process.env.LOCALLY_CONFIG_DIR;
  root = await fs.mkdtemp(path.join(os.tmpdir(), "sli-spotify-settings-"));
  process.env.LOCALLY_CONFIG_DIR = path.join(root, "config");
  await fs.mkdir(path.join(root, "home"), { recursive: true });
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));
});

afterEach(async () => {
  homedirSpy.mockRestore();
  if (originalEnv === undefined) delete process.env.LOCALLY_CONFIG_DIR;
  else process.env.LOCALLY_CONFIG_DIR = originalEnv;
  await fs.rm(root, { recursive: true, force: true });
});

describe("settings.spotify", () => {
  it("round-trips and keeps the file mode 0600", async () => {
    const store = new FileSettingsStore();
    const base = await store.get();
    await store.set({ ...base, spotify: SAMPLE_SPOTIFY });
    expect((await store.get()).spotify).toEqual(SAMPLE_SPOTIFY);
    const stat = await fs.stat(settingsFilePath());
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("parses an older file without a spotify block", async () => {
    const store = new FileSettingsStore();
    const base = await store.get();
    await fs.writeFile(settingsFilePath(), JSON.stringify({ libraryDir: base.libraryDir, sync: null, trackPlays: true }));
    const got = await store.get();
    expect(got.trackPlays).toBe(true);
    expect("spotify" in got).toBe(false);
  });

  it("treats a malformed block as absent", async () => {
    const store = new FileSettingsStore();
    const base = await store.get();
    for (const bad of [null, "x", {}, { ...SAMPLE_SPOTIFY, refreshToken: "" }, { ...SAMPLE_SPOTIFY, accessTokenExpiresAt: "soon" }, { ...SAMPLE_SPOTIFY, scopes: "a" }]) {
      await fs.writeFile(settingsFilePath(), JSON.stringify({ libraryDir: base.libraryDir, sync: null, spotify: bad }));
      expect((await store.get()).spotify).toBeUndefined();
    }
  });

  it("a block removed before set() is gone from the file", async () => {
    const store = new FileSettingsStore();
    const base = await store.get();
    await store.set({ ...base, spotify: SAMPLE_SPOTIFY });
    const { spotify: _gone, ...rest } = await store.get();
    void _gone;
    await store.set(rest);
    expect(await fs.readFile(settingsFilePath(), "utf-8")).not.toContain("refreshToken");
  });

  it("20 updates split across two store instances count exactly 20", async () => {
    const a = new FileSettingsStore();
    const b = new FileSettingsStore();
    await a.get();
    const bump = (c: Settings): Settings => ({ ...c, sync: { baseUrl: "http://localhost:4000", deviceToken: null, email: null, lastVersion: (c.sync?.lastVersion ?? 0) + 1 } });
    await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).update(bump)));
    expect((await a.get()).sync?.lastVersion).toBe(20);
    expect((await fs.stat(settingsFilePath())).mode & 0o777).toBe(0o600);
  });

  it("first run: a delayed get() and an update() race, and the update survives", async () => {
    const store = new FileSettingsStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const readSpy = vi.spyOn(fs, "readFile").mockImplementationOnce(async () => {
      await gate;
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });
    const first = store.get(); // its read of the missing file is held open
    const updated = new FileSettingsStore().update((c) => ({ ...c, trackPlays: true }));
    // Let the read go only once the update has finished, or after 50 ms if the update is
    // queued behind the read's lock (the fixed store). Unlocked, the late read would then
    // write first-run defaults over the finished update.
    await Promise.race([updated, new Promise((r) => setTimeout(r, 50))]);
    release();
    await Promise.all([first, updated]);
    readSpy.mockRestore();
    expect((await store.get()).trackPlays).toBe(true);
  });

  it("corrupt file: a recovery racing an update neither renames the repaired file nor loses the update", async () => {
    const store = new FileSettingsStore();
    await store.get();
    await fs.writeFile(settingsFilePath(), "{ not json");
    const realRename = fs.rename.bind(fs);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      await gate;
      return realRename(from, to);
    });
    const recovering = store.get(); // renames the bad file, held open
    const updated = new FileSettingsStore().update((c) => ({ ...c, trackPlays: true }));
    release();
    await Promise.all([recovering, updated]);
    renameSpy.mockRestore();
    expect((await store.get()).trackPlays).toBe(true);
    const names = await fs.readdir(path.dirname(settingsFilePath()));
    expect(names.filter((n) => n.includes(".corrupt-"))).toHaveLength(1);
  });
});
