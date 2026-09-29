import path from "node:path";
import { z } from "zod";
import type { Release, ReleaseKind } from "../../shared/types";

/** Which platform wrote a given version of a release record. */
export type SyncOrigin = "mac" | "ios";

/** Longest name accepted for a record's file names and ids: the filename limit on every common filesystem. */
export const MAX_SYNC_NAME_LENGTH = 255;

/**
 * True only for a name that, joined to any directory, can point at nothing but
 * a direct child of it: no separators, not `.`/`..` or any other leading-dot
 * name, no control characters, and within the filesystem length limit.
 * Record file names and ids are used as path components (`SyncEngine`
 * downloads to `dir/<file>`, `ReleaseService.importSynced` reads them back),
 * and they arrive from the network, so anything else is refused at the wire.
 */
export function isPlainSyncName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_SYNC_NAME_LENGTH) return false;
  if (name.startsWith(".")) return false;
  if (name !== path.basename(name) || /[/\\]/.test(name)) return false;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return false;
  }
  return true;
}

const plainName = (what: string) => z.string().refine(isPlainSyncName, `${what} must be a plain file name`);

/** The extensions the API accepts for `tracks[].file` and `cover` (`SUPPORTED_FILE_EXT` in apps/api). */
export const SYNC_FILE_EXTENSIONS = ["mp3", "m4a", "jpg", "jpeg", "png"] as const;

const SYNC_FILE_EXTENSION_RE = new RegExp(`\\.(${SYNC_FILE_EXTENSIONS.join("|")})$`, "i");

/** True when `name` ends in one of `SYNC_FILE_EXTENSIONS`, compared case-insensitively, as the API checks it. */
export function hasSyncFileExtension(name: string): boolean {
  return SYNC_FILE_EXTENSION_RE.test(name);
}

const syncFileName = (what: string) =>
  plainName(what).refine(hasSyncFileExtension, `${what} must end in one of: ${SYNC_FILE_EXTENSIONS.join(", ")}`);

export const SyncTrackSchema = z.object({
  id: plainName("track id"),
  title: z.string(),
  trackNumber: z.number().int().positive(),
  file: syncFileName("track file"),
  bytes: z.number().int().nonnegative(),
  durationSec: z.number().nullable(),
});

/**
 * The `release.json`-shaped document from `spec/sync.md`. This is the exact
 * wire shape clients PUT/GET; server-only bookkeeping (`userId`, `version`,
 * `serverUpdatedAt`) is layered on by the API and isn't part of this schema.
 * Track files and cover names must be plain child names with an allowed extension.
 */
/** Lowercase hex sha256 of the cover's bytes: the only signal that `cover.<ext>` changed, since its name never does. */
export const CoverHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const SyncRecordSchema = z.object({
  /** 1: original record. 2: adds `coverHash`. Both are accepted so the other client can update in any order. */
  syncVersion: z.union([z.literal(1), z.literal(2)]),
  id: plainName("release id"),
  kind: z.enum(["single", "album"]),
  title: z.string(),
  artist: z.string(),
  year: z.string().nullable(),
  genre: z.string().nullable(),
  cover: syncFileName("cover").nullable(),
  /** Absent on a `syncVersion` 1 record (no signal, leave the cover alone); `null` on a v2 record with no cover. */
  coverHash: CoverHashSchema.nullable().optional(),
  tracks: z.array(SyncTrackSchema),
  origin: z.enum(["mac", "ios"]),
  originDevice: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deleted: z.boolean(),
});

export type SyncTrack = z.infer<typeof SyncTrackSchema>;
export type SyncRecord = z.infer<typeof SyncRecordSchema>;

/**
 * Thrown by `parseSyncRecord` for a record that has the right shape but names
 * a file or id this app will not use (`isPlainSyncName` / `hasSyncFileExtension`).
 * Distinct from a `ZodError` so `HttpSyncApi.listReleases` can skip the one
 * record and keep the rest of the page, as iOS's `SyncRecordRejected` does.
 */
