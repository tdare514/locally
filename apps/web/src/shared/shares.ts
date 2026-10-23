import { z } from "zod";

/**
 * Wire shapes for sharing (#146, #182): exactly the names and types of `spec/sync.md` "Shares" and
 * `apps/api/src/shared/types.ts`. camelCase, times as ISO strings. Parsed with zod where a reply
 * comes in, so a reply that doesn't match is refused rather than half-used. No node imports.
 */

export const ShareSnapshotSchema = z.object({
  kind: z.enum(["single", "album"]),
  title: z.string(),
  artist: z.string(),
  year: z.string().nullable(),
  /** Omitted, never null, when the record has none. */
  releaseDate: z.string().optional(),
  genre: z.string().nullable(),
  cover: z.string().nullable(),
  coverHash: z.string().nullable(),
  tracks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      trackNumber: z.number().int(),
      discNumber: z.number().int().optional(),
      file: z.string(),
      bytes: z.number(),
      durationSec: z.number().optional(),
    })
  ),
});
export type ShareSnapshot = z.infer<typeof ShareSnapshotSchema>;

export const SentShareSchema = z.object({
  id: z.string(),
  releaseId: z.string(),
  trackIds: z.array(z.string()).nullable(),
  visibility: z.enum(["private", "public"]),
  allowReshare: z.boolean(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  snapshot: ShareSnapshotSchema,
  recipients: z.array(z.object({ email: z.string(), claimedAt: z.string().nullable() })),
  hasLink: z.boolean(),
  parentShareId: z.string().nullable(),
  downloads: z.number().int(),
});
export type SentShare = z.infer<typeof SentShareSchema>;

export const ReceivedShareSchema = z.object({
  id: z.string(),
  from: z.object({ email: z.string() }),
  trackIds: z.array(z.string()).nullable(),
  allowReshare: z.boolean(),
  canReshare: z.boolean(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  claimedAt: z.string().nullable(),
  snapshot: ShareSnapshotSchema,
});
export type ReceivedShare = z.infer<typeof ReceivedShareSchema>;

export const SentSharesPageSchema = z.object({ shares: z.array(SentShareSchema), nextCursor: z.string().nullable() });
export const ReceivedSharesPageSchema = z.object({ shares: z.array(ReceivedShareSchema), nextCursor: z.string().nullable() });
export type SentSharesPage = z.infer<typeof SentSharesPageSchema>;
export type ReceivedSharesPage = z.infer<typeof ReceivedSharesPageSchema>;

export const CreateShareResponseSchema = z.object({
  share: SentShareSchema.nullable(),
  notOnLocally: z.array(z.string()),
  link: z.string().nullable(),
});
export type CreateShareResponse = z.infer<typeof CreateShareResponseSchema>;

/** Body of `POST /v1/shares`. */
export interface CreateShareRequest {
  releaseId: string;
  trackIds?: string[] | null;
  recipients: string[];
  visibility: "private" | "public";
  allowReshare: boolean;
  expiresInDays: 7 | 30 | null;
}

export const MAX_SHARE_RECIPIENTS = 50;

/** A saved group of recipient emails, kept in this Mac's settings only (the plan: client-side). */
export interface ShareGroup {
  id: string;
  name: string;
  emails: string[];
}

/** What a tray row needs of a received share (no file names or track ids the browser doesn't use). */
export interface FriendShare {
  id: string;
  fromEmail: string;
  title: string;
  artist: string;
  kind: "single" | "album";
  trackCount: number;
  hasCover: boolean;
  createdAt: string;
}

/** `GET /api/shares/options`. */
export interface ShareOptions {
  signedIn: boolean;
  publicSharesEnabled: boolean;
}

/** `GET /api/shares?role=sent`, as the Settings list and the delete confirm read it. */
export interface SentSharesView {
  shares: SentShare[];
  nextCursor: string | null;
}

/** Trimmed and lower-cased, as the service does. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** A deliberately plain check (one @, a dot in the domain, no spaces); the service has the last word. */
export function isPlausibleEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]+$/.test(email);
}

export const MAX_SHARE_GROUPS = 30;
export const MAX_GROUP_NAME = 40;

/** Narrows stored or posted JSON into saved groups: bad entries are dropped, emails normalised and de-duplicated. */
export function parseShareGroups(raw: unknown): ShareGroup[] {
  if (!Array.isArray(raw)) return [];
  const groups: ShareGroup[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const g = item as Partial<ShareGroup>;
    if (typeof g.id !== "string" || g.id.length === 0 || g.id.length > 64) continue;
    const name = typeof g.name === "string" ? g.name.trim().slice(0, MAX_GROUP_NAME) : "";
    if (!name || !Array.isArray(g.emails)) continue;
    const emails = [
      ...new Set(g.emails.filter((e): e is string => typeof e === "string").map(normalizeEmail).filter(isPlausibleEmail)),
    ].slice(0, MAX_SHARE_RECIPIENTS);
    if (emails.length === 0) continue;
    groups.push({ id: g.id, name, emails });
    if (groups.length >= MAX_SHARE_GROUPS) break;
  }
  return groups;
}

/** Body the Mac's own `POST /api/shares` accepts: the service's create body, checked the same way. */
export const CreateShareBodySchema = z.object({
  releaseId: z.string().min(1).max(128),
  trackIds: z.array(z.string().min(1).max(128)).min(1).max(500).nullable().optional(),
  recipients: z.array(z.string().max(254)).max(MAX_SHARE_RECIPIENTS),
  visibility: z.enum(["private", "public"]),
  allowReshare: z.boolean(),
  expiresInDays: z.union([z.literal(7), z.literal(30), z.null()]),
});
