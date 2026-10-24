import type { Release, Track } from "../shared/types";
import { asKnownItem, itemKey, type CollectionItem, type CollectionRecord, type KnownItem } from "../shared/collections";
import { moveItem } from "./track-order";
import { playOrder, type PlayQueue, type QueueItem } from "./play-queue";

/*
 * Collections on the Mac (#349), pure: resolving a collection's items against the library, building its play queue,
 * the sleeve, Side A / Side B, adding and reordering. Items this Mac cannot resolve are hidden and skipped, and stay
 * in the record; unknown kinds are never shown and are kept in place.
 */

/** One line of a collection as the page shows it: a release (its tracks are listed under it) or a single track. */
export interface CollectionRow {
  /** Index in the collection's full `items` (unknown kinds and hidden items count), the handle for edits. */
  index: number;
  item: KnownItem;
  release: Release;
  /** The tracks this row stands for, in play order; one for a track item. */
  tracks: Track[];
}

function releaseOf(releases: readonly Release[], id: string): Release | undefined {
  return releases.find((r) => r.id === id);
}

/** Every item this Mac can resolve, in order. Hidden: unknown kinds, a release it lacks, a track its release no longer has. */
export function collectionRows(items: readonly CollectionItem[], releases: readonly Release[]): CollectionRow[] {
  const rows: CollectionRow[] = [];
  items.forEach((raw, index) => {
    const item = asKnownItem(raw);
    if (!item) return;
    const release = releaseOf(releases, item.releaseId);
    if (!release) return;
    if (item.kind === "release") {
      const tracks = release.tracks
        .slice()
        .sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || a.trackNumber - b.trackNumber);
      rows.push({ index, item, release, tracks });
      return;
    }
    const track = release.tracks.find((t) => t.id === item.trackId);
    if (track) rows.push({ index, item, release, tracks: [track] });
  });
  return rows;
}

/** The queue's tracks: a release item becomes its tracks (disc, then track), a track item itself; a track whose file is gone is skipped. */
export function collectionQueueItems(items: readonly CollectionItem[], releases: readonly Release[]): QueueItem[] {
  const out: QueueItem[] = [];
  for (const row of collectionRows(items, releases)) {
    const playable =
      row.item.kind === "release"
        ? playOrder(row.release)
        : row.tracks.filter((t) => !t.missing);
    for (const t of playable) out.push({ releaseId: row.release.id, trackId: t.id });
  }
  return out;
}

/** The queue for playing a collection from `start` (an item of the queue; the first when absent). Null when nothing can play. */
export function buildCollectionQueue(
  collection: Pick<CollectionRecord, "id" | "items">,
  releases: readonly Release[],
  start?: QueueItem,
): PlayQueue | null {
  const items = collectionQueueItems(collection.items, releases);
  if (items.length === 0) return null;
  let index = 0;
  if (start) {
    const found = items.findIndex((i) => i.releaseId === start.releaseId && i.trackId === start.trackId);
    if (found < 0) return null;
    index = found;
  }
  return { items, index, context: { kind: "collection", id: collection.id } };
}

/** The queue for playing a collection from the item at `index` of its queue. Null when that position doesn't exist. */
export function buildCollectionQueueAt(
  collection: Pick<CollectionRecord, "id" | "items">,
  releases: readonly Release[],
  index: number,
): PlayQueue | null {
  const items = collectionQueueItems(collection.items, releases);
  if (!Number.isInteger(index) || index < 0 || index >= items.length) return null;
  return { items, index, context: { kind: "collection", id: collection.id } };
}

/** Each row's tracks' positions in the collection's built queue (null for a track whose file is gone), same order as `rows[i].tracks`. */
export function rowQueuePositions(rows: readonly CollectionRow[]): (number | null)[][] {
  let next = 0;
  return rows.map((row) => row.tracks.map((t) => (t.missing ? null : next++)));
}

/**
 * A row is current only when the player's queue is this collection's, sits at the row's position in it, and the item
 * there is this row's track. The last check keeps a reorder made while it plays from lighting up the wrong row.
 */
