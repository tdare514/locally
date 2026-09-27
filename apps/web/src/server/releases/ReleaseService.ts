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

    await this.fs.mkdirp(folderPath);

    const tempDir = await this.fs.makeTempDir("sli-import-");
    try {
      // Save cover, if provided.
      let coverPath: string | null = null;
      if (coverFile) {
        const name = this.layout.coverFileName((await sniffImageMime(coverFile)) ?? coverFile.type);
        coverPath = path.join(folderPath, name);
        const tempCover = path.join(tempDir, name);
        await this.fs.saveWebFile(coverFile, tempCover);
        await this.fs.safeMove(tempCover, coverPath);
      }

      const trackTotal = audioFiles.length;
      const tracks: Track[] = [];

      for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i];
        const trackMeta = meta.tracks[i];
        const trackNumber = trackMeta.trackNumber ?? i + 1;
        const title = trackMeta.title?.trim() || `Track ${trackNumber}`;

        const originalExt = path.extname(file.name) || ".dat";
        const tempInput = path.join(tempDir, `in-${i}${originalExt}`);
        await this.fs.saveWebFile(file, tempInput);

        const destFileName = this.layout.trackFileName(trackNumber, title);
        const destPath = path.join(folderPath, destFileName);
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

    // Remove old cover if it has a different name/extension than the new one.
    if (existing.coverPath && existing.coverPath !== newCoverPath) {
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

  /** Delete a release: removes its folder from disk and the library index entry. */
  async delete(id: string): Promise<void> {
    const settings = await this.settings.get();
    const libraryDir = settings.libraryDir;

    const existing = await this.repo.find(libraryDir, id);
    if (!existing) {
      throw new NotFoundError(`Release ${id} not found`);
    }
    // Never delete anything that is not a release folder inside the library.
    if (
      !this.fs.isInside(libraryDir, existing.folderPath) ||
      path.resolve(existing.folderPath) === path.resolve(libraryDir)
    ) {
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

  async list(): Promise<Release[]> {
    const settings = await this.settings.get();
    return this.repo.list(settings.libraryDir);
  }

  /**
   * Import a release that came from the sync service (originally created on
   * the phone), keeping the SAME id so it's recognised as the same release on
   * every device from then on. `dir` already holds the downloaded track/cover
   * files, named exactly as `record.tracks[].file`/`record.cover`. mp3 tracks
   * pass through untouched; anything else (m4a from iOS) is converted with
   * the same `AudioConverter` used for normal imports. Never pushed back to
   * sync by this method itself - the caller (`SyncEngine`) owns that bookkeeping.
   */
  async importSynced(record: SyncRecord, dir: string): Promise<Release> {
    const settings = await this.settings.get();
    const libraryDir = settings.libraryDir;

    const desiredFolder = this.layout.folderFor(libraryDir, record.artist, record.title);
    const folderPath = await this.fs.uniqueDir(desiredFolder);
    await this.fs.mkdirp(folderPath);

    try {
      let coverPath: string | null = null;
      if (record.cover) {
        const srcCover = path.join(dir, record.cover);
        const name = this.layout.coverFileName(record.cover);
        coverPath = path.join(folderPath, name);
        await this.fs.safeMove(srcCover, coverPath);
      }

      const sortedTracks = [...record.tracks].sort((a, b) => a.trackNumber - b.trackNumber);
      const trackTotal = sortedTracks.length;
      const tracks: Track[] = [];

      for (const t of sortedTracks) {
        const srcPath = path.join(dir, t.file);
        const ext = path.extname(t.file).toLowerCase();
        const destFileName = this.layout.trackFileName(t.trackNumber, t.title);
        const destPath = path.join(folderPath, destFileName);

        if (ext === ".mp3") {
          await this.fs.safeMove(srcPath, destPath);
        } else {
          const tempOutput = path.join(dir, `conv-${t.id}.mp3`);
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
   * Apply a newer remote edit to an already-local release: rewrites tags in
   * place from the record's metadata, matching tracks by id. Like `update()`,
   * this NEVER renames or moves files - Spotify playlists reference tracks by
   * local path. Tracks the record doesn't mention are left untouched (this
   * phase doesn't support adding/removing tracks from an existing release via
   * sync). Throws `NotFoundError` if the release isn't local (the caller
   * should use `importSynced` for that case instead).
   */
  async applyRemote(record: SyncRecord): Promise<Release> {
    const settings = await this.settings.get();
    const libraryDir = settings.libraryDir;

    const existing = await this.repo.find(libraryDir, record.id);
    if (!existing) {
      throw new NotFoundError(`Release ${record.id} not found`);
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
        coverPath: existing.coverPath,
      });
    }

    const updated: Release = {
      ...existing,
      title: record.title,
      artist: record.artist,
      year: record.year,
      genre: record.genre,
      tracks: updatedTracks,
      updatedAt: record.updatedAt,
    };

    await this.repo.upsert(libraryDir, updated);
    return updated;
  }
}
