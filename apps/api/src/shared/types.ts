/**
 * Contract between clients (apps/web, apps/ios) and this service. Mirrors
 * `spec/sync.md`'s record shape. Both the wire schema (zod, for runtime
 * validation) and the derived TypeScript types live here so route handlers
 * and services import a single source of truth.
 */
import { z } from "zod";
import { isRealDay } from "./days";

/** Both mirror `spec/sync-file-names.json`; `syncFileNameRules.test.ts` fails if they drift. */
export const SUPPORTED_FILE_EXT = ["mp3", "m4a", "jpg", "jpeg", "png"] as const;
export const MAX_FILE_NAME_BYTES = 255;

const utf8ByteLength = (name: string): number => new TextEncoder().encode(name).length;

/**
 * A bare filename: no path separators, an allowed extension, at most 255 UTF-8 bytes (the
 * filesystem limit; the iPhone counts bytes too). `allowOverLong` names a stored name that is
 * still accepted past the limit (a re-push of a name saved before the byte limit, #87).
 */
export const makeFileNameSchema = (allowOverLong: ReadonlySet<string> = new Set()) =>
  z
    .string()
    .refine((name) => utf8ByteLength(name) <= MAX_FILE_NAME_BYTES || allowOverLong.has(name), {
      message: `File name must be ${MAX_FILE_NAME_BYTES} bytes or fewer (UTF-8)`,
    })
    .refine((name) => !name.includes("/") && !name.includes("\\"), {
      message: "File name must not contain path separators",
    })
    .refine((name) => new RegExp(`\\.(${SUPPORTED_FILE_EXT.join("|")})$`, "i").test(name), {
      message: `File name must end in one of: ${SUPPORTED_FILE_EXT.join(", ")}`,
    });

export const fileNameSchema = makeFileNameSchema();

export const uuidSchema = z.string().uuid("Must be a UUID");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Must be a valid email address")
  .max(320);

export const platformSchema = z.enum(["mac", "ios"]);
export type Platform = z.infer<typeof platformSchema>;
/**
 * What the `devices.platform` column can hold. `"cloud"` is the sampler's own device (#303, #306): it is never
 * accepted from a client (`platformSchema` stays `mac | ios`), only read back in play lists.
 */
export type DevicePlatform = Platform | "cloud";

const isoDateSchema = z.string().datetime({ offset: true, message: "Must be an ISO 8601 timestamp" });

/** `tracks[]` entry inside a release record. */
const makeTrackRecordSchema = (fileName: z.ZodType<string>) => z.object({
  id: uuidSchema,
  title: z.string().min(1).max(500),
  trackNumber: z.number().int().positive(),
  /** Which disc of a multi-disc release this track is on; absent on a single-disc release. */
  discNumber: z.number().int().min(1).max(99).optional(),
  /** The `spotify:local:` id the Mac stored when it adopted this file (#303); sent for adopted tracks only. */
  localId: z.string().max(1000).startsWith("spotify:local:").optional(),
  file: fileName,
  bytes: z.number().int().nonnegative(),
  durationSec: z.number().nonnegative().nullable(),
});
export const trackRecordSchema = makeTrackRecordSchema(fileNameSchema);
export type TrackRecord = z.infer<typeof trackRecordSchema>;

/** The `release.json` document from `spec/sync.md`, as sent in `PUT /v1/releases/:id`. */
/** Lowercase hex sha256 of a cover's bytes; the change signal for `cover.<ext>`, whose name never changes. */
export const coverHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

const isLeapYear = (year: number): boolean => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

/** Assumes the `YYYY-MM` or `YYYY-MM-DD` shape; checks the day against the month's length. */
function isRealCalendarDate(value: string): boolean {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = value.length > 7 ? Number(value.slice(8, 10)) : 1;
  const monthLengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthLengths[month - 1]!;
}

/** A release date more precise than its year (#221): `YYYY-MM` or `YYYY-MM-DD`, a real calendar date. A bare year is `year` alone. */
export const releaseDateSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/, "Must be YYYY-MM or YYYY-MM-DD")
  .refine(isRealCalendarDate, "Must be a real calendar date");

const makeReleaseRecordSchema = (fileName: z.ZodType<string>) => z.object({
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
  /** Absent when only the year is known; when present, `year` is its first four characters (#221). */
  releaseDate: releaseDateSchema.optional(),
  genre: z.string().max(200).nullable(),
  cover: fileName.nullable(),
  /** Absent on `syncVersion` 1 records (no signal); `null` on a v2 record with no cover. */
  coverHash: coverHashSchema.nullable().optional(),
  tracks: z.array(makeTrackRecordSchema(fileName)).min(1).max(500),
  /** `"adopted"`: details-only release adopted in place on the Mac (#246); absent otherwise. Any other value is a 400. */
  source: z.literal("adopted").optional(),
  origin: platformSchema,
  originDevice: z.string().min(1).max(200),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  deleted: z.boolean(),
}).superRefine((record, ctx) => {
  if (record.releaseDate !== undefined && record.releaseDate.slice(0, 4) !== record.year) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["releaseDate"], message: "Must match year" });
  }
});
export const releaseRecordSchema = makeReleaseRecordSchema(fileNameSchema);

