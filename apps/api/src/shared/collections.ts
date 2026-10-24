import { z } from "zod";
import { platformSchema, uuidSchema } from "./types";

/** Collection wire contract (#339, `spec/sync.md` "Collections"). */

export const MAX_COLLECTION_ITEMS = 1000;
export const MAX_LIVE_COLLECTIONS = 1000;
/** A whole record, as JSON, is at most this many bytes. */
export const MAX_COLLECTION_BYTES = 256 * 1024;
/** An item of a kind this API doesn't know is stored unchanged up to this many bytes of JSON. */
export const MAX_UNKNOWN_ITEM_BYTES = 1024;

const isoDateSchema = z.string().datetime({ offset: true, message: "Must be an ISO 8601 timestamp" });
const unknownKindPattern = /^[a-z][a-z0-9-]{0,15}$/;
const controlChars = /[\u0000-\u001f\u007f-\u009f]/;

const releaseItemSchema = z.object({ kind: z.literal("release"), releaseId: uuidSchema }).strict();
const trackItemSchema = z.object({ kind: z.literal("track"), releaseId: uuidSchema, trackId: uuidSchema }).strict();

export type CollectionItem = Record<string, unknown> & { kind: string };

/**
 * `release` and `track` items are strict (a known kind with a bad shape is a 400). Any other well-formed `kind`
 * is kept exactly as sent, so a newer client's items survive this API.
 */
export const collectionItemSchema = z.record(z.string(), z.unknown()).superRefine((item, ctx) => {
  const kind = item.kind;
  if (typeof kind !== "string" || !unknownKindPattern.test(kind)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Item kind must match ^[a-z][a-z0-9-]{0,15}$" });
    return;
  }
  if (kind === "release" || kind === "track") {
    const result = (kind === "release" ? releaseItemSchema : trackItemSchema).safeParse(item);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
      }
    }
    return;
  }
  if (Buffer.byteLength(JSON.stringify(item), "utf8") > MAX_UNKNOWN_ITEM_BYTES) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Item of kind "${kind}" is over ${MAX_UNKNOWN_ITEM_BYTES} bytes` });
  }
}) as unknown as z.ZodType<CollectionItem>;

const nameSchema = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => [...s].length >= 1 && [...s].length <= 100, "Name must be 1 to 100 characters")
  .refine((s) => !controlChars.test(s), "Name must not contain control characters");

export const collectionRecordSchema = z
  .object({
    syncVersion: z.literal(1),
    id: uuidSchema,
    name: nameSchema,
    items: z.array(collectionItemSchema).max(MAX_COLLECTION_ITEMS),
    origin: platformSchema,
    originDevice: z.string().min(1).max(200),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
    deleted: z.boolean(),
  })
  .superRefine((record, ctx) => {
    const seen = new Set<string>();
    record.items.forEach((item, index) => {
      if (item.kind !== "release" && item.kind !== "track") return;
      const key = item.kind === "release" ? `r:${item.releaseId}` : `t:${item.releaseId}:${item.trackId}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index], message: "Duplicate item" });
      }
      seen.add(key);
    });
    if (Buffer.byteLength(JSON.stringify(record), "utf8") > MAX_COLLECTION_BYTES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Collection is over 256 KiB" });
    }
  });

export type CollectionRecord = z.infer<typeof collectionRecordSchema>;

/** A collection record as returned to clients: the record plus sync bookkeeping. */
export interface CollectionRecordWithVersion extends CollectionRecord {
  version: number;
  serverUpdatedAt: string;
}
