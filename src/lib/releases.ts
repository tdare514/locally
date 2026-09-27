import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import type { ImportMeta, Release, Track, UpdateReleaseMeta } from "./types";
import { sanitizeSegment } from "./paths";
import { readSettings } from "./settings";
import { findRelease, removeRelease, upsertRelease } from "./library";
import { toMp3 } from "./convert";
import { writeTags, readTags } from "./tags";
import { sniffImageMime } from "./validate";
import { isInside, makeTempDir, removeRecursive, safeMove, saveWebFileToDisk, uniqueDir } from "./fsutil";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function trackFileName(trackNumber: number, title: string): string {
  return `${pad2(trackNumber)} - ${sanitizeSegment(title)}.mp3`;
}

function coverFileName(mimeOrName: string): string {
  const lower = mimeOrName.toLowerCase();
  if (lower.includes("png")) return "cover.png";
  return "cover.jpg";
}

import { ValidationError, NotFoundError } from "./errors";
export { ValidationError, NotFoundError };

/** Import a new release (single or album). */
export async function importRelease(
  meta: ImportMeta,
  coverFile: File | null,
  audioFiles: File[]
): Promise<Release> {
  if (meta.kind === "single" && audioFiles.length !== 1) {
    throw new ValidationError("A single must have exactly one audio file");
  }
  if (meta.kind === "album" && audioFiles.length < 1) {
    throw new ValidationError("An album must have at least one audio file");
  }
  if (audioFiles.length !== meta.tracks.length) {
    throw new ValidationError("Number of tracks in meta does not match number of audio files");
  }

  const settings = await readSettings();
  const libraryDir = settings.libraryDir;

  const albumTitle =
    meta.title && meta.title.trim().length > 0 ? meta.title.trim() : meta.tracks[0]?.title?.trim() ?? "";

  const artistSeg = sanitizeSegment(meta.artist);
  const albumSeg = sanitizeSegment(albumTitle);
  const folderPath = await uniqueDir(path.join(libraryDir, artistSeg, albumSeg));

  await fs.mkdir(folderPath, { recursive: true });

  const tempDir = await makeTempDir("sli-import-");
  try {
    // Save cover, if provided.
    let coverPath: string | null = null;
    if (coverFile) {
      const name = coverFileName((await sniffImageMime(coverFile)) ?? coverFile.type);
      coverPath = path.join(folderPath, name);
      const tempCover = path.join(tempDir, name);
      await saveWebFileToDisk(coverFile, tempCover);
      await safeMove(tempCover, coverPath);
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
      await saveWebFileToDisk(file, tempInput);

      const destFileName = trackFileName(trackNumber, title);
      const destPath = path.join(folderPath, destFileName);
      const tempOutput = path.join(tempDir, `out-${i}.mp3`);

      await toMp3(tempInput, tempOutput);
      await safeMove(tempOutput, destPath);

      await writeTags(destPath, {
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
        const t = await readTags(destPath);
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

    await upsertRelease(libraryDir, release);
    return release;
  } finally {
    await removeRecursive(tempDir);
  }
}

/** Update release metadata; rewrites tags for every track, and renames files/folders as needed. */
export async function updateRelease(id: string, patch: UpdateReleaseMeta): Promise<Release> {
  const settings = await readSettings();
  const libraryDir = settings.libraryDir;

  const existing = await findRelease(libraryDir, id);
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
    const artistSeg = sanitizeSegment(newArtist);
    const albumSeg = sanitizeSegment(newTitle);
    const desiredFolderPath = path.join(libraryDir, artistSeg, albumSeg);

    if (desiredFolderPath !== existing.folderPath) {
      const newFolderPath = await uniqueDir(desiredFolderPath);
      await fs.mkdir(path.dirname(newFolderPath), { recursive: true });
      await safeMove(existing.folderPath, newFolderPath);
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
    .map((t) => ({ t, to: path.join(folderPath, trackFileName(t.trackNumber, t.title)) }))
    .filter(({ t, to }) => to !== t.filePath);
  if (renames.length > 0) {
    const staged: { t: Track; tmp: string; to: string }[] = [];
    for (const { t, to } of renames) {
      const tmp = path.join(folderPath, `.${t.id}.tmp.mp3`);
      await safeMove(t.filePath, tmp);
      staged.push({ t, tmp, to });
    }
    for (const { t, tmp, to } of staged) {
      await safeMove(tmp, to);
      t.filePath = to;
    }
  }

  const trackTotal = updatedTracks.length;
  for (const t of updatedTracks) {
    await writeTags(t.filePath, {
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

  await upsertRelease(libraryDir, updated);
  return updated;
}

/** Replace the cover image for a release and re-embed it into every track's tags. */
export async function replaceCover(id: string, file: File): Promise<Release> {
  const settings = await readSettings();
  const libraryDir = settings.libraryDir;

  const existing = await findRelease(libraryDir, id);
  if (!existing) {
    throw new NotFoundError(`Release ${id} not found`);
  }

  const name = coverFileName((await sniffImageMime(file)) ?? file.type);
  const newCoverPath = path.join(existing.folderPath, name);

  // Remove old cover if it has a different name/extension than the new one.
  if (existing.coverPath && existing.coverPath !== newCoverPath) {
    await removeRecursive(existing.coverPath);
  }

  await saveWebFileToDisk(file, newCoverPath);

  const trackTotal = existing.tracks.length;
  for (const t of existing.tracks) {
    await writeTags(t.filePath, {
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
  await upsertRelease(libraryDir, updated);
  return updated;
}

/** Delete a release: removes its folder from disk and the library index entry. */
export async function deleteRelease(id: string): Promise<void> {
  const settings = await readSettings();
  const libraryDir = settings.libraryDir;

  const existing = await findRelease(libraryDir, id);
  if (!existing) {
    throw new NotFoundError(`Release ${id} not found`);
  }
  // Never delete anything that is not a release folder inside the library.
  if (!isInside(libraryDir, existing.folderPath) || path.resolve(existing.folderPath) === path.resolve(libraryDir)) {
    throw new ValidationError("Refusing to delete a folder outside the library");
  }
  await removeRelease(libraryDir, id);
  await removeRecursive(existing.folderPath);
}

export async function getRelease(id: string): Promise<Release | null> {
  const settings = await readSettings();
  return findRelease(settings.libraryDir, id);
}
