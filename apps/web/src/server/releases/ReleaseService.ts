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

/**
 * Core release lifecycle: import, edit, re-cover, delete, and look up. All
 * collaborators are injected so this class can be unit tested with fakes
 * (in-memory repository, a converter that just copies bytes, a recording tag
 * service) against a real temp directory via `NodeFileSystem`.
 */
export class ReleaseService {
  constructor(
    private readonly settings: SettingsStore,
    private readonly repo: LibraryRepository,
    private readonly converter: AudioConverter,
    private readonly tags: TagService,
    private readonly fs: FileSystem,
    private readonly layout: ReleaseLayout = new ReleaseLayout()
  ) {}

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

  /** Update release metadata; rewrites tags for every track, and renames files/folders as needed. */
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

    const artistChanged = newArtist !== existing.artist;
    const albumChanged = newTitle !== existing.title;

    let folderPath = existing.folderPath;
    let coverPath = existing.coverPath;

    if (artistChanged || albumChanged) {
      const desiredFolderPath = this.layout.folderFor(libraryDir, newArtist, newTitle);

      if (desiredFolderPath !== existing.folderPath) {
        const newFolderPath = await this.fs.uniqueDir(desiredFolderPath);
        await this.fs.mkdirp(path.dirname(newFolderPath));
        await this.fs.safeMove(existing.folderPath, newFolderPath);
        folderPath = newFolderPath;
        if (existing.coverPath) {
          coverPath = path.join(newFolderPath, path.basename(existing.coverPath));
        }
        // Track paths need to be re-based onto the new folder.
        for (const t of updatedTracks) {
          t.filePath = path.join(newFolderPath, path.basename(t.filePath));
        }
      }
    }

    // Rename track files if title/number changed. Two phases (via temp names) so that
    // reordering tracks can never collide with a file that has not moved yet.
    const renames = updatedTracks
      .map((t) => ({ t, to: path.join(folderPath, this.layout.trackFileName(t.trackNumber, t.title)) }))
      .filter(({ t, to }) => to !== t.filePath);
    if (renames.length > 0) {
      const staged: { t: Track; tmp: string; to: string }[] = [];
      for (const { t, to } of renames) {
        const tmp = path.join(folderPath, `.${t.id}.tmp.mp3`);
        await this.fs.safeMove(t.filePath, tmp);
        staged.push({ t, tmp, to });
      }
      for (const { t, tmp, to } of staged) {
        await this.fs.safeMove(tmp, to);
        t.filePath = to;
      }
    }

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
  }

  async get(id: string): Promise<Release | null> {
    const settings = await this.settings.get();
    return this.repo.find(settings.libraryDir, id);
  }

  async list(): Promise<Release[]> {
    const settings = await this.settings.get();
    return this.repo.list(settings.libraryDir);
  }
}
