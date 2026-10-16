import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlaylistIndex, MAX_ITEM_PAGES, MAX_PLAYLIST_PAGES, STALE_AFTER_MS } from "../../src/server/spotify/PlaylistIndex";
import {
  FilePlaylistCacheStore,
  type PlaylistCache,
  type PlaylistCacheStore,
} from "../../src/server/spotify/PlaylistCacheStore";
import { SpotifyApiError } from "../../src/server/spotify/SpotifyClient";
import type { Release, Track } from "../../src/shared/types";
import { MemorySettings, SAMPLE_SPOTIFY } from "./spotifyFakes";

const P1 = "1".repeat(22);
const P2 = "2".repeat(22);

function track(id: string, title: string, durationSec: number | null = 200): Track {
  return { id, title, trackNumber: 1, filePath: `/lib/${id}.mp3`, originalName: `${id}.mp3`, durationSec };
}
function release(id: string, title: string, artist: string, tracks: Track[]): Release {
  return {
    id, kind: "album", title, artist, year: null, genre: null, coverPath: null, folderPath: `/lib/${id}`,
    tracks, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
const RELEASES = [
  release("r1", "Album", "Artist", [track("t1", "Song One"), track("t2", "Song Two", 180)]),
  release("r2", "Other", "Someone", [track("t3", "Elsewhere")]),
];
const uri = (artist: string, album: string, title: string, sec: number) =>
  `spotify:local:${encodeURIComponent(artist)}:${encodeURIComponent(album)}:${encodeURIComponent(title).replace(/%20/g, "+")}:${sec}`;

class MemoryStore implements PlaylistCacheStore {
  cache: PlaylistCache | null = null;
  writes = 0;
  removes = 0;
  async read() { return this.cache ? structuredClone(this.cache) : null; }
  async write(c: PlaylistCache) { this.cache = structuredClone(c); this.writes++; }
  async remove() { this.cache = null; this.removes++; }
}

type Handler = (path: string) => unknown;
function fakeClient(handler: Handler) {
  const calls: string[] = [];
  return {
    calls,
    request: async <T,>(p: string): Promise<T> => {
      calls.push(p);
      const r = await handler(p);
      if (r instanceof Error) throw r;
      return r as T;
    },
  };
}

interface Pl { id: string; name: string; snapshot_id: string }
const localItem = (u: string | null, extra: Record<string, unknown> = {}) => ({
  is_local: true,
  item: { uri: u, ...extra },
});

let settings: MemorySettings;
let store: MemoryStore;
let nowMs: number;

beforeEach(() => {
  settings = new MemorySettings();
  settings.value = { ...settings.value, spotify: { ...SAMPLE_SPOTIFY } };
  store = new MemoryStore();
  nowMs = 1_000_000;
});

function index(client: ReturnType<typeof fakeClient>, sleeps: number[] = []) {
  return new PlaylistIndex({
    client,
    store,
    settings,
    library: { list: async () => RELEASES },
    now: () => nowMs,
    sleep: async (ms) => { sleeps.push(ms); },
  });
}

function simpleApi(playlists: Pl[], items: Record<string, unknown[]>) {
  return fakeClient((p) => {
    if (p.startsWith("/me/playlists")) return { items: playlists, next: null };
    const m = /^\/playlists\/([A-Za-z0-9]+)\/items/.exec(p);
    if (m) return { items: items[m[1]] ?? [], next: null };
    return new Error("unexpected " + p);
  });
}

async function settle(ix: PlaylistIndex, releaseId = "r1") {
  await ix.forRelease(releaseId);
  await ix.idle();
  return ix.forRelease(releaseId);
}

describe("PlaylistIndex reading", () => {
  it("answers from the cache, matches through the resolver, sorts by name, ignores non-local items", async () => {
    const api = simpleApi(
      [
        { id: P1, name: "Night drive", snapshot_id: "s1" },
        { id: P2, name: "Gym", snapshot_id: "s2" },
      ],
      {
        [P1]: [localItem(uri("Artist", "Album", "Song One", 200)), { is_local: false, item: { uri: "spotify:track:abc" } }],
        [P2]: [localItem(uri("Artist", "Album", "Song One", 201)), localItem(uri("Nobody", "Nothing", "Zip", 1))],
      },
    );
    const ix = index(api);
    const first = await ix.forRelease("r1");
    expect(first).toEqual({ connected: true, tracks: {}, refreshing: true });
    await ix.idle();
    const second = await ix.forRelease("r1");
    expect(second.tracks).toEqual({ t1: [{ id: P2, name: "Gym" }, { id: P1, name: "Night drive" }] });
    expect(second.refreshing).toBe(false);
    // The other release has nothing.
    expect((await ix.forRelease("r2")).tracks).toEqual({});
  });

  it("falls back to tags (duration within 2 s) for local items without a spotify:local: uri", async () => {
    const api = simpleApi([{ id: P1, name: "Tagged", snapshot_id: "s1" }], {
      [P1]: [
        localItem(null, { name: "Song Two", artists: [{ name: "Artist" }], album: { name: "Album" }, duration_ms: 181_400 }),
        localItem(null, { name: "Song One", artists: [{ name: "Artist" }], album: { name: "Album" }, duration_ms: 230_000 }),
        localItem(null, { name: "Elsewhere", artists: [{ name: "Wrong" }], album: { name: "Other" }, duration_ms: 200_000 }),
      ],
    });
    const out = await settle(index(api));
    expect(out.tracks).toEqual({ t2: [{ id: P1, name: "Tagged" }] });
  });

  it("reads items only for playlists whose snapshot_id changed", async () => {
    let snap2 = "s2";
    const api = fakeClient((p) => {
      if (p.startsWith("/me/playlists")) {
        return { items: [{ id: P1, name: "A", snapshot_id: "s1" }, { id: P2, name: "B", snapshot_id: snap2 }], next: null };
      }
      return { items: [localItem(uri("Artist", "Album", "Song One", 200))], next: null };
    });
    const ix = index(api);
    await settle(ix);
    expect(api.calls.filter((c) => c.startsWith("/playlists/"))).toHaveLength(2);
    api.calls.length = 0;
    nowMs += STALE_AFTER_MS + 1;
    snap2 = "s2b";
    await settle(ix);
    const reads = api.calls.filter((c) => c.startsWith("/playlists/"));
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain(`/playlists/${P2}/items`);
    expect(reads[0]).toContain("limit=100");
  });

  it("follows next links on both endpoints and stops at the page caps", async () => {
    const api = fakeClient((p) => {
      if (p.includes("/me/playlists")) {
        return { items: [{ id: P1, name: "A", snapshot_id: "s" }], next: "https://api.spotify.com/v1/me/playlists?offset=50&limit=50" };
      }
      return { items: [localItem(uri("Artist", "Album", "Song One", 200))], next: "https://api.spotify.com/v1/playlists/x/items?offset=100" };
    });
    const ix = index(api);
    await settle(ix);
    expect(api.calls.filter((c) => c.includes("/me/playlists"))).toHaveLength(MAX_PLAYLIST_PAGES);
    expect(api.calls.filter((c) => c.includes("/items"))).toHaveLength(MAX_ITEM_PAGES);
  });

  it("pages through two pages of items", async () => {
    let page = 0;
    const api = fakeClient((p) => {
      if (p.startsWith("/me/playlists")) return { items: [{ id: P1, name: "A", snapshot_id: "s" }], next: null };
      page++;
      return page === 1
        ? { items: [localItem(uri("Artist", "Album", "Song One", 200))], next: "https://api.spotify.com/v1/playlists/x/items?offset=100" }
        : { items: [localItem(uri("Artist", "Album", "Song Two", 180))], next: null };
    });
    const out = await settle(index(api));
    expect(Object.keys(out.tracks).sort()).toEqual(["t1", "t2"]);
  });

  it("skips a playlist that answers 403 and keeps the rest", async () => {
    const api = fakeClient((p) => {
      if (p.startsWith("/me/playlists")) {
        return { items: [{ id: P1, name: "Theirs", snapshot_id: "s" }, { id: P2, name: "Mine", snapshot_id: "s" }], next: null };
      }
      if (p.includes(P1)) return new SpotifyApiError("http", "no", { status: 403 });
      return { items: [localItem(uri("Artist", "Album", "Song One", 200))], next: null };
    });
    const out = await settle(index(api));
    expect(out.tracks.t1).toEqual([{ id: P2, name: "Mine" }]);
  });
});

describe("PlaylistIndex refreshing", () => {
  it("kicks a stale refresh once, not twice", async () => {
    const api = simpleApi([{ id: P1, name: "A", snapshot_id: "s" }], {});
    const ix = index(api);
    await Promise.all([ix.forRelease("r1"), ix.forRelease("r1")]);
    await ix.idle();
    expect(api.calls.filter((c) => c.startsWith("/me/playlists"))).toHaveLength(1);
    // Fresh now: another look does not refresh.
    await ix.forRelease("r1");
    await ix.idle();
    expect(api.calls.filter((c) => c.startsWith("/me/playlists"))).toHaveLength(1);
    nowMs += STALE_AFTER_MS + 1;
    await ix.forRelease("r1");
    await ix.idle();
    expect(api.calls.filter((c) => c.startsWith("/me/playlists"))).toHaveLength(2);
  });

  it("waits out Retry-After on a 429, then goes on", async () => {
    let first = true;
    const api = fakeClient((p) => {
      if (p.startsWith("/me/playlists") && first) {
        first = false;
        return new SpotifyApiError("rateLimited", "slow", { retryAfterSec: 7, status: 429 });
      }
      return p.startsWith("/me/playlists")
        ? { items: [{ id: P1, name: "A", snapshot_id: "s" }], next: null }
        : { items: [localItem(uri("Artist", "Album", "Song One", 200))], next: null };
    });
    const sleeps: number[] = [];
    const out = await settle(index(api, sleeps));
    expect(sleeps).toEqual([7000]);
    expect(out.tracks.t1).toEqual([{ id: P1, name: "A" }]);
  });

  it("keeps the old cache on failure and does not retry at once", async () => {
    const api = simpleApi([{ id: P1, name: "A", snapshot_id: "s" }], { [P1]: [localItem(uri("Artist", "Album", "Song One", 200))] });
    const ix = index(api);
    await settle(ix);
    const before = structuredClone(store.cache);
    const failing = fakeClient(() => new SpotifyApiError("offline", "down"));
    const ix2 = index(failing);
    nowMs += STALE_AFTER_MS + 1;
    const out = await settle(ix2);
    expect(store.cache).toEqual(before);
    expect(out.tracks.t1).toEqual([{ id: P1, name: "A" }]);
    await ix2.forRelease("r1");
    await ix2.idle();
    expect(failing.calls).toHaveLength(1);
  });

  it("drops the cache when the connection revision changes or Spotify is disconnected", async () => {
    const api = simpleApi([{ id: P1, name: "A", snapshot_id: "s" }], { [P1]: [localItem(uri("Artist", "Album", "Song One", 200))] });
    const ix = index(api);
    await settle(ix);
    expect(store.cache?.revision).toBe(SAMPLE_SPOTIFY.revision);

    settings.value = { ...settings.value, spotify: { ...SAMPLE_SPOTIFY, revision: "rev-B" } };
    const stale = await ix.forRelease("r1");
    expect(stale.tracks).toEqual({});
    await ix.idle();
    expect(store.cache?.revision).toBe("rev-B");

    const { spotify: _s, ...rest } = settings.value;
    void _s;
    settings.value = rest;
    expect(await ix.forRelease("r1")).toEqual({ connected: false, tracks: {}, refreshing: false });
    expect(store.cache).toBeNull();
  });

  it("writes nothing when the user disconnects during a refresh", async () => {
    const api = fakeClient((p) => {
      if (p.startsWith("/me/playlists")) {
        const { spotify: _s, ...rest } = settings.value;
        void _s;
        settings.value = rest;
        return { items: [], next: null };
      }
      return { items: [], next: null };
    });
    const ix = index(api);
    await ix.forRelease("r1");
    await ix.idle();
    expect(store.writes).toBe(0);
  });
});

describe("FilePlaylistCacheStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "locally-pl-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const sample: PlaylistCache = {
    revision: "r",
    fetchedAt: 5,
    playlists: { [P1]: { snapshotId: "s", name: "A", localUris: ["spotify:local:a:b:c:1"] } },
  };

  it("writes a mode 0600 file, by rename, and reads it back", async () => {
    const file = path.join(dir, "cfg", "spotify-playlists.json");
    const s = new FilePlaylistCacheStore(() => file);
    await s.write(sample);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect((await fs.readdir(path.dirname(file))).filter((f) => f.includes(".tmp-"))).toEqual([]);
    expect(await s.read()).toEqual(sample);
  });

  it("reads a corrupt file as no cache, and removes the file", async () => {
    const file = path.join(dir, "spotify-playlists.json");
    const s = new FilePlaylistCacheStore(() => file);
    await fs.writeFile(file, "{nope");
    expect(await s.read()).toBeNull();
    await s.write(sample);
    await s.remove();
    await expect(fs.stat(file)).rejects.toThrow();
    await s.remove();
  });
});
