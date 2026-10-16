import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseFile } from "music-metadata";
import { isDiscNumber } from "../../shared/discs";
import type { LibraryRepository } from "../storage/LibraryRepository";
import { buildLocalId } from "./localId";
import type { AdoptProposal, ProposedGroup, ProposedTrack } from "./types";

const AUDIO_EXTS = new Set([".mp3", ".m4a", ".mp4"]);

/** What the scanner needs from one file. `albumArtist` is TPE2/aART, which `TagService.read` doesn't return. */
export interface AdoptFileTags {
  title: string | null;
  artist: string | null;
  albumArtist: string | null;
  album: string | null;
  year: string | null;
  genre: string | null;
  trackNumber: number | null;
  discNumber: number | null;
  durationSec: number | null;
  hasCover: boolean;
  /** True for an mp4 that carries a video track. */
  hasVideo: boolean;
}

export type AdoptTagReader = (filePath: string) => Promise<AdoptFileTags>;

function clean(s: string | undefined | null): string | null {
  const t = s?.normalize("NFC").trim();
  return t ? t : null;
}

/** Reads mp3 (ID3) and m4a/mp4 (iTunes atoms) with `music-metadata` (already a dependency); read only. */
export const readAdoptTags: AdoptTagReader = async (filePath) => {
  const meta = await parseFile(filePath);
  const c = meta.common;
  const yearMatch = /\d{4}/.exec(c.year != null ? String(c.year) : (c.date ?? ""));
  return {
    title: clean(c.title),
    artist: clean(c.artist),
    albumArtist: clean(c.albumartist),
    album: clean(c.album),
    year: yearMatch ? yearMatch[0] : null,
    genre: clean(c.genre?.[0]),
    trackNumber: c.track?.no ?? null,
    discNumber: isDiscNumber(c.disk?.no) ? (c.disk.no as number) : null,
    durationSec: meta.format.duration ?? null,
    hasCover: Array.isArray(c.picture) && c.picture.length > 0,
    hasVideo: meta.format.hasVideo === true,
  };
};

export interface AdoptScannerOptions {
  library: LibraryRepository;
  libraryDir: string;
  readTags?: AdoptTagReader;
  now?: () => Date;
}

interface ScannedFile {
  path: string;
  folder: string;
  tags: AdoptFileTags;
  durationSec: number;
}

