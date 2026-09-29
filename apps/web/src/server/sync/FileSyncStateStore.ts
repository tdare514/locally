import fs from "node:fs/promises";
import { settingsDir, syncStateFilePath } from "../config/paths";
import { SyncRecordSchema } from "./SyncRecord";
import { emptySyncState, type SyncState, type SyncStateStore } from "./SyncState";
import { z } from "zod";

const SyncStateFileSchema = z.object({
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
          return parsed.success ? [[id, parsed.data]] : [];
        }),
      ),
    ),
});

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

  async set(state: SyncState): Promise<SyncState> {
    await fs.mkdir(settingsDir(), { recursive: true });
    const file = syncStateFilePath();
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
    await fs.rename(tmp, file);
    return state;
  }
}
