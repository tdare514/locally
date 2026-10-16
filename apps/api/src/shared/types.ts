/**
 * Contract between clients (apps/web, apps/ios) and this service. Mirrors
 * `spec/sync.md`'s record shape. Both the wire schema (zod, for runtime
 * validation) and the derived TypeScript types live here so route handlers
 * and services import a single source of truth.
 */
import { z } from "zod";
import { isRealDay } from "./days";

export const SUPPORTED_FILE_EXT = ["mp3", "m4a", "jpg", "jpeg", "png"] as const;

/** A bare filename: no path separators, <= 200 chars, an allowed extension. */
export const fileNameSchema = z
  .string()
  .max(200, "File name must be 200 characters or fewer")
  .refine((name) => !name.includes("/") && !name.includes("\\"), {
    message: "File name must not contain path separators",
  })
  .refine((name) => new RegExp(`\\.(${SUPPORTED_FILE_EXT.join("|")})$`, "i").test(name), {
    message: `File name must end in one of: ${SUPPORTED_FILE_EXT.join(", ")}`,
  });

export const uuidSchema = z.string().uuid("Must be a UUID");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Must be a valid email address")
  .max(320);

export const platformSchema = z.enum(["mac", "ios"]);
export type Platform = z.infer<typeof platformSchema>;

const isoDateSchema = z.string().datetime({ offset: true, message: "Must be an ISO 8601 timestamp" });

/** `tracks[]` entry inside a release record. */
export const trackRecordSchema = z.object({
  id: uuidSchema,
  title: z.string().min(1).max(500),
  trackNumber: z.number().int().positive(),
  /** Which disc of a multi-disc release this track is on; absent on a single-disc release. */
  discNumber: z.number().int().min(1).max(99).optional(),
  file: fileNameSchema,
  bytes: z.number().int().nonnegative(),
  durationSec: z.number().nonnegative().nullable(),
});
export type TrackRecord = z.infer<typeof trackRecordSchema>;

/** The `release.json` document from `spec/sync.md`, as sent in `PUT /v1/releases/:id`. */
/** Lowercase hex sha256 of a cover's bytes; the change signal for `cover.<ext>`, whose name never changes. */
export const coverHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const releaseRecordSchema = z.object({
  /** 1: original record. 2: adds `coverHash`. Both are accepted so clients can update in any order. */
  syncVersion: z.union([z.literal(1), z.literal(2)]),
  id: uuidSchema,
  kind: z.enum(["single", "album"]),
  title: z.string().min(1).max(500),
  artist: z.string().min(1).max(500),
  year: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  genre: z.string().max(200).nullable(),
  cover: fileNameSchema.nullable(),
  /** Absent on `syncVersion` 1 records (no signal); `null` on a v2 record with no cover. */
  coverHash: coverHashSchema.nullable().optional(),
  tracks: z.array(trackRecordSchema).min(1).max(500),
  origin: platformSchema,
  originDevice: z.string().min(1).max(200),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  deleted: z.boolean(),
});
export type ReleaseRecord = z.infer<typeof releaseRecordSchema>;

/** A release record as returned to clients: the record plus sync bookkeeping. */
export interface ReleaseRecordWithVersion extends ReleaseRecord {
  version: number;
  serverUpdatedAt: string;
}

export const emailRequestSchema = z.object({ email: emailSchema });

/** Body of `DELETE /v1/me`: the account email, echoed as an explicit confirmation. */
export const deleteMeRequestSchema = z.object({ email: emailSchema });

export const verifyRequestSchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
  deviceName: z.string().trim().min(1).max(200),
  platform: platformSchema,
});
export type VerifyRequest = z.infer<typeof verifyRequestSchema>;

export const filesUploadRequestSchema = z.object({
  files: z
    .array(
      z.object({
        name: fileNameSchema,
        bytes: z.number().int().positive(),
        contentType: z.string().min(1).max(200),
      })
    )
    .min(1)
    .max(50),
});
export type FilesUploadRequest = z.infer<typeof filesUploadRequestSchema>;

export interface UserSummary {
  id: string;
  email: string;
}

export interface DeviceSummary {
  id: string;
  name: string;
  platform: Platform;
  createdAt: string;
  lastSeenAt: string;
  revoked: boolean;
}

export interface QuotaSummary {
  usedBytes: number;
  limitBytes: number;
}

