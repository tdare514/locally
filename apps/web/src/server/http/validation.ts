import path from "node:path";
import { z } from "zod";
import type { ImportMeta, UpdateReleaseMeta } from "../../shared/types";
import { SUPPORTED_AUDIO_EXT, SUPPORTED_IMAGE_EXT } from "../../shared/types";
import { ValidationError } from "../../shared/errors";

/** Input limits shared by the upload routes. */
export const MAX_COVER_BYTES = 10 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 500 * 1024 * 1024;
/** Longest title/name accepted; `ReleaseLayout.sanitizeSegment` caps at the same length. */
export const MAX_TEXT_LENGTH = 200;
export const MAX_TRACKS = 200;
/** Longest audio file list accepted per request, for import and inspect alike. */
export const MAX_AUDIO_FILES = 100;

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

// U+0000–U+001F and U+007F are never part of a real title, and NUL/newline are
// significant to the OS or a terminal. A loop rather than a regex: eslint's
// no-control-regex flags the escapes, and this reads just as clearly.
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/** A trimmed, length-capped, control-character-free text field. */
function text() {
  return z
    .string({ error: "must be a string" })
    .trim()
    .max(MAX_TEXT_LENGTH, `must be at most ${MAX_TEXT_LENGTH} characters`)
    .refine((s) => !hasControlChar(s), "must not contain control characters");
}

const kindSchema = z.enum(["single", "album"], { error: "must be 'single' or 'album'" });

// `Release.year` is a string ("2024"), so a 4-digit string it is; a number is rejected.
const yearSchema = z.string({ error: "must be a 4-digit year" }).trim().regex(/^\d{4}$/, "must be a 4-digit year");

// Anything but a small positive integer would stringify into a track file name that
// isn't a plain number (see `ReleaseLayout.trackFileName`).
const TRACK_NUMBER_MSG = "must be an integer between 1 and 999";
const trackNumberSchema = z
  .number({ error: TRACK_NUMBER_MSG })
  .int(TRACK_NUMBER_MSG)
  .min(1, TRACK_NUMBER_MSG)
  .max(999, TRACK_NUMBER_MSG);

/** Reject a track list where two entries share a `trackNumber` (entries without one, e.g. a
 * partial `update` patch that doesn't touch it, are ignored). Spotify's local-files matching and
 * `ReleaseLayout.trackFileName` both key off track number, so a collision would make two tracks
 * indistinguishable on disk. */
function rejectDuplicateTrackNumbers(
  tracks: ReadonlyArray<{ trackNumber?: number }>,
  ctx: z.RefinementCtx
): void {
  const seenAt = new Map<number, number>();
  for (let i = 0; i < tracks.length; i++) {
    const n = tracks[i].trackNumber;
    if (n === undefined) continue;
    const firstIndex = seenAt.get(n);
    if (firstIndex !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: `duplicates the trackNumber already used by tracks[${firstIndex}]`,
        path: [i, "trackNumber"],
      });
    } else {
      seenAt.set(n, i);
    }
  }
}

const importMetaSchema = z.object(
  {
    kind: kindSchema,
    // Optional for singles: the server falls back to the first track's title.
    title: text().default(""),
    artist: text().min(1, "is required"),
    year: yearSchema.optional(),
    genre: text().optional(),
    tracks: z
      .array(z.object({ title: text(), trackNumber: trackNumberSchema }, { error: "must be an object" }), {
        error: "must be a non-empty array",
      })
      .min(1, "must be a non-empty array")
      .max(MAX_TRACKS, `must have at most ${MAX_TRACKS} tracks`)
      .superRefine(rejectDuplicateTrackNumbers),
  },
  { error: "must be a JSON object" }
);

const updateMetaSchema = z.object(
  {
    title: text().optional(),
    artist: text().optional(),
    year: yearSchema.nullable().optional(),
    genre: text().nullable().optional(),
    tracks: z
      .array(
        z.object(
          {
            id: text().min(1, "is required"),
            title: text().optional(),
            trackNumber: trackNumberSchema.optional(),
          },
          { error: "must be an object" }
        ),
        { error: "must be an array" }
      )
      .max(MAX_TRACKS, `must have at most ${MAX_TRACKS} entries`)
      .superRefine(rejectDuplicateTrackNumbers)
      .optional(),
  },
  { error: "Request body must be a JSON object" }
);

