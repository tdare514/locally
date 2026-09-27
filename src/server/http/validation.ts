import path from "node:path";
import type { ImportMeta, UpdateReleaseMeta } from "../../shared/types";
import { SUPPORTED_AUDIO_EXT, SUPPORTED_IMAGE_EXT } from "../../shared/types";
import { ValidationError } from "../../shared/errors";

/** Input limits shared by the upload routes. */
export const MAX_COVER_BYTES = 10 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 500 * 1024 * 1024;

/** True if `name`'s extension (lowercased) is one of `exts`. */
export function hasExt(name: string, exts: readonly string[]): boolean {
  return exts.includes(path.extname(name).toLowerCase());
}

/** Detect JPEG/PNG from the leading bytes rather than trusting the filename. */
export async function sniffImageMime(file: File): Promise<"image/jpeg" | "image/png" | null> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47 &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
}

export interface ParsedImport {
  meta: ImportMeta;
  audioFiles: File[];
  coverFile: File | null;
}

/**
 * Validate and extract an import request's multipart form into a typed
 * `ImportMeta` plus its audio/cover files, or throw `ValidationError` with a
 * message safe to send back to the client. Centralizes every check the
 * `/api/import` route used to do inline, so the route handler stays thin.
 */
export async function parseImportMeta(form: FormData): Promise<ParsedImport> {
  const metaRaw = form.get("meta");
  if (typeof metaRaw !== "string") {
    throw new ValidationError("meta field (JSON string) is required");
  }

  let meta: ImportMeta;
  try {
    meta = JSON.parse(metaRaw) as ImportMeta;
  } catch {
    throw new ValidationError("meta field must be valid JSON");
  }

  if (meta.kind !== "single" && meta.kind !== "album") {
    throw new ValidationError("meta.kind must be 'single' or 'album'");
  }
  if (typeof meta.artist !== "string" || meta.artist.trim().length === 0) {
    throw new ValidationError("meta.artist is required");
  }
  if (!Array.isArray(meta.tracks) || meta.tracks.length === 0) {
    throw new ValidationError("meta.tracks must be a non-empty array");
  }

  const audioFiles = form.getAll("audio").filter((v): v is File => v instanceof File);
  if (audioFiles.length === 0) {
    throw new ValidationError("At least one audio file is required");
  }
  if (meta.kind === "single" && audioFiles.length !== 1) {
    throw new ValidationError("A single must have exactly one audio file");
  }
  if (audioFiles.length !== meta.tracks.length) {
    throw new ValidationError("Number of audio files must match meta.tracks length");
  }
  for (const f of audioFiles) {
    if (!hasExt(f.name, SUPPORTED_AUDIO_EXT)) {
      throw new ValidationError(`Unsupported audio file type: ${f.name}`);
    }
    if (f.size === 0) {
      throw new ValidationError(`${f.name} is empty`);
    }
    if (f.size > MAX_AUDIO_BYTES) {
      throw new ValidationError(`${f.name} is larger than 500MB`);
    }
  }

  const coverEntry = form.get("cover");
  let coverFile: File | null = null;
  if (coverEntry instanceof File && coverEntry.size > 0) {
    if (!hasExt(coverEntry.name, SUPPORTED_IMAGE_EXT)) {
      throw new ValidationError(`Unsupported cover image type: ${coverEntry.name}`);
    }
    if (coverEntry.size > MAX_COVER_BYTES) {
      throw new ValidationError("Cover image must be 10MB or smaller");
    }
    if (!(await sniffImageMime(coverEntry))) {
      throw new ValidationError("Cover image must be a real JPEG or PNG");
    }
    coverFile = coverEntry;
  }

  return { meta, audioFiles, coverFile };
}

/** Validate a cover file taken from a `cover` form field (used by the replace-cover route). */
export async function parseCoverFile(form: FormData): Promise<File> {
  const coverEntry = form.get("cover");
  if (!(coverEntry instanceof File) || coverEntry.size === 0) {
    throw new ValidationError("cover file is required");
  }
  if (!hasExt(coverEntry.name, SUPPORTED_IMAGE_EXT)) {
    throw new ValidationError(`Unsupported cover image type: ${coverEntry.name}`);
  }
  if (coverEntry.size > MAX_COVER_BYTES) {
    throw new ValidationError("Cover image must be 10MB or smaller");
  }
  if (!(await sniffImageMime(coverEntry))) {
    throw new ValidationError("Cover image must be a real JPEG or PNG");
  }
  return coverEntry;
}

/** Validate audio files taken from an `audio` form field (used by the inspect route). */
export function parseInspectAudio(form: FormData): File[] {
  const audioFiles = form.getAll("audio").filter((v): v is File => v instanceof File);
  if (audioFiles.length === 0) {
    throw new ValidationError("At least one audio file is required");
  }
  for (const f of audioFiles) {
    if (!hasExt(f.name, SUPPORTED_AUDIO_EXT)) {
      throw new ValidationError(`Unsupported audio file type: ${f.name}`);
    }
  }
  return audioFiles;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate and narrow the JSON body of `PATCH /api/releases/[id]` into `UpdateReleaseMeta`. */
export function parseUpdateMeta(body: unknown): UpdateReleaseMeta {
  if (!isPlainObject(body)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  const { title, artist, year, genre, tracks } = body as Record<string, unknown>;

  if (title !== undefined && typeof title !== "string") {
    throw new ValidationError("title must be a string");
  }
  if (artist !== undefined && typeof artist !== "string") {
    throw new ValidationError("artist must be a string");
  }
  if (year !== undefined && year !== null && typeof year !== "string") {
    throw new ValidationError("year must be a string or null");
  }
  if (genre !== undefined && genre !== null && typeof genre !== "string") {
    throw new ValidationError("genre must be a string or null");
  }

  let parsedTracks: UpdateReleaseMeta["tracks"];
  if (tracks !== undefined) {
    if (!Array.isArray(tracks)) {
      throw new ValidationError("tracks must be an array");
    }
    parsedTracks = tracks.map((t) => {
      if (!isPlainObject(t) || typeof t.id !== "string") {
        throw new ValidationError("Each track patch must have a string id");
      }
      if (t.title !== undefined && typeof t.title !== "string") {
        throw new ValidationError("track title must be a string");
      }
      if (t.trackNumber !== undefined && typeof t.trackNumber !== "number") {
        throw new ValidationError("track trackNumber must be a number");
      }
      return {
        id: t.id,
        title: t.title as string | undefined,
        trackNumber: t.trackNumber as number | undefined,
      };
    });
  }

  return {
    title: title as string | undefined,
    artist: artist as string | undefined,
    year: year as string | null | undefined,
    genre: genre as string | null | undefined,
    tracks: parsedTracks,
  };
}
