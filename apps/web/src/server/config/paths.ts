import os from "node:os";
import path from "node:path";
import { BRAND_FOLDER_NAME } from "../../shared/brand";

/** The user's home directory; the one place the server layer resolves it. */
export function homeDir(): string {
  return os.homedir();
}

/**
 * Where a new setup proposes the library folder (#335): inside the first Spotify folder when there is
 * one, else under ~/Music. Never applied to settings that already exist.
 */
export function defaultLibraryDirFor(home: string, adoptRoots: readonly string[] = []): string {
  const first = adoptRoots.find((r) => r.trim().length > 0);
  return first ? path.join(path.resolve(first), BRAND_FOLDER_NAME) : path.join(home, "Music", BRAND_FOLDER_NAME);
}

/** Default library directory where tagged music files are written. */
export function defaultLibraryDir(adoptRoots: readonly string[] = []): string {
  return defaultLibraryDirFor(homeDir(), adoptRoots);
}

/**
 * Directory holding app config (settings.json). Overridable via
 * `LOCALLY_CONFIG_DIR` so tests can point this at a temp dir instead of the
 * real `~/.spotify-local-import` - never set this in a normal run.
 */
export function settingsDir(): string {
  const override = process.env.LOCALLY_CONFIG_DIR;
  if (override && override.trim().length > 0) return override;
  return path.join(homeDir(), ".spotify-local-import");
}

/** Full path to the settings file. */
export function settingsFilePath(): string {
  return path.join(settingsDir(), "settings.json");
}

/** Full path to the library index file inside a given library directory. */
export function libraryFilePath(libraryDir: string): string {
  return path.join(libraryDir, "library.json");
}

/** Full path to the sync bookkeeping file (push/pending state, not secrets). */
export function syncStateFilePath(): string {
  return path.join(settingsDir(), "sync-state.json");
}

/** Full path to the local play counts file (#106), next to settings.json. */
export function playsFilePath(): string {
  return path.join(settingsDir(), "plays.json");
}

/** Full path to the local play events file (#398), next to plays.json. */
export function playEventsFilePath(): string {
  return path.join(settingsDir(), "play-events.json");
}

/** Full path to the collections file (#349), next to settings.json. */
export function collectionsFilePath(): string {
  return path.join(settingsDir(), "collections.json");
}

/** Full path to the cached Spotify playlists file (#212), next to settings.json. */
export function spotifyPlaylistsFilePath(): string {
  return path.join(settingsDir(), "spotify-playlists.json");
}

/** Full path to the last adopt-scan proposal (#245), next to settings.json. */
export function adoptProposalFilePath(): string {
  return path.join(settingsDir(), "adopt-proposal.json");
}

/** Where adopted releases' covers are copied to (#245): Locally's own data, never inside an adopt root. */
export function adoptedCoversDir(): string {
  return path.join(settingsDir(), "adopted-covers");
}