export interface MeResponse {
  user: UserSummary;
  device: { id: string; name: string };
  quota: QuotaSummary;
  devices: DeviceSummary[];
  devicesHasMore: boolean;
  /** ISO time of the last `POST /v1/files/resync-request`, or `null` when none was made. */
  resyncRequestedAt: string | null;
}

/** One live release with files that are not stored, from `GET /v1/files/missing`. */
export interface MissingFilesRelease {
  id: string;
  /** File names the record references (tracks, and the cover when it has a `coverHash`) that are not stored. */
  missing: string[];
  /** The record's own `updatedAt`, so a client can tell which version of the release was checked. */
  recordUpdatedAt: string;
}

export interface MissingFilesResponse {
  releases: MissingFilesRelease[];
  checkedAt: string;
  /** `true` only when a cap cut the check short, so the list may be incomplete; omitted otherwise. */
  truncated?: boolean;
}

/** Response of `POST /v1/files/resync-request`. */
export interface ResyncRequestResponse {
  resyncRequestedAt: string;
}

export interface VerifyResponse {
  token: string;
  user: UserSummary;
  device: { id: string; name: string };
}

export interface UploadTicket {
  name: string;
  url: string;
  method: "PUT";
  headers: Record<string, string>;
}

export interface DownloadTicket {
  url: string;
  expiresAt: string;
}

export interface ApiError {
  error: string;
}

/** Highest play count a device may report for one track. */
export const MAX_PLAY_COUNT = 1_000_000;
/** Most entries in one `PUT /v1/plays` body. */
export const MAX_PLAY_ENTRIES = 500;

/** Most day buckets in one `PUT /v1/plays` entry. */
export const MAX_PLAY_DAYS_PER_ENTRY = 400;
/** Most day buckets in one `PUT /v1/plays` body, across all entries. */
export const MAX_PLAY_DAYS_PER_REQUEST = 2_000;
/** Track ids per page of `GET /v1/plays/summary`. */
export const PLAYS_SUMMARY_PAGE_SIZE = 1_000;

/** A strict `YYYY-MM-DD` that is a real calendar date. */
export const daySchema = z.string().refine(isRealDay, "Must be a real date as YYYY-MM-DD");

/** Body of `PUT /v1/plays`. Strict: a body naming a device or user (or anything else unknown) is refused. */
export const playCountsRequestSchema = z
  .object({
    counts: z
      .array(
        z
          .object({
            releaseId: uuidSchema,
            trackId: uuidSchema,
            count: z.number().int().min(0).max(MAX_PLAY_COUNT),
            days: z
              .array(
                z
                  .object({
                    day: daySchema,
                    count: z.number().int().min(0).max(MAX_PLAY_COUNT),
                  })
                  .strict()
              )
              .max(MAX_PLAY_DAYS_PER_ENTRY)
              .refine((days) => new Set(days.map((d) => d.day)).size === days.length, "Duplicate day in one entry")
              .optional(),
          })
          .strict()
      )
      .min(1)
      .max(MAX_PLAY_ENTRIES),
  })
  .strict()
  .refine(
    (body) => body.counts.reduce((sum, entry) => sum + (entry.days?.length ?? 0), 0) <= MAX_PLAY_DAYS_PER_REQUEST,
    `At most ${MAX_PLAY_DAYS_PER_REQUEST} day rows per request`
  );
export type PlayCountsRequest = z.infer<typeof playCountsRequestSchema>;

export interface PlayCountsResponse {
  accepted: number;
  ignored: number;
}

export interface TrackPlaysDevice {
  deviceId: string;
  name: string;
  platform: Platform;
  count: number;
  current: boolean;
}

export interface TrackPlays {
  trackId: string;
  total: number;
  devices: TrackPlaysDevice[];
}

export interface ReleasePlaysResponse {
  tracks: TrackPlays[];
}

/** Query of `GET /v1/plays/summary` (range rules that need the clock are checked by `PlaysService`). */
export const playsSummaryQuerySchema = z.object({
  from: daySchema,
  to: daySchema,
  cursor: uuidSchema.optional(),
});
export type PlaysSummaryQuery = z.infer<typeof playsSummaryQuerySchema>;

/** `devicePlays` is the calling device's own share of `plays` (the rest comes from the user's other devices). */
export interface PlaysSummaryResponse {
  tracks: Array<{ trackId: string; releaseId: string; plays: number; devicePlays: number; lastPlayedDay: string }>;
  allTime: Array<{ trackId: string; releaseId: string; plays: number; devicePlays: number }>;
  nextCursor: string | null;
}
