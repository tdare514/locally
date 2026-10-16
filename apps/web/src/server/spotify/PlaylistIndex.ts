import type { SettingsStore } from "../config/SettingsStore";
import type { LibraryRepository } from "../storage/LibraryRepository";
import { resolveLocalTrack } from "../plays/LocalTrackResolver";
import { LOCAL_ID_PREFIX } from "../plays/PlayCounter";
import { SpotifyApiError, type SpotifyClient } from "./SpotifyClient";
import type { PlaylistCache, PlaylistCacheStore, CachedPlaylist } from "./PlaylistCacheStore";

/** Show the cached answer at once; refresh in the background when it is older than this. */
export const STALE_AFTER_MS = 10 * 60_000;
export const MAX_PLAYLIST_PAGES = 20;
export const MAX_ITEM_PAGES = 50;
/** Longest `Retry-After` waited out in place; a longer one ends the refresh and holds off the next. */
const MAX_WAIT_MS = 60_000;
const MAX_RATE_RETRIES = 3;
/** After a failed refresh, wait this long before another is kicked. */
const FAILURE_BACKOFF_MS = 60_000;

const ITEM_FIELDS = "uri,name,duration_ms,artists(name),album(name)";
const ITEMS_QUERY =
  `limit=100&fields=${encodeURIComponent(`next,items(is_local,item(${ITEM_FIELDS}),track(${ITEM_FIELDS}))`)}`;

export interface PlaylistRef {
  id: string;
  name: string;
}

export interface PlaylistsForRelease {
  connected: boolean;
  tracks: Record<string, PlaylistRef[]>;
  refreshing: boolean;
}

export interface PlaylistIndexOptions {
  client: Pick<SpotifyClient, "request">;
  store: PlaylistCacheStore;
  settings: SettingsStore;
  library: Pick<LibraryRepository, "list">;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface RawItem {
  uri?: unknown;
  name?: unknown;
  duration_ms?: unknown;
  artists?: { name?: unknown }[];
  album?: { name?: unknown };
}
interface PlaylistListPage {
  items?: { id?: unknown; name?: unknown; snapshot_id?: unknown }[];
  next?: unknown;
}
interface ItemsPage {
  items?: { is_local?: unknown; item?: RawItem | null; track?: RawItem | null }[];
  next?: unknown;
}

const seg = (s: string) => encodeURIComponent(s);

/**
 * The local-file id for an item Spotify gave without a `spotify:local:` uri, built from its tags
 * so it goes through the same resolver (title, artist and album exact; duration within 2 s).
 */
function uriFromTags(item: RawItem): string | null {
  if (typeof item.name !== "string" || !item.name.trim()) return null;
  if (typeof item.duration_ms !== "number" || !Number.isFinite(item.duration_ms)) return null;
  const artist = (item.artists ?? [])
    .map((a) => (typeof a?.name === "string" ? a.name : ""))
    .filter(Boolean)
    .join(", ");
  const album = typeof item.album?.name === "string" ? item.album.name : "";
  return `${LOCAL_ID_PREFIX}${seg(artist)}:${seg(album)}:${seg(item.name)}:${Math.round(item.duration_ms / 1000)}`;
}

/** Playlist ids are base62; anything else never reaches a URL. */
const PLAYLIST_ID = /^[A-Za-z0-9]+$/;

/**
 * Which of the user's Spotify playlists each Locally track is in (#212). Answers come from the
 * cache file at once; a background refresh (one at a time) reads `/me/playlists`, and items only
 * for playlists whose `snapshot_id` changed.
 */
export class PlaylistIndex {
  private readonly client: Pick<SpotifyClient, "request">;
  private readonly store: PlaylistCacheStore;
  private readonly settings: SettingsStore;
  private readonly library: Pick<LibraryRepository, "list">;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private inflight: Promise<void> | null = null;
  private notBefore = 0;

