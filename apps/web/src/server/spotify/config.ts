import { HAS_SPOTIFY_CONNECTION } from "../../components/sidebar/flags";
import { isDemo } from "../demo";

/**
 * The Locally Spotify app's client id. It is public under PKCE (there is no client secret),
 * so it is committed. `LOCALLY_SPOTIFY_CLIENT_ID` overrides it (dev, tests).
 */
export const BUNDLED_CLIENT_ID = "8cbb2438e9a94f73bb45def62aea049e";

export const SPOTIFY_CLIENT_ID = process.env.LOCALLY_SPOTIFY_CLIENT_ID || BUNDLED_CLIENT_ID;

/** The redirect URI registered on the Spotify app. Spotify matches it exactly, so the port is fixed. */
export const SPOTIFY_REDIRECT_PORT = 8888;
export const SPOTIFY_REDIRECT_URI = `http://127.0.0.1:${SPOTIFY_REDIRECT_PORT}/callback`;

/** Read-only scopes: playlists (#212) and playback state (#228). */
export const SPOTIFY_SCOPES = "playlist-read-private playlist-read-collaborative user-read-playback-state";

/** Whether the connection exists in this build: not the demo, the flag on, and a client id set. */
export function spotifyAvailable(): boolean {
  return !isDemo() && HAS_SPOTIFY_CONNECTION && SPOTIFY_CLIENT_ID.length > 0;
}
