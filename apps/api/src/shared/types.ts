/**
 * Contract between clients (apps/web, apps/ios) and this service. Mirrors
 * `spec/sync.md`'s record shape. Both the wire schema (zod, for runtime
 * validation) and the derived TypeScript types live here so route handlers
 * and services import a single source of truth.
 */
import { z } from "zod";

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
  file: fileNameSchema,
  bytes: z.number().int().nonnegative(),
  durationSec: z.number().nonnegative().nullable(),
});
export type TrackRecord = z.infer<typeof trackRecordSchema>;

/** The `release.json` document from `spec/sync.md`, as sent in `PUT /v1/releases/:id`. */
export const releaseRecordSchema = z.object({
  syncVersion: z.literal(1),
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
  tracks: z.array(trackRecordSchema).min(1),
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