function isInsideOrSame(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function realpathOrNull(p: string): Promise<string | null> {
  try {
    return await fs.realpath(p);
  } catch {
    return null;
  }
}

function extOf(file: string): string {
  return path.extname(file).toLowerCase() || "(none)";
}

function hashKey(folder: string, groupKey: string): string {
  return createHash("sha1").update(folder).update("\0").update(groupKey).digest("hex").slice(0, 16);
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, n] of counts) {
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return best;
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/**
 * Walks the chosen folders and proposes releases (#245 decisions 2 to 5). Read only: it never writes, moves or
 * re-tags a file, never follows a symlink that leaves its root, skips hidden entries, the library folder and
 * files already in the library.
 */
export class AdoptScanner {
  private readonly readTags: AdoptTagReader;
  private readonly now: () => Date;

  constructor(private readonly opts: AdoptScannerOptions) {
    this.readTags = opts.readTags ?? readAdoptTags;
    this.now = opts.now ?? (() => new Date());
  }

  async scan(roots: string[]): Promise<AdoptProposal> {
    const skipped: Record<string, number> = {};
    const count = (ext: string) => {
      skipped[ext] = (skipped[ext] ?? 0) + 1;
    };

    const libraryReal = await realpathOrNull(this.opts.libraryDir);
    const inLibrary = new Set<string>();
    for (const release of await this.opts.library.list(this.opts.libraryDir)) {
      for (const track of release.tracks) {
        const real = await realpathOrNull(track.filePath);
        inLibrary.add(real ?? path.resolve(track.filePath));
      }
    }

    const realRoots: string[] = [];
    const seenFiles = new Set<string>();
    const seenDirs = new Set<string>();
    const files: ScannedFile[] = [];

    const walk = async (dir: string, root: string): Promise<void> => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => collator.compare(a.name, b.name));
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        let full = path.join(dir, entry.name);
        let isDir = entry.isDirectory();
        let isFile = entry.isFile();
        if (entry.isSymbolicLink()) {
          const target = await realpathOrNull(full);
          if (!target || !isInsideOrSame(root, target)) continue;
          const st = await fs.stat(target).catch(() => null);
          if (!st) continue;
          full = target;
          isDir = st.isDirectory();
          isFile = st.isFile();
        }
        if (isDir) {
          const real = await realpathOrNull(full);
          if (!real || !isInsideOrSame(root, real) || seenDirs.has(real)) continue;
          if (libraryReal && isInsideOrSame(libraryReal, real)) continue;
          seenDirs.add(real);
          await walk(real, root);
        } else if (isFile) {
          const ext = extOf(entry.name);
          if (!AUDIO_EXTS.has(ext)) {
            count(ext);
            continue;
          }
          const real = await realpathOrNull(full);
          if (!real || !isInsideOrSame(root, real) || seenFiles.has(real)) continue;
          seenFiles.add(real);
          if (inLibrary.has(real)) continue;
          let tags: AdoptFileTags;
          try {
            tags = await this.readTags(real);
          } catch {
            count(ext);
            continue;
          }
          if (ext === ".mp4" && tags.hasVideo) {
            count(ext);
            continue;
          }
          files.push({ path: real, folder: path.dirname(real), tags, durationSec: tags.durationSec ?? 0 });
        }
      }
    };

    for (const root of roots) {
      const real = await realpathOrNull(root);
      if (!real || realRoots.includes(real)) continue;
      const st = await fs.stat(real).catch(() => null);
      if (!st?.isDirectory()) continue;
      if (libraryReal && isInsideOrSame(libraryReal, real)) continue;
      realRoots.push(real);
      seenDirs.add(real);
      await walk(real, real);
    }

    return {
      scannedAt: this.now().toISOString(),
      roots: realRoots,
      groups: this.group(files),
      skipped,
    };
  }

  private group(files: ScannedFile[]): ProposedGroup[] {
    const byFolder = new Map<string, ScannedFile[]>();
    for (const f of files) {
      const list = byFolder.get(f.folder) ?? [];
      list.push(f);
      byFolder.set(f.folder, list);
    }
    const groups: ProposedGroup[] = [];
    for (const [folder, inFolder] of [...byFolder].sort((a, b) => collator.compare(a[0], b[0]))) {
      const buckets = new Map<string, ScannedFile[]>();
      for (const f of inFolder) {
        const key = f.tags.album
          ? `album\0${f.tags.albumArtist ?? ""}\0${f.tags.album}`
          : `file\0${path.basename(f.path)}`;
        const list = buckets.get(key) ?? [];
        list.push(f);
        buckets.set(key, list);
      }
      for (const [groupKey, members] of buckets) groups.push(this.makeGroup(folder, groupKey, members));
    }
    return groups;
  }

  private makeGroup(folder: string, groupKey: string, members: ScannedFile[]): ProposedGroup {
    const sorted = [...members].sort(
      (a, b) =>
        (a.tags.discNumber ?? 0) - (b.tags.discNumber ?? 0) ||
        (a.tags.trackNumber ?? Number.MAX_SAFE_INTEGER) - (b.tags.trackNumber ?? Number.MAX_SAFE_INTEGER) ||
        collator.compare(path.basename(a.path), path.basename(b.path))
    );
    const first = sorted[0];
    const album = first.tags.album;
    const fileTitle = (f: ScannedFile) => f.tags.title ?? path.basename(f.path, path.extname(f.path));
    const artist =
      first.tags.albumArtist ??
      mostCommon(sorted.map((f) => f.tags.artist).filter((a): a is string => !!a)) ??
      "";
    const tracks: ProposedTrack[] = sorted.map((f, i) => {
      const t: ProposedTrack = {
        path: f.path,
        title: fileTitle(f),
        trackNumber: f.tags.trackNumber ?? i + 1,
        durationSec: f.durationSec,
        localId: buildLocalId(f.tags.artist ?? "", f.tags.album ?? "", fileTitle(f), f.durationSec),
      };
      if (f.tags.discNumber != null) t.discNumber = f.tags.discNumber;
      return t;
    });
    const isAlbum = !!album && sorted.length >= 2;
    return {
      key: hashKey(folder, groupKey),
      folder,
      kind: isAlbum ? "album" : "single",
      title: album ?? fileTitle(first),
      artist,
      year: sorted.map((f) => f.tags.year).find((y) => y) ?? null,
      genre: sorted.map((f) => f.tags.genre).find((g) => g) ?? null,
      coverFrom: sorted.find((f) => f.tags.hasCover)?.path ?? null,
      tracks,
    };
  }
}
