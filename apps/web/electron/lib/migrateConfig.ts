import fs from "node:fs";
import path from "node:path";

const CONFIG_FILES = ["settings.json", "sync-state.json"] as const;

/**
 * First-launch copy of the developer-checkout config (~/.spotify-local-import) into the
 * packaged app's config dir. Copies only two fixed file names, never overwrites, and
 * never modifies or deletes anything in `legacyDir`.
 */
export function migrateLegacyConfig(legacyDir: string, targetDir: string): { copied: string[] } {
  const copied: string[] = [];
  if (fs.existsSync(path.join(targetDir, "settings.json"))) return { copied };

  // settings.json holds the sync device token: dir and files are owner-only, like FileSettingsStore.
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  for (const name of CONFIG_FILES) {
    const from = path.join(legacyDir, name);
    if (!fs.existsSync(from)) continue;
    try {
      const to = path.join(targetDir, name);
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(to, 0o600);
      copied.push(name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
  }
  return { copied };
}
