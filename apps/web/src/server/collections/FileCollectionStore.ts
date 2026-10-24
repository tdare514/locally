import crypto from "node:crypto";
import fs from "node:fs/promises";
import { z } from "zod";
import { parseCollectionRecord, type CollectionItem, type CollectionRecord } from "../../shared/collections";
import { collectionsFilePath, settingsDir } from "../config/paths";
import type { CollectionStore, RemoteOutcome, StoredCollection } from "./CollectionStore";

const FILE_MODE = 0o600;

const FileSchema = z.object({
  account: z.string().nullable().optional().catch(null),
  collections: z.record(z.string(), z.unknown()).default({}),
});

interface FileData {
  account: string | null;
  collections: Record<string, StoredCollection>;
}

/** JSON-file backed {@link CollectionStore}: `collections.json` next to `settings.json`, owner-only, atomic writes. */
export class FileCollectionStore implements CollectionStore {
  /** Serialises read-modify-write cycles. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async list(): Promise<CollectionRecord[]> {
    const data = await this.read();
    return Object.values(data.collections)
      .map((e) => e.record)
      .filter((r) => !r.deleted)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async entries(): Promise<StoredCollection[]> {
    return Object.values((await this.read()).collections);
  }

  create(input: { name: string; items: CollectionItem[]; originDevice: string }): Promise<CollectionRecord> {
    return this.mutate((data) => {
      const at = this.now().toISOString();
      const record: CollectionRecord = {
        syncVersion: 1,
        id: crypto.randomUUID(),
        name: input.name,
        items: input.items,
        origin: "mac",
        originDevice: input.originDevice,
        createdAt: at,
        updatedAt: at,
        deleted: false,
      };
      data.collections[record.id] = { record, pushed: null };
      return record;
    });
  }

  update(id: string, patch: { name?: string; items?: CollectionItem[] }): Promise<CollectionRecord | null> {
    return this.mutate((data) => {
      const entry = data.collections[id];
      if (!entry || entry.record.deleted) return null;
      entry.record = {
        ...entry.record,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.items !== undefined ? { items: patch.items } : {}),
        updatedAt: this.nextStamp(entry.record.updatedAt),
      };
      return entry.record;
    });
  }

  remove(id: string): Promise<boolean> {
    return this.mutate((data) => {
      const entry = data.collections[id];
      if (!entry || entry.record.deleted) return false;
      entry.record = { ...entry.record, deleted: true, updatedAt: this.nextStamp(entry.record.updatedAt) };
      return true;
    });
  }

  async markPushed(id: string, updatedAt: string): Promise<void> {
    await this.mutate((data) => {
      const entry = data.collections[id];
      if (entry && entry.record.updatedAt === updatedAt) entry.pushed = updatedAt;
    });
  }

  applyRemote(record: CollectionRecord): Promise<RemoteOutcome> {
    return this.mutate((data): RemoteOutcome => {
      const entry = data.collections[record.id];
      if (entry) {
        const localUnpushed = entry.pushed !== entry.record.updatedAt;
        if (localUnpushed && entry.record.updatedAt > record.updatedAt) return "kept-local";
        if (!localUnpushed && entry.record.updatedAt === record.updatedAt && JSON.stringify(entry.record) === JSON.stringify(record)) {
          return "unchanged";
        }
      }
      data.collections[record.id] = { record, pushed: record.updatedAt };
      return "applied";
    });
  }

  async bindAccount(key: string | null): Promise<void> {
    await this.mutate((data) => {
      if (data.account === key) return;
      // A different account or host: nothing is known to be there, so everything is sent again.
      data.account = key;
      for (const entry of Object.values(data.collections)) entry.pushed = null;
    });
  }

  /** An edit's stamp: now, but never at or before the previous one, so a quick second edit still counts as newer. */
  private nextStamp(previous: string): string {
    const now = this.now().getTime();
    const prev = Date.parse(previous);
    return new Date(Number.isFinite(prev) && prev >= now ? prev + 1 : now).toISOString();
  }

  private async read(): Promise<FileData> {
    let raw: string;
    try {
      raw = await fs.readFile(collectionsFilePath(), "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return { account: null, collections: {} };
      throw err;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { account: null, collections: {} };
    }
    const parsed = FileSchema.safeParse(json);
    if (!parsed.success) return { account: null, collections: {} };
    const collections: Record<string, StoredCollection> = {};
    for (const [id, value] of Object.entries(parsed.data.collections)) {
      const v = value as { record?: unknown; pushed?: unknown } | null;
      const record = parseCollectionRecord(v?.record);
      if (!record || record.id !== id) continue;
      collections[id] = { record, pushed: typeof v?.pushed === "string" ? v.pushed : null };
    }
    return { account: parsed.data.account ?? null, collections };
  }

  private mutate<T>(change: (data: FileData) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const data = await this.read();
      const before = JSON.stringify(data);
      const result = change(data);
      if (JSON.stringify(data) !== before) await this.write(data);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async write(data: FileData): Promise<void> {
    await fs.mkdir(settingsDir(), { recursive: true, mode: 0o700 });
    const file = collectionsFilePath();
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: FILE_MODE });
    await fs.chmod(tmp, FILE_MODE);
    await fs.rename(tmp, file);
  }
}
