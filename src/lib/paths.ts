import os from "node:os";
import path from "node:path";

/** Default library directory where tagged music files are written. */
export function defaultLibraryDir(): string {
  return path.join(os.homedir(), "Music", "Spotify Local Import");
}

/** Directory holding app config (settings.json). */
export function settingsDir(): string {
  return path.join(os.homedir(), ".spotify-local-import");
}

/** Full path to the settings file. */
export function settingsFilePath(): string {
  return path.join(settingsDir(), "settings.json");
}

/** Full path to the library index file inside a given library directory. */
export function libraryFilePath(libraryDir: string): string {
  return path.join(libraryDir, "library.json");
}

/**
 * Sanitize a single path segment (artist/album/track name) for safe use as a
 * file or directory name. Strips characters that are illegal or troublesome
 * across common filesystems, trims whitespace/dots, and falls back to
 * "Unknown" if the result is empty.
 */
export function sanitizeSegment(segment: string | null | undefined): string {
  const raw = (segment ?? "").toString();
  const stripped = raw.replace(/[/\\:*?"<>|]/g, "").trim();
  // Remove trailing dots/spaces (problematic on Windows, harmless elsewhere).
  const cleaned = stripped.replace(/[.\s]+$/g, "").trim();
  return cleaned.length > 0 ? cleaned : "Unknown";
}
