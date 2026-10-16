import os from "node:os";
import path from "node:path";

/** The user's home directory; the one place the server layer resolves it. */
export function homeDir(): string {
  return os.homedir();
}

/** Default library directory where tagged music files are written. */
export function defaultLibraryDir(): string {
  return path.join(homeDir(), "Music", "Spotify Local Import");
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

/** Full path to the cached Spotify playlists file (#212), next to settings.json. */
export function spotifyPlaylistsFilePath(): string {
  return path.join(settingsDir(), "spotify-playlists.json");
}

/** Full path to the last adopt-scan proposal (#245), next to settings.json. */
export function adoptProposalFilePath(): string {
  return path.join(settingsDir(), "adopt-proposal.json");
}
