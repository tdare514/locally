import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileSettingsStore } from "../../src/server/config/FileSettingsStore";
import { settingsDir, settingsFilePath } from "../../src/server/config/paths";

let configDir: string;
let fakeHomeDir: string;
let originalEnv: string | undefined;
let homedirSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  originalEnv = process.env.LOCALLY_CONFIG_DIR;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sli-settings-store-"));
  configDir = path.join(root, "config");
  process.env.LOCALLY_CONFIG_DIR = configDir;

  // `defaultLibraryDir()` (used whenever settings.json is missing/corrupt)
  // joins onto `os.homedir()`; redirect it into the same temp root so a
  // "first run" never creates or touches the real home directory's Music
  // folder.
  fakeHomeDir = path.join(root, "home");
  await fs.mkdir(fakeHomeDir, { recursive: true });
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(fakeHomeDir);
});

afterEach(async () => {
  homedirSpy.mockRestore();
  if (originalEnv === undefined) delete process.env.LOCALLY_CONFIG_DIR;
  else process.env.LOCALLY_CONFIG_DIR = originalEnv;
  await fs.rm(path.dirname(configDir), { recursive: true, force: true });
});

/** 0o700/0o600 checks: mask off the file-type bits `stat` also reports. */
function permBits(mode: number): string {
  return (mode & 0o777).toString(8);
}

describe("FileSettingsStore", () => {
  it("creates the config dir with mode 0700 and the file with mode 0600", async () => {
    const store = new FileSettingsStore();
    await store.get();

    expect(settingsDir()).toBe(configDir);
    const dirStat = await fs.stat(configDir);
    expect(permBits(dirStat.mode)).toBe("700");

    const fileStat = await fs.stat(settingsFilePath());
    expect(permBits(fileStat.mode)).toBe("600");
  });

  it("seeds defaults on first run (no settings.json yet)", async () => {
    const store = new FileSettingsStore();
    const settings = await store.get();
    expect(settings.sync).toBeNull();
    expect(settings.libraryDir.startsWith(fakeHomeDir)).toBe(true);
    expect(await fs.readFile(settingsFilePath(), "utf-8")).toContain(settings.libraryDir);
  });

  it("round-trips a set()/get() through the tmp-file-plus-rename write", async () => {
    const store = new FileSettingsStore();
    const libraryDir = path.join(configDir, "lib");
    await store.set({ libraryDir, sync: null });

    // No leftover tmp file after the rename.
    const entries = await fs.readdir(configDir);
    expect(entries.some((e) => e.includes(".tmp-"))).toBe(false);

    const settings = await store.get();
    expect(settings.libraryDir).toBe(libraryDir);
  });

  it("recovers from a corrupt settings.json by moving it aside and falling back to defaults", async () => {
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(settingsFilePath(), "{ not valid json", "utf-8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const store = new FileSettingsStore();
    const settings = await store.get();

    expect(settings.sync).toBeNull();
    expect(warn).toHaveBeenCalledOnce();

    const entries = await fs.readdir(configDir);
    expect(entries.some((e) => e.startsWith("settings.json.corrupt-"))).toBe(true);

    // The corrupt file's content is preserved, not deleted.
    const corruptName = entries.find((e) => e.startsWith("settings.json.corrupt-"));
    const corruptContent = await fs.readFile(path.join(configDir, corruptName!), "utf-8");
    expect(corruptContent).toBe("{ not valid json");

    // Defaults were written back so a later read doesn't hit the same corruption.
    const reread = JSON.parse(await fs.readFile(settingsFilePath(), "utf-8"));
    expect(reread.sync).toBeNull();

    warn.mockRestore();
  });
});