export class SyncRecordRejectedError extends Error {
  constructor(
    /** The record's `id` when it was a string, else `null`. */
    readonly recordId: string | null,
    /** One entry per refused name, e.g. `tracks.0.file: track file must end in one of: mp3, m4a, jpg, jpeg, png`. */
    readonly reasons: string[]
  ) {
    super(`sync record ${recordId ?? "(no id)"} refused: ${reasons.join("; ")}`);
    this.name = "SyncRecordRejectedError";
  }
}

/**
 * Parse and validate an arbitrary JSON value as a `SyncRecord`. Throws
 * `SyncRecordRejectedError` when the only problems are refused names, and the
 * zod error when the record is structurally broken.
 */
export function parseSyncRecord(data: unknown): SyncRecord {
  const result = SyncRecordSchema.safeParse(data);
  if (result.success) return result.data;
  const { issues } = result.error;
  // The only `.refine()` calls in the schema are the name checks, so `custom` means a refused name.
  if (issues.every((issue) => issue.code === "custom")) {
    const id = typeof data === "object" && data !== null ? (data as { id?: unknown }).id : undefined;
    throw new SyncRecordRejectedError(
      typeof id === "string" ? id : null,
      issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    );
  }
  throw result.error;
}

/**
 * Pure conversion from a local `Release` to the wire `SyncRecord` shape.
 * `trackBytesById` supplies each track's on-disk byte size, and `coverHash`
 * the sha256 of the cover's current bytes (or `null` with no cover);
 * `toSyncRecord` itself never touches disk, so this stays a pure function -
 * callers that don't have real values handy (e.g. tests) may omit them and
 * get `0`/`null`.
 */
export function toSyncRecord(
  release: Release,
  origin: SyncOrigin,
  originDevice: string,
  trackBytesById: Record<string, number> = {},
  coverHash: string | null = null
): SyncRecord {
  const tracks = [...release.tracks]
    .sort((a, b) => a.trackNumber - b.trackNumber)
    .map((t) => ({
      id: t.id,
      title: t.title,
      trackNumber: t.trackNumber,
      file: path.basename(t.filePath),
      bytes: trackBytesById[t.id] ?? 0,
      durationSec: t.durationSec,
    }));

  return {
    syncVersion: 2,
    id: release.id,
    kind: release.kind,
    title: release.title,
    artist: release.artist,
    year: release.year,
    genre: release.genre,
    cover: release.coverPath ? path.basename(release.coverPath) : null,
    coverHash,
    tracks,
    origin,
    originDevice,
    createdAt: release.createdAt,
    updatedAt: release.updatedAt,
    deleted: false,
  };
}

/**
 * The metadata `fromSyncRecord` can recover purely from a `SyncRecord`,
 * without knowing anything about local file placement (folder path, track
 * `filePath`s) - that's decided by `ReleaseLayout`/`ReleaseService` when the
 * record is actually imported or applied locally.
 */
export interface SyncRecordMeta {
  id: string;
  kind: ReleaseKind;
  title: string;
  artist: string;
  year: string | null;
  genre: string | null;
  cover: string | null;
  /** `null` for no cover, or for a `syncVersion` 1 record that carried no `coverHash` at all. */
  coverHash: string | null;
  tracks: { id: string; title: string; trackNumber: number; file: string; durationSec: number | null }[];
  createdAt: string;
  updatedAt: string;
}

/** Pure conversion from the wire `SyncRecord` shape to locally-usable metadata. */
export function fromSyncRecord(record: SyncRecord): SyncRecordMeta {
  return {
    id: record.id,
    kind: record.kind,
    title: record.title,
    artist: record.artist,
    year: record.year,
    genre: record.genre,
    cover: record.cover,
    coverHash: record.coverHash ?? null,
    tracks: [...record.tracks]
      .sort((a, b) => a.trackNumber - b.trackNumber)
      .map((t) => ({
        id: t.id,
        title: t.title,
        trackNumber: t.trackNumber,
        file: t.file,
        durationSec: t.durationSec,
      })),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