  constructor(opts: PlaylistIndexOptions) {
    this.client = opts.client;
    this.store = opts.store;
    this.settings = opts.settings;
    this.library = opts.library;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Delete the cached names (disconnect). */
  async clear(): Promise<void> {
    await this.store.remove().catch(() => undefined);
  }

  /** The playlists each track of one release is in, from the cache; kicks a refresh when stale. */
  async forRelease(releaseId: string): Promise<PlaylistsForRelease> {
    const settings = await this.settings.get();
    const spotify = settings.spotify;
    if (!spotify) {
      await this.clear();
      return { connected: false, tracks: {}, refreshing: false };
    }
    let cache = await this.store.read();
    if (cache && cache.revision !== spotify.revision) {
      await this.clear();
      cache = null;
    }
    const stale = !cache || this.now() - cache.fetchedAt > STALE_AFTER_MS;
    if (stale) this.kickRefresh();

    const tracks: Record<string, PlaylistRef[]> = {};
    if (cache) {
      const releases = await this.library.list(settings.libraryDir);
      const seen = new Set<string>();
      for (const [id, playlist] of Object.entries(cache.playlists)) {
        for (const uri of playlist.localUris) {
          const hit = resolveLocalTrack(uri, releases);
          if (hit.kind !== "match" || hit.releaseId !== releaseId) continue;
          const key = `${hit.trackId}|${id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          (tracks[hit.trackId] ??= []).push({ id, name: playlist.name });
        }
      }
      for (const list of Object.values(tracks)) list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return { connected: true, tracks, refreshing: this.inflight !== null };
  }

  /** Start a background refresh unless one is running or a recent failure asks us to wait. */
  private kickRefresh(): void {
    if (this.inflight || this.now() < this.notBefore) return;
    this.inflight = this.refresh()
      .catch((err) => {
        const wait =
          err instanceof SpotifyApiError && err.code === "rateLimited" && err.retryAfterSec !== undefined
            ? err.retryAfterSec * 1000
            : 0;
        this.notBefore = this.now() + Math.max(FAILURE_BACKOFF_MS, wait);
      })
      .finally(() => {
        this.inflight = null;
      });
  }

  /** Resolves when the running refresh (if any) is done. For tests. */
  idle(): Promise<void> {
    return this.inflight ?? Promise.resolve();
  }

  /** Throws on failure; nothing is written then, so the last cache stays. */
  private async refresh(): Promise<void> {
    const spotify = (await this.settings.get()).spotify;
    if (!spotify) return;
    const revision = spotify.revision;
    let previous = await this.store.read();
    if (previous && previous.revision !== revision) previous = null;

    const listed: { id: string; name: string; snapshotId: string }[] = [];
    let next: string | null = "/me/playlists?limit=50";
    for (let page = 0; next && page < MAX_PLAYLIST_PAGES; page++) {
      const body: PlaylistListPage = await this.get<PlaylistListPage>(next);
      for (const p of body.items ?? []) {
        if (typeof p.id !== "string" || !PLAYLIST_ID.test(p.id)) continue;
        if (typeof p.name !== "string" || typeof p.snapshot_id !== "string") continue;
        listed.push({ id: p.id, name: p.name, snapshotId: p.snapshot_id });
      }
      next = typeof body.next === "string" ? body.next : null;
    }

    const playlists: Record<string, CachedPlaylist> = {};
    for (const p of listed) {
      if (playlists[p.id]) continue;
      const old = previous?.playlists[p.id];
      if (old && old.snapshotId === p.snapshotId) {
        playlists[p.id] = { ...old, name: p.name };
        continue;
      }
      try {
        playlists[p.id] = { snapshotId: p.snapshotId, name: p.name, localUris: await this.readItems(p.id) };
      } catch (err) {
        // A playlist Spotify won't show items for (someone else's) is skipped, not fatal.
        if (err instanceof SpotifyApiError && err.code === "http" && (err.status === 403 || err.status === 404)) {
          continue;
        }
        throw err;
      }
    }

    // Disconnected or signed in as someone else while we read: write nothing.
    const still = (await this.settings.get()).spotify;
    if (!still || still.revision !== revision) return;
    const cache: PlaylistCache = { revision, fetchedAt: this.now(), playlists };
    await this.store.write(cache);
  }

  private async readItems(playlistId: string): Promise<string[]> {
    const uris: string[] = [];
    let next: string | null = `/playlists/${playlistId}/items?${ITEMS_QUERY}`;
    for (let page = 0; next && page < MAX_ITEM_PAGES; page++) {
      const body: ItemsPage = await this.get<ItemsPage>(next);
      for (const entry of body.items ?? []) {
        if (entry.is_local !== true) continue;
        const inner = entry.item ?? entry.track;
        if (!inner) continue;
        const uri = typeof inner.uri === "string" && inner.uri.startsWith(LOCAL_ID_PREFIX) ? inner.uri : uriFromTags(inner);
        if (uri) uris.push(uri);
      }
      next = typeof body.next === "string" ? body.next : null;
    }
    return uris;
  }

  /** One GET; a 429 waits out Retry-After (up to a minute) and tries again. */
  private async get<T>(path: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.client.request<T>(path);
      } catch (err) {
        if (!(err instanceof SpotifyApiError) || err.code !== "rateLimited") throw err;
        const waitMs = (err.retryAfterSec ?? 1) * 1000;
        if (attempt >= MAX_RATE_RETRIES || waitMs > MAX_WAIT_MS) throw err;
        await this.sleep(waitMs);
      }
    }
  }
}
