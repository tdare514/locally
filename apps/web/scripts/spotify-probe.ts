/**
 * Dev-only spike for #212 step 1. After signing in to Spotify in Locally, run once from apps/web:
 *   npx tsx scripts/spotify-probe.ts
 * It reads the connection from Locally's real settings file (or LOCALLY_CONFIG_DIR) and prints
 * counts and uri shapes for the first few playlists. It never prints names. Nothing else uses it.
 */
import { FileSettingsStore } from "../src/server/config/FileSettingsStore";
import { SPOTIFY_CLIENT_ID } from "../src/server/spotify/config";
import { SpotifyClient } from "../src/server/spotify/SpotifyClient";
import { probePlaylists } from "../src/server/spotify/playlistProbe";

async function main(): Promise<void> {
  const client = new SpotifyClient({ settings: new FileSettingsStore(), clientId: SPOTIFY_CLIENT_ID });
  console.log(JSON.stringify(await probePlaylists(client), null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "Probe failed");
  process.exit(1);
});
