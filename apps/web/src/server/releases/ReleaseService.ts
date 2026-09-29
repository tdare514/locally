import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import type { ImportMeta, Release, Track, UpdateReleaseMeta } from "../../shared/types";
import { ValidationError, NotFoundError } from "../../shared/errors";
import type { SettingsStore } from "../config/SettingsStore";
import type { LibraryRepository } from "../storage/LibraryRepository";
import type { AudioConverter } from "../audio/AudioConverter";
import type { TagService } from "../audio/TagService";
import type { FileSystem } from "../fs/FileSystem";
import { ReleaseLayout } from "./ReleaseLayout";
import { sniffImageMime } from "../http/validation";
import { NoopReleaseSyncHooks, type ReleaseSyncHooks } from "./ReleaseSyncHooks";
import type { SyncRecord } from "../sync/SyncRecord";

/**
 * Core release lifecycle: import, edit, re-cover, delete, and look up. All
 * collaborators are injected so this class can be unit tested with fakes
 * (in-memory repository, a converter that just copies bytes, a recording tag
 * service) against a real temp directory via `NodeFileSystem`.
 */
export class ReleaseService {
  private syncHooks: ReleaseSyncHooks = new NoopReleaseSyncHooks();

  constructor(
    private readonly settings: SettingsStore,
    private readonly repo: LibraryRepository,
    private readonly converter: AudioConverter,
    private readonly tags: TagService,
    private readonly fs: FileSystem,
    private readonly layout: ReleaseLayout = new ReleaseLayout()
  ) {}

  /**
   * Wire in the real sync engine after construction (see `ReleaseSyncHooks`
   * for why this isn't a constructor parameter). Existing callers (tests,
   * `InspectService`) that never call this keep the default no-op hooks.
   */
  setSyncHooks(hooks: ReleaseSyncHooks): void {
    this.syncHooks = hooks;
  }

  /** Import a new release (single or album). */
  async import(meta: ImportMeta, coverFile: File | null, audioFiles: File[]): Promise<Release> {
    if (meta.kind === "single" && audioFiles.length !== 1) {
      throw new ValidationError("A single must have exactly one audio file");
    }
    if (meta.kind === "album" && audioFiles.length < 1) {
      throw new ValidationError("An album must have at least one audio file");
    }
    if (audioFiles.length !== meta.tracks.length) {
      throw new ValidationError("Number of tracks in meta does not match number of audio files");
    }

    const settings = await this.settings.get();
    const libraryDir = settings.libraryDir;

    const albumTitle =
      meta.title && meta.title.trim().length > 0 ? meta.title.trim() : meta.tracks[0]?.title?.trim() ?? "";

    const desiredFolder = this.layout.folderFor(libraryDir, meta.artist, albumTitle);
    const folderPath = await this.fs.uniqueDir(desiredFolder);
    // Checked before anything is created, so the rollback below never touches an outside path.
    this.assertInsideLibrary(libraryDir, folderPath);

    // Resolve every track's destination file name up front and refuse before writing anything
    // if two collide (case-insensitive, since macOS is case-insensitive): otherwise the second
    // safeMove into the same path silently overwrites the first track's file.
    const trackNumbers = meta.tracks.map((t, i) => t.trackNumber ?? i + 1);
    const titles = meta.tracks.map((t, i) => t.title?.trim() || `Track ${trackNumbers[i]}`);
    const destFileNames = trackNumbers.map((n, i) => this.layout.trackFileName(n, titles[i]));
    this.assertNoDuplicateFileNames(destFileNames);

    await this.fs.mkdirp(folderPath);

    const tempDir = await this.fs.makeTempDir("sli-import-");
    try {
      // Save cover, if provided.
      let coverPath: string | null = null;
      if (coverFile) {
        const name = this.layout.coverFileName((await sniffImageMime(coverFile)) ?? coverFile.type);
        coverPath = path.join(folderPath, name);
        this.assertInsideLibrary(libraryDir, coverPath);
        const tempCover = path.join(tempDir, name);
        await this.fs.saveWebFile(coverFile, tempCover);
        await this.fs.safeMove(tempCover, coverPath);
      }

      const trackTotal = audioFiles.length;
      const tracks: Track[] = [];

      for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i];
        const trackNumber = trackNumbers[i];
        const title = titles[i];

        const originalExt = path.extname(file.name) || ".dat";
        const tempInput = path.join(tempDir, `in-${i}${originalExt}`);
        await this.fs.saveWebFile(file, tempInput);

        const destFileName = destFileNames[i];
        const destPath = path.join(folderPath, destFileName);
        this.assertInsideLibrary(libraryDir, destPath);
        const tempOutput = path.join(tempDir, `out-${i}.mp3`);

        await this.converter.toMp3(tempInput, tempOutput);
        await this.fs.safeMove(tempOutput, destPath);

        await this.tags.write(destPath, {
          title,
          artist: meta.artist,
          albumArtist: meta.artist,
          album: albumTitle,
          year: meta.year ?? null,
          genre: meta.genre ?? null,
          trackNumber,
          trackTotal,
          coverPath,
        });

        let durationSec: number | null = null;
        try {
          const t = await this.tags.read(destPath);
          durationSec = t.durationSec;
        } catch {
          durationSec = null;
        }

        tracks.push({
          id: crypto.randomUUID(),
          title,
          trackNumber,
          filePath: destPath,
          originalName: file.name,
          durationSec,
        });
      }

