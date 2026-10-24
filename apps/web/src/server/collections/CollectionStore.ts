import type { CollectionItem, CollectionRecord } from "../../shared/collections";

/** One stored collection: the record, and the `updatedAt` last accepted by the service (null: never pushed). */
export interface StoredCollection {
  record: CollectionRecord;
  pushed: string | null;
}

/** What `applyRemote` did with a pulled record. */
export type RemoteOutcome = "applied" | "kept-local" | "unchanged";

/**
 * Collections on this Mac (#349): the records plus a pushed marker each. Tombstones (`deleted: true`) stay until
 * the service has them, so a delete is pushed; `list` never returns them.
 */
export interface CollectionStore {
  /** Live collections, oldest first. */
  list(): Promise<CollectionRecord[]>;
  create(input: { name: string; items: CollectionItem[]; originDevice: string }): Promise<CollectionRecord>;
  /** Replaces the name and/or the items. Null when the collection is not there (or deleted). */
  update(id: string, patch: { name?: string; items?: CollectionItem[] }): Promise<CollectionRecord | null>;
  /** Tombstones it. False when it is not there. */
  remove(id: string): Promise<boolean>;
  /** Every stored entry, tombstones included, for the sync engine. */
  entries(): Promise<StoredCollection[]>;
  /** Records that `updatedAt` of this collection reached the service. Ignored when it changed meanwhile. */
  markPushed(id: string, updatedAt: string): Promise<void>;
  /** Last writer wins on the whole record; a local copy with unpushed newer edits is kept. */
  applyRemote(record: CollectionRecord): Promise<RemoteOutcome>;
  /** The account this file's pushed markers belong to; a different one clears every marker. */
  bindAccount(key: string | null): Promise<void>;
}
