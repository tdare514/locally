import fs from "node:fs/promises";
import path from "node:path";
import { spotifyPlaylistsFilePath } from "../config/paths";
import { SPOTIFY_API_BASE } from "./SpotifyClient";

const FILE_MODE = 0o600;

export interface CachedPlaylist {
  snapshotId: string;
  name: string;
  /** `spotify:local:artist:album:title:seconds` ids of the playlist's local files. */
  localUris: string[];
  /** False when reading stopped at the item cap: the next refresh reads it again. Absent means complete. */
  complete?: boolean;
  /** With `complete: false`: the Spotify `next` URL where reading stopped; the next refresh resumes there. */
  next?: string;
}

export interface PlaylistCache {
  /** The Spotify connection this cache was read for; a different connection drops it. */
  revision: string;
  /** Epoch ms of the last complete refresh. */
  fetchedAt: number;
  playlists: Record<string, CachedPlaylist>;
}

export interface PlaylistCacheStore {
  read(): Promise<PlaylistCache | null>;
  write(cache: PlaylistCache): Promise<void>;
  remove(): Promise<void>;
}

function isCache(v: unknown): v is PlaylistCache {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  if (typeof c.revision !== "string" || typeof c.fetchedAt !== "number") return false;
  if (!c.playlists || typeof c.playlists !== "object") return false;
  return Object.values(c.playlists as Record<string, unknown>).every((p) => {
    const e = p as Partial<CachedPlaylist> | null;
    return (
      !!e &&
      typeof e.snapshotId === "string" &&
      typeof e.name === "string" &&
      (e.complete === undefined || typeof e.complete === "boolean") &&
      (e.next === undefined || typeof e.next === "string") &&
      Array.isArray(e.localUris) &&
      e.localUris.every((u) => typeof u === "string")
    );
  });
}

/** `spotify-playlists.json` in the config dir: mode 0600, written by tmp + rename. */
export class FilePlaylistCacheStore implements PlaylistCacheStore {
  constructor(private readonly file: () => string = spotifyPlaylistsFilePath) {}

  async read(): Promise<PlaylistCache | null> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.file(), "utf-8"));
      if (!isCache(parsed)) return null;
      // A saved cursor is only trusted if it is a Spotify playlist URL on an incomplete entry;
      // otherwise that entry is dropped and read again from page one.
      for (const [id, e] of Object.entries(parsed.playlists)) {
        if (e.next === undefined) continue;
        if (e.complete !== false || !e.next.startsWith(`${SPOTIFY_API_BASE}/playlists/`)) delete parsed.playlists[id];
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async write(cache: PlaylistCache): Promise<void> {
    const file = this.file();
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await fs.writeFile(tmp, JSON.stringify(cache), { encoding: "utf-8", mode: FILE_MODE });
    await fs.chmod(tmp, FILE_MODE);
    await fs.rename(tmp, file);
  }

  async remove(): Promise<void> {
    await fs.rm(this.file(), { force: true });
  }
}