      tracks.sort((a, b) => a.trackNumber - b.trackNumber);

      const now = new Date().toISOString();
      const release: Release = {
        id: crypto.randomUUID(),
        kind: meta.kind,
        title: albumTitle,
        artist: meta.artist,
        year: meta.year ?? null,
        genre: meta.genre ?? null,
        coverPath,
        folderPath,
        tracks,
        createdAt: now,
        updatedAt: now,
      };

      await this.repo.upsert(libraryDir, release);
      this.syncHooks.onImported(release);
      return release;
    } catch (err) {
      // Roll back the partially written release folder so a failed conversion
      // never leaves orphaned files that Spotify would still pick up.
      await this.fs.removeRecursive(folderPath).catch(() => undefined);
      // Also drop the artist folder if this was its only release.
      const artistDir = path.dirname(folderPath);
      if (artistDir !== path.resolve(libraryDir)) {
        await fs.rmdir(artistDir).catch(() => undefined); // rmdir only succeeds when empty
      }
      throw err;
    } finally {
      await this.fs.removeRecursive(tempDir);
    }
  }

  /**
   * Update release metadata by rewriting the tags in every track file IN PLACE.
   * Files and folders are never renamed or moved on edit: Spotify playlists reference
   * local tracks by path, so a rename would silently drop the track from every playlist.
   * The folder and file names therefore reflect the metadata at import time, and
   * `Track.filePath` stays stable for the life of the release.
   */
  async update(id: string, patch: UpdateReleaseMeta): Promise<Release> {
    const settings = await this.settings.get();
    const libraryDir = settings.libraryDir;

    const existing = await this.repo.find(libraryDir, id);
    if (!existing) {
      throw new NotFoundError(`Release ${id} not found`);
    }

    const newArtist = patch.artist !== undefined ? patch.artist : existing.artist;
    const newTitle = patch.title !== undefined ? patch.title : existing.title;
    const newYear = patch.year !== undefined ? patch.year : existing.year;
    const newGenre = patch.genre !== undefined ? patch.genre : existing.genre;

    const patchTrackById = new Map((patch.tracks ?? []).map((t) => [t.id, t]));
    const updatedTracks: Track[] = existing.tracks.map((t) => {
      const p = patchTrackById.get(t.id);
      if (!p) return { ...t };
      return {
        ...t,
        title: p.title !== undefined ? p.title : t.title,
        trackNumber: p.trackNumber !== undefined ? p.trackNumber : t.trackNumber,
      };
    });
    updatedTracks.sort((a, b) => a.trackNumber - b.trackNumber);

    const folderPath = existing.folderPath;
    const coverPath = existing.coverPath;
    // These paths come from the index on disk; never touch a file it points outside the library.
    this.assertInsideLibrary(libraryDir, folderPath);
    if (coverPath) this.assertInsideLibrary(libraryDir, coverPath);
    for (const t of updatedTracks) this.assertInsideLibrary(libraryDir, t.filePath);

    const trackTotal = updatedTracks.length;
    for (const t of updatedTracks) {
      await this.tags.write(t.filePath, {
        title: t.title,
        artist: newArtist,
        albumArtist: newArtist,
        album: newTitle,
        year: newYear ?? null,
        genre: newGenre ?? null,
        trackNumber: t.trackNumber,
        trackTotal,
        coverPath,
      });
    }

    const updated: Release = {
      ...existing,
      title: newTitle,
      artist: newArtist,
      year: newYear ?? null,
      genre: newGenre ?? null,
      folderPath,
      coverPath,
      tracks: updatedTracks,
      updatedAt: new Date().toISOString(),
    };

    await this.repo.upsert(libraryDir, updated);
    this.syncHooks.onUpdated(updated);
    return updated;
  }

  /** Replace the cover image for a release and re-embed it into every track's tags. */
  async replaceCover(id: string, file: File): Promise<Release> {
    const settings = await this.settings.get();
    const libraryDir = settings.libraryDir;

    const existing = await this.repo.find(libraryDir, id);
    if (!existing) {
      throw new NotFoundError(`Release ${id} not found`);
    }

    const name = this.layout.coverFileName((await sniffImageMime(file)) ?? file.type);
    const newCoverPath = path.join(existing.folderPath, name);
    // Same rule as update(): the index on disk is not trusted to point inside the library.
    this.assertInsideLibrary(libraryDir, existing.folderPath);
    this.assertInsideLibrary(libraryDir, newCoverPath);
    for (const t of existing.tracks) this.assertInsideLibrary(libraryDir, t.filePath);

    // Remove old cover if it has a different name/extension than the new one.
    if (existing.coverPath && existing.coverPath !== newCoverPath) {
      this.assertInsideLibrary(libraryDir, existing.coverPath);
      await this.fs.removeRecursive(existing.coverPath);
    }

    await this.fs.saveWebFile(file, newCoverPath);

    const trackTotal = existing.tracks.length;
    for (const t of existing.tracks) {
      await this.tags.write(t.filePath, {
        title: t.title,
        artist: existing.artist,
        albumArtist: existing.artist,
        album: existing.title,
        year: existing.year,
        genre: existing.genre,
        trackNumber: t.trackNumber,
        trackTotal,
        coverPath: newCoverPath,
      });
    }

    const updated: Release = {
      ...existing,
      coverPath: newCoverPath,
      updatedAt: new Date().toISOString(),
    };
    await this.repo.upsert(libraryDir, updated);
    this.syncHooks.onCoverReplaced(updated);
    return updated;
  }

  /**
   * Every write/delete target must sit strictly beneath the library dir, however it was
   * derived (sanitised names, or the index on disk). Same shape as the guard in `delete()`.
   */
  private assertInsideLibrary(libraryDir: string, target: string): void {
    if (!this.fs.isInside(libraryDir, target) || path.resolve(target) === path.resolve(libraryDir)) {
      throw new ValidationError("Refusing to write outside the library directory");
    }
  }

  /**
   * Two tracks with the same track number and titles that sanitise identically (e.g. differing
   * only in case, or in characters `sanitizeSegment` strips) would produce the same destination
   * file name. macOS's default filesystem is case-insensitive, so names are compared that way
   * too. Called before any file is moved into the release folder, so a colliding import fails
   * cleanly instead of one track's file silently overwriting another's.
   */
  private assertNoDuplicateFileNames(names: string[]): void {
    const seen = new Set<string>();
    for (const name of names) {
      const key = name.toLowerCase();
      if (seen.has(key)) {
        throw new ValidationError(`Two tracks would both be named "${name}"`);
      }
      seen.add(key);
    }
  }

  /** Delete a release: removes its folder from disk and the library index entry. */
  async delete(id: string): Promise<void> {
    const settings = await this.settings.get();
    const libraryDir = settings.libraryDir;

    const existing = await this.repo.find(libraryDir, id);
    if (!existing) {
      throw new NotFoundError(`Release ${id} not found`);
    }
    // Never delete anything that is not a release folder inside the library. `folderFor`
    // always produces libraryDir/artist/album (2 segments), so anything shallower (an
    // artist folder) or deeper (something inside a release folder) is rejected too - an
    // index entry with a tampered `folderPath` must not be able to make delete() remove
    // every release by one artist, or an unrelated directory nested under a release.
    const rel = path.relative(path.resolve(libraryDir), path.resolve(existing.folderPath));
    const depth = rel.split(path.sep).length;
    if (!this.fs.isInside(libraryDir, existing.folderPath) || rel === "" || depth !== 2) {
      throw new ValidationError("Refusing to delete a folder outside the library");
    }
    await this.repo.remove(libraryDir, id);
    await this.fs.removeRecursive(existing.folderPath);
    this.syncHooks.onDeleted(existing);
  }

  async get(id: string): Promise<Release | null> {
    const settings = await this.settings.get();
    return this.repo.find(settings.libraryDir, id);
  }

  /**
   * Bytes and MIME type of a release's cover, for GET /api/releases/:id/cover.
   * Returns null when there is no usable cover: none recorded, or a `coverPath` that is not
   * strictly inside the library. That path came off the on-disk index, which is not trusted, and
   * the same null for both stops a caller probing for files outside the library. Throws
   * NotFoundError when the release is unknown or the cover file is gone from disk.
   */
  async readCover(id: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    const settings = await this.settings.get();
    const release = await this.repo.find(settings.libraryDir, id);
    if (!release) throw new NotFoundError(`Release ${id} not found`);
    if (!release.coverPath) return null;
    const coverPath = release.coverPath;
    if (
      !this.fs.isInside(settings.libraryDir, coverPath) ||
      path.resolve(coverPath) === path.resolve(settings.libraryDir)
    ) {
      return null;
    }
    let bytes: Buffer;
    try {
      bytes = await this.fs.readFile(coverPath);
    } catch {
      throw new NotFoundError("Cover file is missing on disk");
    }
    const contentType = path.extname(coverPath).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
    return { bytes, contentType };
  }

  async list(): Promise<Release[]> {
    const settings = await this.settings.get();
    return this.repo.list(settings.libraryDir);
  }

  /**
   * Import a release that came from the sync service (originally created on
   * the phone), keeping the SAME id so it's recognised as the same release on
   * every device from then on. `dir` already holds the downloaded track/cover
   * files, named exactly as `record.tracks[].file`/`record.cover`. Those names
   * came off the network, so each is accepted only as a plain child of `dir`
   * (`ReleaseLayout.assertPlainFileName`, then `isInside`) - a `../x` there
   * would otherwise read, and via `safeMove` destroy, a file outside the
   * download dir. mp3 tracks pass through untouched; anything else (m4a from
   * iOS) is converted with the same `AudioConverter` used for normal imports.
   * Never pushed back to sync by this method itself - the caller
   * (`SyncEngine`) owns that bookkeeping.
   */
  async importSynced(record: SyncRecord, dir: string): Promise<Release> {
    const settings = await this.settings.get();
    const libraryDir = settings.libraryDir;

    // Resolve every source first, so a hostile record fails before anything is created.
    const srcCover = record.cover ? this.syncedSource(dir, record.cover) : null;
    const sortedTracks = [...record.tracks].sort((a, b) => a.trackNumber - b.trackNumber);
    const sources = sortedTracks.map((t) => this.syncedSource(dir, t.file));

    const desiredFolder = this.layout.folderFor(libraryDir, record.artist, record.title);
    const folderPath = await this.fs.uniqueDir(desiredFolder);
    this.assertInsideLibrary(libraryDir, folderPath);
    // Same collision guard as `import()`, and just as necessary here: `sortedTracks` comes
    // straight off the network record.
    this.assertNoDuplicateFileNames(sortedTracks.map((t) => this.layout.trackFileName(t.trackNumber, t.title)));
    await this.fs.mkdirp(folderPath);

    try {
      let coverPath: string | null = null;
      if (srcCover && record.cover) {
        const name = this.layout.coverFileName(record.cover);
        coverPath = path.join(folderPath, name);
        this.assertInsideLibrary(libraryDir, coverPath);
        await this.fs.safeMove(srcCover, coverPath);
      }

      const trackTotal = sortedTracks.length;
      const tracks: Track[] = [];

      for (let i = 0; i < sortedTracks.length; i++) {
        const t = sortedTracks[i];
        const srcPath = sources[i];
        const ext = path.extname(t.file).toLowerCase();
        const destFileName = this.layout.trackFileName(t.trackNumber, t.title);
        const destPath = path.join(folderPath, destFileName);
        this.assertInsideLibrary(libraryDir, destPath);

        if (ext === ".mp3") {
          await this.fs.safeMove(srcPath, destPath);
        } else {
          // Named by position, not `t.id`: the id is network-supplied and could carry separators.
          const tempOutput = path.join(dir, `conv-${i}.mp3`);
          await this.converter.toMp3(srcPath, tempOutput);
          await this.fs.safeMove(tempOutput, destPath);
        }

        await this.tags.write(destPath, {
          title: t.title,
          artist: record.artist,
          albumArtist: record.artist,
          album: record.title,
          year: record.year,
          genre: record.genre,
          trackNumber: t.trackNumber,
          trackTotal,
          coverPath,
        });

        let durationSec: number | null = t.durationSec;
        if (durationSec == null) {
          try {
            durationSec = (await this.tags.read(destPath)).durationSec;
          } catch {
            durationSec = null;
          }
        }

        tracks.push({
          id: t.id,
          title: t.title,
          trackNumber: t.trackNumber,
          filePath: destPath,
          originalName: t.file,
          durationSec,
        });
      }

      const release: Release = {
        id: record.id,
        kind: record.kind,
        title: record.title,
        artist: record.artist,
        year: record.year,
        genre: record.genre,
        coverPath,
        folderPath,
        tracks,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };

      await this.repo.upsert(libraryDir, release);
      return release;
    } catch (err) {
      await this.fs.removeRecursive(folderPath).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Where a file the sync service named (`record.cover`, `tracks[].file`) was
   * downloaded to under `dir`. Only a plain child name is accepted - the same
   * two-step rule (`ReleaseLayout`, then `isInside`) every other user-derived
   * path in this class goes through.
   */
  private syncedSource(dir: string, name: string): string {
    const target = path.join(dir, this.layout.assertPlainFileName(name));
    if (!this.fs.isInside(dir, target) || path.resolve(target) === path.resolve(dir)) {
      throw new ValidationError("Refusing to read a synced file from outside its download directory");
    }
    return target;
  }

  /**
   * Apply a newer remote edit to an already-local release: rewrites tags in
   * place from the record's metadata, matching tracks by id. Like `update()`,
   * this NEVER renames or moves track files - Spotify playlists reference
   * tracks by local path. Tracks the record doesn't mention are left
   * untouched (this phase doesn't support adding/removing tracks from an
   * existing release via sync). Throws `NotFoundError` if the release isn't
   * local (the caller should use `importSynced` for that case instead).
   *
   * The cover is left alone unless `options.newCoverPath` names a file
   * already downloaded to local disk (the caller, `SyncEngine`, decides when
   * that's needed by comparing `record.coverHash` to the local cover's hash
   * and downloads it first) - in that case it's moved into the release
   * folder, under the name `record.cover` implies, and re-embedded into every
   * track alongside the metadata.
   */
  async applyRemote(record: SyncRecord, options: { newCoverPath?: string | null } = {}): Promise<Release> {
    const settings = await this.settings.get();
    const libraryDir = settings.libraryDir;

    const existing = await this.repo.find(libraryDir, record.id);
    if (!existing) {
      throw new NotFoundError(`Release ${record.id} not found`);
    }

    let coverPath = existing.coverPath;
    if (options.newCoverPath && record.cover) {
      const name = this.layout.coverFileName(record.cover);
      const destCoverPath = path.join(existing.folderPath, name);
      this.assertInsideLibrary(libraryDir, existing.folderPath);
      this.assertInsideLibrary(libraryDir, destCoverPath);
      if (existing.coverPath && existing.coverPath !== destCoverPath) {
        this.assertInsideLibrary(libraryDir, existing.coverPath);
        await this.fs.removeRecursive(existing.coverPath);
      }
      await this.fs.safeMove(options.newCoverPath, destCoverPath);
      coverPath = destCoverPath;
    }

    const patchById = new Map(record.tracks.map((t) => [t.id, t]));
    const updatedTracks: Track[] = existing.tracks.map((t) => {
      const p = patchById.get(t.id);
      if (!p) return { ...t };
      return {
        ...t,
        title: p.title,
        trackNumber: p.trackNumber,
        durationSec: p.durationSec ?? t.durationSec,
      };
    });
    updatedTracks.sort((a, b) => a.trackNumber - b.trackNumber);

    const trackTotal = updatedTracks.length;
    for (const t of updatedTracks) {
      await this.tags.write(t.filePath, {
        title: t.title,
        artist: record.artist,
        albumArtist: record.artist,
        album: record.title,
        year: record.year,
        genre: record.genre,
        trackNumber: t.trackNumber,
        trackTotal,
        coverPath,
      });
    }

    const updated: Release = {
      ...existing,
      title: record.title,
      artist: record.artist,
      year: record.year,
      genre: record.genre,
      coverPath,
      tracks: updatedTracks,
      updatedAt: record.updatedAt,
    };

    await this.repo.upsert(libraryDir, updated);
    return updated;
  }
}
