import path from "node:path";
import { z } from "zod";
import type { Release, ReleaseKind } from "../../shared/types";

/** Which platform wrote a given version of a release record. */
export type SyncOrigin = "mac" | "ios";

export const SyncTrackSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  trackNumber: z.number().int().positive(),
  file: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  durationSec: z.number().nullable(),
});

/**
 * The `release.json`-shaped document from `spec/sync.md`. This is the exact
 * wire shape clients PUT/GET; server-only bookkeeping (`userId`, `version`,
 * `serverUpdatedAt`) is layered on by the API and isn't part of this schema.
 */
export const SyncRecordSchema = z.object({
  syncVersion: z.literal(1),
  id: z.string().min(1),
  kind: z.enum(["single", "album"]),
  title: z.string(),
  artist: z.string(),
  year: z.string().nullable(),
  genre: z.string().nullable(),
  cover: z.string().nullable(),
  tracks: z.array(SyncTrackSchema),
  origin: z.enum(["mac", "ios"]),
  originDevice: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deleted: z.boolean(),
});

export type SyncTrack = z.infer<typeof SyncTrackSchema>;
export type SyncRecord = z.infer<typeof SyncRecordSchema>;

/** Parse and validate an arbitrary JSON value as a `SyncRecord`, throwing a zod error if it doesn't match. */
export function parseSyncRecord(data: unknown): SyncRecord {
  return SyncRecordSchema.parse(data);
}

/**
 * Pure conversion from a local `Release` to the wire `SyncRecord` shape.
 * `trackBytesById` supplies each track's on-disk byte size (`toSyncRecord`
 * itself never touches disk, so this stays a pure function); callers that
 * don't have real sizes handy (e.g. tests) may omit it and get `0`.
 */
export function toSyncRecord(
  release: Release,
  origin: SyncOrigin,
  originDevice: string,
  trackBytesById: Record<string, number> = {}
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
    syncVersion: 1,
    id: release.id,
    kind: release.kind,
    title: release.title,
    artist: release.artist,
    year: release.year,
    genre: release.genre,
    cover: release.coverPath ? path.basename(release.coverPath) : null,
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
