import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseFile } from "music-metadata";
import { NotFoundError, ValidationError } from "../../shared/errors";
import type { Release, Track } from "../../shared/types";
import { adoptedCoversDir } from "../config/paths";
import type { SettingsStore } from "../config/SettingsStore";
import type { FileSystem } from "../fs/FileSystem";
import type { LibraryRepository } from "../storage/LibraryRepository";
import { AdoptScanner, type AdoptTagReader } from "./AdoptScanner";
import type { AdoptProposal, ProposedGroup } from "./types";

/** What the service needs from the proposal store (`FileAdoptProposalStore` implements it). */
export interface AdoptProposalStore {
  save(proposal: AdoptProposal): Promise<void>;
  load(): Promise<AdoptProposal | null>;
}

/** Bytes of the first embedded picture of an audio file, or null. Read only. */
export type CoverExtractor = (audioPath: string) => Promise<{ bytes: Uint8Array; format: string } | null>;

export const extractEmbeddedCover: CoverExtractor = async (audioPath) => {
  const meta = await parseFile(audioPath);
  const pic = meta.common.picture?.[0];
  return pic ? { bytes: pic.data, format: pic.format } : null;
};

export interface AdoptServiceOptions {
  settings: SettingsStore;
  library: LibraryRepository;
  fs: FileSystem;
  proposals: AdoptProposalStore;
  /** Test seam: the tag reader the scanner uses. */
  readTags?: AdoptTagReader;
  extractCover?: CoverExtractor;
  /** Test seam; defaults to Locally's `adopted-covers` app-data folder. */
  coversDir?: () => string;
}

export interface AdoptResult {
  releases: Release[];
  /** Keys of groups that were already adopted (nothing added). */
  alreadyAdopted: string[];
  /** Keys that are not in the stored proposal. */
  unknown: string[];
}

/**
 * Adopt in place (#245): turns accepted scanner groups into library releases whose files stay where they
 * are. It reads the audio files and writes only Locally's own data (`library.json`, copied covers).
 */
export class AdoptService {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly extractCover: CoverExtractor;
  private readonly coversDir: () => string;

  constructor(private readonly opts: AdoptServiceOptions) {
    this.extractCover = opts.extractCover ?? extractEmbeddedCover;
    this.coversDir = opts.coversDir ?? adoptedCoversDir;
  }

  /** One adopt or scan at a time, so two requests can't both add the same group. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  async proposal(): Promise<AdoptProposal | null> {
    return this.opts.proposals.load();
  }

  /**
   * Scans the saved roots again and stores the proposal. An adopted track whose file is gone is marked
   * `missing` (and unmarked when it comes back); it is never deleted.
   */
  scan(): Promise<AdoptProposal> {
    return this.serial(async () => {
      const settings = await this.opts.settings.get();
      const roots = settings.adoptRoots ?? [];
      if (roots.length === 0) throw new ValidationError("Add a folder to scan first");
      const scanner = new AdoptScanner({
        library: this.opts.library,
        libraryDir: settings.libraryDir,
        ...(this.opts.readTags ? { readTags: this.opts.readTags } : {}),
      });
      const proposal = await scanner.scan(roots);
      await this.opts.proposals.save(proposal);
      await this.markMissing(settings.libraryDir);
      return proposal;
    });
  }

  private async markMissing(libraryDir: string): Promise<void> {
    for (const release of await this.opts.library.list(libraryDir)) {
      if (!release.adopted) continue;
      let changed = false;
      const tracks: Track[] = [];
      for (const track of release.tracks) {
        const missing = !(await this.opts.fs.exists(track.filePath));
        if (missing === (track.missing === true)) {
          tracks.push(track);
          continue;
        }
        changed = true;
        const next: Track = { ...track };
        if (missing) next.missing = true;
        else delete next.missing;
        tracks.push(next);
      }
      // updatedAt is left alone: a file going missing is not a change to push.
      if (changed) await this.opts.library.upsert(libraryDir, { ...release, tracks });
    }
  }

  /** Adopts the groups of the stored proposal named by `keys`. Adopting a group twice adds nothing. */
  adopt(keys: string[]): Promise<AdoptResult> {
    return this.serial(async () => {
      const proposal = await this.opts.proposals.load();
      if (!proposal) throw new NotFoundError("No scan to adopt from; check for new files first");
      const settings = await this.opts.settings.get();
      const libraryDir = settings.libraryDir;
      const roots = settings.adoptRoots ?? [];
      const byKey = new Map(proposal.groups.map((g) => [g.key, g]));
      const existing = await this.opts.library.list(libraryDir);
      const adoptedKeys = new Set(existing.flatMap((r) => (r.adoptKey ? [r.adoptKey] : [])));
      const adoptedPaths = new Set(existing.filter((r) => r.adopted).flatMap((r) => r.tracks.map((t) => t.filePath)));

      const result: AdoptResult = { releases: [], alreadyAdopted: [], unknown: [] };
      for (const key of new Set(keys)) {
        const group = byKey.get(key);
        if (!group) {
          result.unknown.push(key);
          continue;
        }
        if (adoptedKeys.has(key) || group.tracks.every((t) => adoptedPaths.has(t.path))) {
          result.alreadyAdopted.push(key);
          continue;
        }
        const release = await this.build(group, roots);
        await this.opts.library.upsert(libraryDir, release);
        adoptedKeys.add(key);
        for (const t of release.tracks) adoptedPaths.add(t.filePath);
        result.releases.push(release);
      }
      return result;
    });
  }

  private assertInsideRoots(roots: string[], target: string): void {
    if (!roots.some((root) => this.opts.fs.isInside(root, target))) {
      throw new ValidationError("That file is not inside one of your adopted folders");
    }
  }

  private async build(group: ProposedGroup, roots: string[]): Promise<Release> {
    this.assertInsideRoots(roots, group.folder);
    for (const t of group.tracks) this.assertInsideRoots(roots, t.path);
    if (group.coverFrom) this.assertInsideRoots(roots, group.coverFrom);

    const id = crypto.randomUUID();
    const coverPath = await this.copyCover(id, group.coverFrom);
    const now = new Date().toISOString();
    return {
      id,
      kind: group.kind,
      title: group.title,
      artist: group.artist,
      year: group.year,
      genre: group.genre,
      coverPath,
      folderPath: group.folder,
      tracks: group.tracks.map((t) => ({
        id: crypto.randomUUID(),
        title: t.title,
        trackNumber: t.trackNumber,
        ...(t.discNumber !== undefined ? { discNumber: t.discNumber } : {}),
        filePath: t.path,
        originalName: path.basename(t.path),
        durationSec: t.durationSec,
        localId: t.localId,
      })),
      createdAt: now,
      updatedAt: now,
      adopted: true,
      adoptKey: group.key,
    };
  }

  /** Copies the embedded art into app data as `<releaseId>.jpg` (`.png` for a PNG). Null when there is none. */
  private async copyCover(releaseId: string, from: string | null): Promise<string | null> {
    if (!from) return null;
    let art: { bytes: Uint8Array; format: string } | null;
    try {
      art = await this.extractCover(from);
    } catch {
      return null;
    }
    if (!art || art.bytes.length === 0) return null;
    const dir = this.coversDir();
    const dest = path.join(dir, `${releaseId}.${/png/i.test(art.format) ? "png" : "jpg"}`);
    if (!this.opts.fs.isInside(dir, dest)) throw new ValidationError("Refusing to write outside Locally's data folder");
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(dest, art.bytes, { mode: 0o600 });
    return dest;
  }
}
