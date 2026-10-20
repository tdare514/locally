import type { SpotifyClient } from "./SpotifyClient";

/** Counts and uri shapes only. Never a playlist, track or artist name. */
export interface PlaylistProbeResult {
  playlists: number;
  items: number;
  localItems: number;
  /** Local items whose uri starts with `spotify:local:`. */
  localWithLocalUri: number;
  /** Local items with no uri at all. */
  localWithoutUri: number;
  /** Local items with some other uri. */
  localOtherUri: number;
  /** Distinct colon-separated segment counts of the local uris seen, e.g. `[6]` for `spotify:local:a:b:c:n`. */
  localUriSegmentCounts: number[];
}

interface PlaylistPage {
  items?: { id?: unknown }[];
}
interface ItemsPage {
  // Since Feb 2026 the item sits under `item`; older responses used `track`.
  items?: { is_local?: unknown; item?: { uri?: unknown } | null; track?: { uri?: unknown } | null }[];
}

/**
 * Spike for #212 step 1: do local files in a playlist carry a `spotify:local:` uri? Reads the
 * first `limit` playlists, first page of items each. Dev only; nothing calls it from the app.
 */
export async function probePlaylists(client: SpotifyClient, limit = 5): Promise<PlaylistProbeResult> {
  const result: PlaylistProbeResult = {
    playlists: 0,
    items: 0,
    localItems: 0,
    localWithLocalUri: 0,
    localWithoutUri: 0,
    localOtherUri: 0,
    localUriSegmentCounts: [],
  };
  const segmentCounts = new Set<number>();
  const page = await client.request<PlaylistPage>(`/me/playlists?limit=${Math.max(1, Math.min(limit, 50))}`);
  for (const playlist of page.items ?? []) {
    if (typeof playlist.id !== "string" || !/^[A-Za-z0-9]+$/.test(playlist.id)) continue;
    result.playlists++;
    const items = await client.request<ItemsPage>(`/playlists/${playlist.id}/items?limit=100`);
    for (const entry of items.items ?? []) {
      result.items++;
      const inner = entry.item ?? entry.track;
      const isLocal = entry.is_local === true;
      if (!isLocal) continue;
      result.localItems++;
      const uri = inner && typeof inner.uri === "string" ? inner.uri : null;
      if (!uri) result.localWithoutUri++;
      else if (uri.startsWith("spotify:local:")) {
        result.localWithLocalUri++;
        segmentCounts.add(uri.split(":").length);
      } else result.localOtherUri++;
    }
  }
  result.localUriSegmentCounts = [...segmentCounts].sort((a, b) => a - b);
  return result;
}
