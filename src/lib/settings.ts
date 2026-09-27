import fs from "node:fs/promises";
import path from "node:path";
import type { Settings } from "./types";
import { defaultLibraryDir, settingsDir, settingsFilePath } from "./paths";

async function ensureDirExists(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** Read settings, creating a default settings file (and library dir) if missing. */
export async function readSettings(): Promise<Settings> {
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
      await writeSettings(defaults);
      return defaults;
    }
    throw err;
  }
}

/** Persist settings, ensuring the config dir and the library dir both exist. */
export async function writeSettings(settings: Settings): Promise<Settings> {
  await ensureDirExists(settingsDir());
  await ensureDirExists(settings.libraryDir);
  await fs.writeFile(settingsFilePath(), JSON.stringify(settings, null, 2), "utf-8");
  return settings;
}

export function resolvePath(...segments: string[]): string {
  return path.resolve(...segments);
}
