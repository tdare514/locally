import type { Services } from "../container";
import type { SpotifySourceStatus } from "../../shared/types";

/**
 * Shared by GET /api/spotify/source and POST /api/spotify/source/dismiss so
 * both return the same shape. Detection failures (e.g. Spotify isn't
 * installed, or its index format changes) are swallowed as `watching:
 * false` rather than failing the page.
 */
export async function spotifySourceStatus(services: Services): Promise<SpotifySourceStatus> {
  const settings = await services.settings.get();
  let watching = false;
  try {
    watching = await services.spotify.isWatching(settings.libraryDir);
  } catch (err) {
    console.error("spotify source detection failed", err);
  }
  return {
    libraryDir: settings.libraryDir,
    watching,
    dismissed: settings.spotifySourceDismissed ?? false,
  };
}