export function isCurrentRow(
  queue: { items: readonly { releaseId: string; trackId: string }[]; index: number; context: { kind: string; id: string } } | null,
  collectionId: string,
  position: number | null,
  item: { releaseId: string; trackId: string },
): boolean {
  if (queue === null || position === null) return false;
  if (queue.context.kind !== "collection" || queue.context.id !== collectionId || queue.index !== position) return false;
  const at = queue.items[queue.index];
  return at !== undefined && at.releaseId === item.releaseId && at.trackId === item.trackId;
}

/** Side A and Side B: the queue split in half, the extra track on Side A. */
export function splitSides<T>(items: readonly T[]): { a: T[]; b: T[] } {
  const half = Math.ceil(items.length / 2);
  return { a: items.slice(0, half), b: items.slice(half) };
}

/** Release ids of the first four different covers among the items (one when only one), for the 2x2 sleeve. */
export function collectionCoverIds(items: readonly CollectionItem[], releases: readonly Release[]): string[] {
  const ids: string[] = [];
  for (const row of collectionRows(items, releases)) {
    if (!row.release.coverPath || ids.includes(row.release.id)) continue;
    ids.push(row.release.id);
    if (ids.length === 4) break;
  }
  return ids;
}

/** Tracks and seconds the collection holds, counting what this Mac can resolve (a missing file still counts as a track). */
export function collectionTotals(items: readonly CollectionItem[], releases: readonly Release[]): { tracks: number; seconds: number } {
  let tracks = 0;
  let seconds = 0;
  for (const row of collectionRows(items, releases)) {
    tracks += row.tracks.length;
    for (const t of row.tracks) seconds += t.durationSec ?? 0;
  }
  return { tracks, seconds };
}

export function trackCountLabel(n: number): string {
  return `${n} ${n === 1 ? "track" : "tracks"}`;
}

/** `items` with `additions` appended, skipping any already there (the same release or track item twice is refused by the API). */
export function addItems(items: readonly CollectionItem[], additions: readonly KnownItem[]): { items: CollectionItem[]; added: number } {
  const have = new Set(items.map(itemKey).filter((k): k is string => k !== null));
  const next = items.slice();
  let added = 0;
  for (const item of additions) {
    const key = itemKey(item)!;
    if (have.has(key)) continue;
    have.add(key);
    next.push(item);
    added++;
  }
  return { items: next, added };
}

/** Moves the visible row at `from` (an index among `rows`) to the slot of the visible row at `to`, leaving hidden and unknown items where they are relative to the rest. */
export function moveRow(items: readonly CollectionItem[], rows: readonly CollectionRow[], from: number, to: number): CollectionItem[] {
  const a = rows[from]?.index;
  const b = rows[to]?.index;
  if (a === undefined || b === undefined) return items.slice();
  return moveItem(items.slice(), a, b);
}

/** Drops the item at full index `index`. */
export function removeAt(items: readonly CollectionItem[], index: number): CollectionItem[] {
  return items.filter((_, i) => i !== index);
}

/** Live-region text for a keyboard or menu move: "Moved to 3 of 12". */
export function moveAnnouncement(position: number, count: number): string {
  return `Moved to ${position} of ${count}`;
}

/** The collections whose name matches every word typed (case and accent insensitive). */
export function filterCollections<T extends { name: string }>(collections: readonly T[], query: string, normalize: (s: string) => string): T[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return collections.slice();
  return collections.filter((c) => {
    const name = normalize(c.name);
    return words.every((w) => name.includes(w));
  });
}

/** The wording for a collection page and its Library row (plan "States and wording"). */
export const COLLECTIONS_COPY = {
  none: "Make your first collection: a mixtape of any tracks and releases.",
  emptyQueue: "Nothing here yet. Add tracks from any release or track row.",
  noneHere: "None of these tracks are on this Mac.",
  onYourMac: "On your Mac",
  failedToLoad: "Couldn't load your collections",
} as const;
