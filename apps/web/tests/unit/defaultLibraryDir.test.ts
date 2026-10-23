import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileSettingsStore } from "../../src/server/config/FileSettingsStore";
import { defaultLibraryDirFor, settingsFilePath } from "../../src/server/config/paths";
import { BRAND_FOLDER_NAME } from "../../src/shared/brand";

describe("defaultLibraryDirFor (#335)", () => {
  it("is inside the first Spotify folder when there is one", () => {
    expect(defaultLibraryDirFor("/h", ["/h/Documents/Spotify Music", "/h/Other"])).toBe(
      path.join("/h/Documents/Spotify Music", BRAND_FOLDER_NAME)
    );
  });
  it("is under ~/Music otherwise", () => {
    expect(defaultLibraryDirFor("/h", [])).toBe(path.join("/h", "Music", BRAND_FOLDER_NAME));
    expect(defaultLibraryDirFor("/h", ["  "])).toBe(path.join("/h", "Music", BRAND_FOLDER_NAME));
  });
});

describe("FileSettingsStore defaults", () => {
  let root: string;
  let env: string | undefined;
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    env = process.env.LOCALLY_CONFIG_DIR;
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "sli-default-lib-")));
    process.env.LOCALLY_CONFIG_DIR = path.join(root, "config");
    spy = vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));
  });
  afterEach(async () => {
    spy.mockRestore();
    if (env === undefined) delete process.env.LOCALLY_CONFIG_DIR;
    else process.env.LOCALLY_CONFIG_DIR = env;
    await fs.rm(root, { recursive: true, force: true });
  });

  it("a first run proposes ~/Music/<brand>", async () => {
    const s = await new FileSettingsStore().get();
    expect(s.libraryDir).toBe(path.join(root, "home", "Music", BRAND_FOLDER_NAME));
  });

  it("a saved library folder is never changed", async () => {
    const old = path.join(root, "home", "Music", "Spotify Local Import");
    await fs.mkdir(path.join(root, "config"), { recursive: true });
    await fs.writeFile(
      settingsFilePath(),
      JSON.stringify({ libraryDir: old, adoptRoots: [path.join(root, "Spot")] })
    );
    expect((await new FileSettingsStore().get()).libraryDir).toBe(old);
  });

  it("a settings file with Spotify folders but no library folder proposes one inside the first", async () => {
    const spot = path.join(root, "Spot");
    await fs.mkdir(path.join(root, "config"), { recursive: true });
    await fs.writeFile(settingsFilePath(), JSON.stringify({ adoptRoots: [spot] }));
    expect((await new FileSettingsStore().get()).libraryDir).toBe(path.join(spot, BRAND_FOLDER_NAME));
  });
});
