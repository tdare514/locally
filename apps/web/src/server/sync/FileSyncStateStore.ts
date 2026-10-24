import fs from "node:fs/promises";
import { settingsDir, syncStateFilePath } from "../config/paths";
import { SyncRecordSchema } from "./SyncRecord";
import { emptySyncState, type SyncState, type SyncStateStore } from "./SyncState";
import { z } from "zod";

const MissingMarkSchema = z.object({ firstSeenMissingAt: z.string(), stillMissing: z.boolean(), resentAt: z.string().optional() });

const SyncStateFileSchema = z.object({
  // Written by builds from #295 on; the owner's Hide choices, kept per release and server version.
  hiddenFromTray: z.record(z.string(), z.string()).default({}),
  // Written by builds from #307 on: when a re-push of an adopted release's localIds was last queued.
  localIdQueuedAt: z.record(z.string(), z.string()).optional(),
  localIdBackfilled: z.boolean().optional(),
  // Written by builds from #349 on: the collections pull cursor.
  collectionsVersion: z.number().int().min(0).optional().catch(undefined),
  // Written by builds from #182 on: shares from friends imported here, until their claim is confirmed.
  // The first builds kept one flat list; that shape fails here and is dropped, the one case it can re-offer a share.
  importedShares: z.record(z.string(), z.record(z.string(), z.string())).optional().catch(undefined),
  pushedUpdatedAt: z.record(z.string(), z.string()).default({}),
  uploadedFiles: z.record(z.string(), z.array(z.string())).default({}),
  coverHash: z.record(z.string(), z.string()).default({}),
  pendingFromPhone: z
    .record(z.string(), z.unknown())
    .default({})
    .transform((entries) =>
      Object.fromEntries(
        Object.entries(entries).flatMap(([id, raw]) => {
          const parsed = SyncRecordSchema.safeParse(raw);
          if (!parsed.success) return [];
          // The server version the record was pulled at, kept so a page pulled twice is not taken
          // for the phone sending it again (#172). Older files have none.
          const version = (raw as { version?: unknown }).version;
          return [[id, typeof version === "number" ? { ...parsed.data, version } : parsed.data]];
        }),
      ),
    ),
  // Written by builds from #172 on; a file without it, or an entry that doesn't parse, just means
  // the next check starts that release afresh.
  missingFiles: z
    .record(z.string(), z.unknown())
    .default({})
    .transform((entries) =>
      Object.fromEntries(
        Object.entries(entries).flatMap(([id, raw]) => {
          const parsed = MissingMarkSchema.safeParse(raw);
          return parsed.success ? [[id, parsed.data]] : [];
        }),
      ),
    ),
  // Written by builds from #218 on; a bad value is dropped, which just means the next reconcile checks.
  lastMissingFilesCheckAt: z.string().optional().catch(undefined),
});

/**
 * One writer at a time per process, shared by every store instance, so a Hide (#295) can't
 * interleave with a sync pass's write.
 */
let writeChain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => undefined);
  return run;
}

/** JSON-file backed {@link SyncStateStore}, next to `settings.json`. */
export class FileSyncStateStore implements SyncStateStore {
  async get(): Promise<SyncState> {
    const file = syncStateFilePath();
    try {
      const raw = await fs.readFile(file, "utf-8");
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        // Corrupt bookkeeping is safe to drop: the next reconcile rebuilds it.
        return emptySyncState();
      }
      const parsed = SyncStateFileSchema.safeParse(json);
      if (!parsed.success) return emptySyncState();
      return parsed.data;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") return emptySyncState();
      throw err;
    }
  }

  /**
   * Writes everything but the Hide list and the imported shares (#182): a sync pass reads the state, works for a while and writes
   * it back, and must not undo a Hide made meanwhile. The Hide list changes only through `update`.
   */
  set(state: SyncState): Promise<SyncState> {
    return exclusive(async () => {
      const current = await this.get();
      const { importedShares } = current;
      return this.write({ ...state, hiddenFromTray: current.hiddenFromTray, ...(importedShares ? { importedShares } : {}) });
    });
  }

  update(mutator: (current: SyncState) => SyncState | null): Promise<SyncState> {
    return exclusive(async () => {
      const current = await this.get();
      const next = mutator(current);
      return next ? this.write(next) : current;
    });
  }

  private async write(state: SyncState): Promise<SyncState> {
    await fs.mkdir(settingsDir(), { recursive: true });
    const file = syncStateFilePath();
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
    await fs.rename(tmp, file);
    return state;
  }
}
