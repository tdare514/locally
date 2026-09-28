import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Detects whether Spotify's "Local Files" feature is watching a given folder. */
export interface SpotifySourceDetector {
  isWatching(libraryDir: string): Promise<boolean>;
}

/**
 * True if `index` (the raw bytes of a `local-files.bnk` file) contains a path
 * inside `libraryDir`. Spotify's index is a binary file, but the paths it
 * indexes appear in it as plain UTF-8 substrings, so a byte-level `includes`
 * is enough — no need to parse the binary format. The trailing separator
 * matters: it's what tells `/tmp/lib` apart from `/tmp/library2`.
 */
export function indexContainsLibrary(index: Buffer, libraryDir: string): boolean {
  const needle = Buffer.from(path.resolve(libraryDir) + path.sep);
  return index.includes(needle);
}

/** `~/Library/Application Support/Spotify/Users` — one subfolder per Spotify account on this Mac. */
export function defaultSpotifyUsersDir(): string {
  return path.join(os.homedir(), "Library", "Application Support", "Spotify", "Users");
}

/**
 * Reads Spotify's on-disk local-files index(es) to determine whether a
 * library folder has been added as a Local Files source. Read-only: this
 * never writes anywhere.
 */
export class LocalFilesIndexDetector implements SpotifySourceDetector {
  constructor(private readonly usersDir: string = defaultSpotifyUsersDir()) {}

  async isWatching(libraryDir: string): Promise<boolean> {
    let entries: string[];
    try {
      const dirents = await fs.readdir(this.usersDir, { withFileTypes: true });
      entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return false;
      throw err;
    }

    for (const entry of entries) {
      const indexPath = path.join(this.usersDir, entry, "local-files.bnk");
      let index: Buffer;
      try {
        index = await fs.readFile(indexPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") continue;
        throw err;
      }
      if (indexContainsLibrary(index, libraryDir)) return true;
    }

    return false;
  }
}
