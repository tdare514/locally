import type { Services } from "../container";
import type { SpotifyConnectionStatus } from "../../shared/types";

/** The no-token view of the Spotify connection for the browser. */
export async function spotifyConnectionStatus(services: Services): Promise<SpotifyConnectionStatus> {
  const spotify = (await services.settings.get()).spotify;
  const pending = services.spotifyAuth.isPending();
  return {
    available: true,
    connected: !!spotify,
    displayName: spotify?.displayName ?? null,
    scopes: spotify?.scopes ?? [],
    pending,
    // A stale failure is not shown on top of a live connection or sign-in.
    error: spotify || pending ? null : (services.spotifyAuth.lastError ?? services.spotifyClient.lastError),
  };
}
