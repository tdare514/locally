import { z } from "zod";

/*
 * Collections (#339, step 2): named mixtapes of releases and tracks in the owner's order. The record is the wire
 * shape of `spec/sync.md` "Collections (#339)" and the shared fixtures in `spec/fixtures/collections/`.
 * Pure: no node imports, used by the client, the local routes, the store and the sync engine.
 */

export const COLLECTION_NAME_MAX = 100;
export const COLLECTION_ITEMS_MAX = 1000;
/** An unknown item kind: lowercase, starts with a letter, at most 16 characters (the API's rule). */
const UNKNOWN_KIND = /^[a-z][a-z0-9-]{0,15}$/;
const UNKNOWN_ITEM_MAX_BYTES = 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type KnownItem =
  | { kind: "release"; releaseId: string }
  | { kind: "track"; releaseId: string; trackId: string };

/**
 * One item as stored and sent. A kind this app does not know is kept exactly as received (every key) and
 * re-pushed unchanged; it is never shown (`asKnownItem` returns null for it).
 */
export type CollectionItem = { kind: string; [key: string]: unknown };

/** The record as it travels on the wire (`spec/fixtures/collections/valid.json`). */
export interface CollectionRecord {
  syncVersion: 1;
  id: string;
  name: string;
  items: CollectionItem[];
  origin: string;
  originDevice: string;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
}

/** A well-formed `release` or `track` item, else null (an unknown kind, or a malformed known one). */
export function asKnownItem(item: CollectionItem): KnownItem | null {
  const keys = Object.keys(item).sort().join(",");
  if (item.kind === "release" && keys === "kind,releaseId" && typeof item.releaseId === "string") {
    return { kind: "release", releaseId: item.releaseId };
  }
  if (
    item.kind === "track" &&
    keys === "kind,releaseId,trackId" &&
    typeof item.releaseId === "string" &&
    typeof item.trackId === "string"
  ) {
    return { kind: "track", releaseId: item.releaseId, trackId: item.trackId };
  }
  return null;
}

/** Two items name the same thing: the same release item, or the same track item. */
export function itemKey(item: CollectionItem): string | null {
  const known = asKnownItem(item);
  if (!known) return null;
  return known.kind === "release" ? `release/${known.releaseId}` : `track/${known.releaseId}/${known.trackId}`;
}

/** The name trimmed, or null when it is empty, too long (over 100 characters) or holds a control character. */
export function cleanCollectionName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (name.length === 0 || [...name].length > COLLECTION_NAME_MAX) return null;
  if (/\p{Cc}/u.test(name)) return null;
  return name;
}

/**
 * Checks the items the Mac is about to write: a known kind must be strict (right keys, UUID ids), any other kind
 * must match the kind rule and stay under 1 KiB, the list holds at most 1,000 and no item twice. Returns the
 * items untouched, or a reason.
 */
export function validateItems(raw: unknown): { ok: true; items: CollectionItem[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "items must be a list" };
  if (raw.length > COLLECTION_ITEMS_MAX) return { ok: false, error: `A collection holds at most ${COLLECTION_ITEMS_MAX} items` };
  const seen = new Set<string>();
  const items: CollectionItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry) || typeof (entry as { kind?: unknown }).kind !== "string") {
      return { ok: false, error: "Each item needs a kind" };
    }
    const item = entry as CollectionItem;
    if (item.kind === "release" || item.kind === "track") {
      const known = asKnownItem(item);
      if (!known || !UUID.test(known.releaseId) || (known.kind === "track" && !UUID.test(known.trackId))) {
        return { ok: false, error: `A ${item.kind} item is malformed` };
      }
      const key = itemKey(item)!;
      if (seen.has(key)) return { ok: false, error: "The same item is in the collection twice" };
      seen.add(key);
    } else if (!UNKNOWN_KIND.test(item.kind) || new TextEncoder().encode(JSON.stringify(item)).length > UNKNOWN_ITEM_MAX_BYTES) {
      return { ok: false, error: "An item has a kind this app cannot keep" };
    }
    items.push(item);
  }
  return { ok: true, items };
}

const LooseItemSchema = z.looseObject({ kind: z.string() });

/**
 * A record read from disk or from the service. Items are read loosely (every key of an unknown kind survives,
 * even from a newer client); a record that is not an object of this shape is rejected whole.
 */
export const CollectionRecordSchema = z.object({
  syncVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string(),
  items: z.array(LooseItemSchema),
  origin: z.string(),
  originDevice: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deleted: z.boolean(),
});

export function parseCollectionRecord(raw: unknown): CollectionRecord | null {
  const parsed = CollectionRecordSchema.safeParse(raw);
  return parsed.success ? (parsed.data as CollectionRecord) : null;
}

/** A page of `GET /v1/collections`. */
export interface CollectionsPage {
  collections: (CollectionRecord & { version: number })[];
  nextVersion: number;
  hasMore: boolean;
}

/** Body of `POST /api/collections`. */
export const CreateCollectionSchema = z.object({ name: z.string(), items: z.array(z.unknown()).optional() }).strict();
/** Body of `PUT /api/collections/:id`: the whole new name and/or item list. */
export const UpdateCollectionSchema = z.object({ name: z.string().optional(), items: z.array(z.unknown()).optional() }).strict();

/** The plan's wording when the service holds as many collections as it allows (1,000). */
export const TOO_MANY_COLLECTIONS =
  "You have the most collections the sync service holds (1,000). This one stays on this Mac until you delete another.";
