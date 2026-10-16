import type { SpotifyClient } from "../spotify/SpotifyClient";
import type { NowPlayingResult, SpotifyNowPlaying } from "./SpotifyNowPlaying";

/**
 * Reads what the user's Spotify account is playing on any device from `GET /me/player` (#228).
 * Keeps nothing from the response beyond the returned sample. A {@link SpotifyApiError} is thrown
 * as is; {@link SwitchingNowPlaying} decides what to do with it.
 */
export class WebApiNowPlaying implements SpotifyNowPlaying {
  constructor(private readonly client: Pick<SpotifyClient, "requestOptional">) {}

  async read(): Promise<NowPlayingResult> {
    // 204 No Content: no active player on any device.
    const body = await this.client.requestOptional<unknown>("/me/player");
    if (body === null) return { running: false };

    const player = isRecord(body) ? body : {};
    const item = isRecord(player.item) ? player.item : null;
    const uri = item && typeof item.uri === "string" && item.uri.length > 0 ? item.uri : null;
    const progressMs = typeof player.progress_ms === "number" && Number.isFinite(player.progress_ms) ? player.progress_ms : null;
    const durationMs =
      item && typeof item.duration_ms === "number" && Number.isFinite(item.duration_ms) && item.duration_ms > 0
        ? item.duration_ms
        : 0;
    // Without a usable position the sample can't be trusted, so it carries no track id.
    const id = uri !== null && progressMs !== null ? uri : null;
    return {
      running: true,
      state: player.is_playing === true ? "playing" : "paused",
      id,
      positionSec: progressMs !== null ? progressMs / 1000 : 0,
      durationMs,
    };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