/** The PUT body schema for a release that already stores `storedLongNames` (see `makeFileNameSchema`). */
export const releaseRecordSchemaKeeping = (storedLongNames: ReadonlySet<string>) =>
  makeReleaseRecordSchema(makeFileNameSchema(storedLongNames));
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
  /** A Mac's stable install ID (#210). Used only when `platform` is `mac`. */
  installId: z.string().uuid("installId must be a UUID").optional(),
});
export type VerifyRequest = z.infer<typeof verifyRequestSchema>;

const makeFilesUploadRequestSchema = (fileName: z.ZodType<string>) => z.object({
  files: z
    .array(
      z.object({
        name: fileName,
        bytes: z.number().int().positive(),
        contentType: z.string().min(1).max(200),
      })
    )
    .min(1)
    .max(50),
});

export const filesUploadRequestSchema = makeFilesUploadRequestSchema(fileNameSchema);
/** The upload body schema for a release that already stores `storedLongNames` (see `makeFileNameSchema`). */
export const filesUploadRequestSchemaKeeping = (storedLongNames: ReadonlySet<string>) =>
  makeFilesUploadRequestSchema(makeFileNameSchema(storedLongNames));
export type FilesUploadRequest = z.infer<typeof filesUploadRequestSchema>;

export interface UserSummary {
  id: string;
  email: string;
}

export interface DeviceSummary {
  id: string;
  name: string;
  platform: DevicePlatform;
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
  /** Whether public share links are switched on (`PUBLIC_SHARES_ENABLED`, #146); clients hide the Link option when false. */
  publicSharesEnabled: boolean;
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
  platform: DevicePlatform;
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

// --- Shares (#146, #181; spec/sync.md "Shares") ---

/** Most reshare levels: an original share is depth 0, its reshare 1, and so on up to this. */
export const MAX_SHARE_DEPTH = 3;
/** A share's track ids and a create body's recipients are capped at these. */
export const MAX_SHARE_TRACKS = 500;
export const MAX_SHARE_RECIPIENTS = 50;

/** The release record's own fields at share time; `tracks` is filtered to the shared ones. */
export interface ShareSnapshot {
  kind: "single" | "album";
  title: string;
  artist: string;
  year: string | null;
  /** Omitted when the record has none. */
  releaseDate?: string;
  genre: string | null;
  cover: string | null;
  coverHash: string | null;
  tracks: Array<{
    id: string;
    title: string;
    trackNumber: number;
    /** Omitted when absent. */
    discNumber?: number;
    file: string;
    bytes: number;
    /** Omitted when the record has none. */
    durationSec?: number;
  }>;
}

export interface SentShare {
  id: string;
  releaseId: string;
  trackIds: string[] | null;
  visibility: "private" | "public";
  allowReshare: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  snapshot: ShareSnapshot;
  recipients: Array<{ email: string; claimedAt: string | null }>;
  hasLink: boolean;
  parentShareId: string | null;
  downloads: number;
}

export interface ReceivedShare {
  id: string;
  from: { email: string };
  trackIds: string[] | null;
  allowReshare: boolean;
  /** `allowReshare` and the share's depth is below `MAX_SHARE_DEPTH`. */
  canReshare: boolean;
  expiresAt: string | null;
  createdAt: string;
  claimedAt: string | null;
  snapshot: ShareSnapshot;
}

const expiresInDaysSchema = z.union([z.literal(7), z.literal(30), z.null()]).default(null);

/** Body of `POST /v1/shares`. */
export const createShareRequestSchema = z.object({
  releaseId: uuidSchema,
  trackIds: z.array(uuidSchema).min(1).max(MAX_SHARE_TRACKS).nullable().optional(),
  recipients: z.array(emailSchema).max(MAX_SHARE_RECIPIENTS),
  visibility: z.enum(["private", "public"]),
  allowReshare: z.boolean(),
  expiresInDays: expiresInDaysSchema,
});
export type CreateShareRequest = z.infer<typeof createShareRequestSchema>;

/** Body of `POST /v1/shares/:id/reshare`. */
export const reshareRequestSchema = z.object({
  recipients: z.array(emailSchema).max(MAX_SHARE_RECIPIENTS),
  visibility: z.enum(["private", "public"]),
  allowReshare: z.boolean(),
  expiresInDays: expiresInDaysSchema,
});
export type ReshareRequest = z.infer<typeof reshareRequestSchema>;

/** Query of `GET /v1/shares`. */
export const listSharesQuerySchema = z.object({
  role: z.enum(["sent", "received"]),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListSharesQuery = z.infer<typeof listSharesQuerySchema>;

/** Body of `POST /v1/links/claim`. */
export const claimLinkRequestSchema = z.object({ token: z.string().min(1).max(200) });

export interface CreateShareResponse {
  share: SentShare | null;
  notOnLocally: string[];
  link: string | null;
}
