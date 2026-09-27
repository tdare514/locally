import fs from "node:fs/promises";
import type { Settings } from "../../shared/types";
import { defaultLibraryDir, settingsDir, settingsFilePath } from "./paths";
import type { SettingsStore } from "./SettingsStore";

async function ensureDirExists(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * JSON-file backed {@link SettingsStore}. Settings live at
 * `~/.spotify-local-import/settings.json`; a missing file is treated as
 * "first run" and seeded with defaults (and the default library dir is
 * created) rather than being an error.
 */
export class FileSettingsStore implements SettingsStore {
  async get(): Promise<Settings> {
    const file = settingsFilePath();
    try {
      const raw = await fs.readFile(file, "utf-8");
      const parsed = JSON.parse(raw) as Partial<Settings>;
      const libraryDir =
        typeof parsed.libraryDir === "string" && parsed.libraryDir.trim().length > 0
          ? parsed.libraryDir
          : defaultLibraryDir();
      return { libraryDir };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        const defaults: Settings = { libraryDir: defaultLibraryDir() };
        await this.set(defaults);
        return defaults;
      }
      throw err;
    }
  }

  async set(settings: Settings): Promise<Settings> {
    await ensureDirExists(settingsDir());
    await ensureDirExists(settings.libraryDir);
    await fs.writeFile(settingsFilePath(), JSON.stringify(settings, null, 2), "utf-8");
    return settings;
  }
}
