import fs from "node:fs/promises";
import { z } from "zod";
import { playsFilePath, settingsDir } from "../config/paths";
import { emptyPlayCounts, type PlayCounts, type PlayCountStore } from "./PlayCountStore";

const FILE_MODE = 0o600;

const PlayCountsSchema = z.object({
  version: z.literal(1),
  tracks: z.record(
    z.string(),
    z.object({
      releaseId: z.string(),
      count: z.number().int().min(0),
      pushed: z.number().int().min(0),
    }),
  ),
});

/** JSON-file backed {@link PlayCountStore}: `plays.json` next to `settings.json`, owner-only. */
export class FilePlayCountStore implements PlayCountStore {
  /** Serialises read-modify-write cycles so concurrent increments never lose updates. */
  private queue: Promise<unknown> = Promise.resolve();
  /** In memory only: bumped by `resetPushed` so a push that began before it can't mark anything. */
  private epoch = 0;

  async get(): Promise<PlayCounts> {
    const file = playsFilePath();
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return emptyPlayCounts();
      throw err;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return emptyPlayCounts();
    }
    const parsed = PlayCountsSchema.safeParse(json);
    return parsed.success ? parsed.data : emptyPlayCounts();
  }

  increment(trackId: string, releaseId: string): Promise<void> {
    return this.mutate((counts) => {
      const entry = counts.tracks[trackId];
      counts.tracks[trackId] = entry
        ? { ...entry, releaseId, count: entry.count + 1 }
        : { releaseId, count: 1, pushed: 0 };
    });
  }

  removeRelease(releaseId: string): Promise<void> {
    return this.mutate((counts) => {
      for (const [trackId, entry] of Object.entries(counts.tracks)) {
        if (entry.releaseId === releaseId) delete counts.tracks[trackId];
      }
    });
  }

  pushedEpoch(): number {
    return this.epoch;
  }

  markPushed(sent: Record<string, number>, epoch: number): Promise<void> {
    if (epoch !== this.epoch) return Promise.resolve();
    return this.mutate((counts) => {
      // Checked again when this runs: a reset can land while the write waits its turn.
      if (epoch !== this.epoch) return;
      for (const [trackId, count] of Object.entries(sent)) {
        const entry = counts.tracks[trackId];
        if (entry && count > entry.pushed) entry.pushed = count;
      }
    });
  }

  resetPushed(): Promise<void> {
    this.epoch++;
    return this.mutate((counts) => {
      for (const entry of Object.values(counts.tracks)) entry.pushed = 0;
    });
  }

  private mutate(change: (counts: PlayCounts) => void): Promise<void> {
    const run = this.queue.then(async () => {
      const counts = await this.get();
      change(counts);
      await this.write(counts);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async write(counts: PlayCounts): Promise<void> {
    await fs.mkdir(settingsDir(), { recursive: true, mode: 0o700 });
    const file = playsFilePath();
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await fs.writeFile(tmp, JSON.stringify(counts, null, 2), { encoding: "utf-8", mode: FILE_MODE });
    await fs.chmod(tmp, FILE_MODE);
    await fs.rename(tmp, file);
  }
}