/** "meta.tracks[2].trackNumber must be ..." from a zod issue, so the client sees which field failed. */
function describeIssue(root: string, issue: z.ZodIssue): string {
  let where = root;
  for (const seg of issue.path) {
    where = typeof seg === "number" ? `${where}[${seg}]` : where ? `${where}.${String(seg)}` : String(seg);
  }
  return where ? `${where} ${issue.message}` : issue.message;
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

  let json: unknown;
  try {
    json = JSON.parse(metaRaw);
  } catch {
    throw new ValidationError("meta field must be valid JSON");
  }

  const parsed = importMetaSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError(describeIssue("meta", parsed.error.issues[0]));
  }
  const meta: ImportMeta = parsed.data;

  const audioFiles = form.getAll("audio").filter((v): v is File => v instanceof File);
  if (audioFiles.length === 0) {
    throw new ValidationError("At least one audio file is required");
  }
  if (audioFiles.length > MAX_AUDIO_FILES) {
    throw new ValidationError(`At most ${MAX_AUDIO_FILES} audio files are allowed per request`);
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
  if (audioFiles.length > MAX_AUDIO_FILES) {
    throw new ValidationError(`At most ${MAX_AUDIO_FILES} audio files are allowed per request`);
  }
  for (const f of audioFiles) {
    if (!hasExt(f.name, SUPPORTED_AUDIO_EXT)) {
      throw new ValidationError(`Unsupported audio file type: ${f.name}`);
    }
    if (f.size > MAX_AUDIO_BYTES) {
      throw new ValidationError(`${f.name} is larger than 500MB`);
    }
  }
  return audioFiles;
}

/** Validate and narrow the JSON body of `PATCH /api/releases/[id]` into `UpdateReleaseMeta`. */
export function parseUpdateMeta(body: unknown): UpdateReleaseMeta {
  const parsed = updateMetaSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(describeIssue("", parsed.error.issues[0]));
  }
  return parsed.data;
}

// --- settings / reveal / sync: request bodies -----------------------------
//
// These routes used to hand-check `typeof`/`.trim()` inline; the schemas
// below only pin down shape and non-emptiness (the same checks the routes
// used to do by hand). Anything that needs `path`/`os` or other services -
// home-folder expansion, the loopback/https rule for sync.baseUrl, the
// isInside check for reveal - stays in the route, since it isn't pure input
// validation.

const putSettingsBodySchema = z.object({
  libraryDir: z
    .string({ error: "libraryDir is required and must be a non-empty string" })
    .trim()
    .min(1, "libraryDir is required and must be a non-empty string")
    .optional(),
  sync: z
    .object({
      baseUrl: z
        .string({ error: "sync.baseUrl must be a non-empty string" })
        .trim()
        .min(1, "sync.baseUrl must be a non-empty string")
        .optional(),
    })
    .optional(),
});

export interface ParsedSettingsPut {
  libraryDir?: string;
  sync?: { baseUrl?: string };
}

/** Validate the JSON body of `PUT /api/settings`. Presence/shape only; the route still does the
 * path resolution and sync host rules that need `os`/`path` and `applySyncBaseUrlChange`. */
export function parseSettingsPutBody(body: unknown): ParsedSettingsPut {
  const parsed = putSettingsBodySchema.safeParse(body);
  if (!parsed.success) {
    // Messages here already name their field, so no describeIssue prefix.
    throw new ValidationError(parsed.error.issues[0].message);
  }
  return parsed.data;
}

const revealBodySchema = z.object({
  path: z
    .string({ error: "path must be a string" })
    .trim()
    .min(1, "path must not be empty")
    .refine((s) => !hasControlChar(s), "path must not contain control characters")
    .optional(),
});

export interface ParsedReveal {
  path?: string;
}

/** Validate the JSON body of `POST /api/reveal`. An absent `path` means "use the library dir",
 * which the route still resolves and checks with `isInside`/`ReleaseLayout`. */
export function parseRevealBody(body: unknown): ParsedReveal {
  const parsed = revealBodySchema.safeParse(body);
  if (!parsed.success) {
    // Messages here already name their field, so no describeIssue prefix.
    throw new ValidationError(parsed.error.issues[0].message);
  }
  return parsed.data;
}

const emailSchema = z
  .string({ error: "A valid email is required" })
  .refine((s) => s.includes("@"), "A valid email is required");

const syncCodeBodySchema = z.object({ email: emailSchema });

/** Validate the JSON body of `POST /api/sync/code`. */
export function parseSyncCodeBody(body: unknown): { email: string } {
  const parsed = syncCodeBodySchema.safeParse(body);
  if (!parsed.success) {
    // Messages here already name their field, so no describeIssue prefix.
    throw new ValidationError(parsed.error.issues[0].message);
  }
  return parsed.data;
}

const syncVerifyBodySchema = z.object({
  email: emailSchema,
  code: z
    .string({ error: "The six-digit code is required" })
    .trim()
    .min(1, "The six-digit code is required"),
});

/** Validate the JSON body of `POST /api/sync/verify`. */
export function parseSyncVerifyBody(body: unknown): { email: string; code: string } {
  const parsed = syncVerifyBodySchema.safeParse(body);
  if (!parsed.success) {
    // Messages here already name their field, so no describeIssue prefix.
    throw new ValidationError(parsed.error.issues[0].message);
  }
  return parsed.data;
}
