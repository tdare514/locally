import type { SpotifyPlaylistsResponse } from "../shared/types";

const FAST_MS = 2500;
const FAST_WINDOW_MS = 30_000;
const SLOW_MS = 10_000;
export const POLL_WINDOW_MS = 4 * 60_000;

/**
 * Milliseconds until the next look at the playlists, or null to stop. While the server refreshes:
 * every 2.5 s for the first 30 s, then every 10 s. While it is held off (a failure or a long
 * Retry-After) the server says when to look again. Stops after 4 minutes.
 */
export function nextPollDelayMs(elapsedMs: number, res: SpotifyPlaylistsResponse): number | null {
  if (!res.connected || elapsedMs >= POLL_WINDOW_MS) return null;
  if (res.refreshing) return elapsedMs < FAST_WINDOW_MS ? FAST_MS : SLOW_MS;
  if (res.retryAfterSec !== undefined && res.retryAfterSec > 0) {
    const wait = res.retryAfterSec * 1000 + 500;
    return elapsedMs + wait < POLL_WINDOW_MS ? wait : null;
  }
  return null;
}

export interface PlaylistsPolling {
  /** Look again now and restart the 4-minute window (the window regained focus). */
  poke(): void;
  stop(): void;
}

/** Look once, then keep looking on {@link nextPollDelayMs} until it says stop or `stop()` is called. */
export function startPlaylistsPolling(
  fetchPlaylists: () => Promise<SpotifyPlaylistsResponse | null>,
  onResult: (res: SpotifyPlaylistsResponse) => void,
): PlaylistsPolling {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let startedAt = Date.now();
  let generation = 0;

  const look = () => {
    const mine = ++generation;
    fetchPlaylists()
      .then((res) => {
        if (stopped || mine !== generation || !res) return;
        onResult(res);
        const delay = nextPollDelayMs(Date.now() - startedAt, res);
        if (delay !== null) timer = setTimeout(look, delay);
      })
      .catch(() => undefined);
  };
  look();

  return {
    poke() {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      startedAt = Date.now();
      look();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
