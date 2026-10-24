import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { z } from "zod";
import { playEventsFilePath, settingsDir } from "../config/paths";
import { parseDay, RETENTION_DAYS, localDay } from "./playDays";
import {
  MAX_EVENT_LISTENED_MS,
  MAX_PLAY_EVENTS,
  type PlayEvent,
  type PlayEventInput,
  type PlayEventStore,
} from "./PlayEventStore";

const FILE_MODE = 0o600;
const MS_PER_DAY = 86_400_000;

const EventSchema = z.object({
  id: z.string().min(1),
  releaseId: z.string().min(1),
  trackId: z.string().min(1),
  source: z.enum(["spotify", "locally"]),
  startedAt: z.number().int().min(0),
  day: z.string().refine((d) => parseDay(d) !== null),
  listenedMs: z.number().int().min(0).max(MAX_EVENT_LISTENED_MS),
  pushedListenedMs: z.number().int().min(0).max(MAX_EVENT_LISTENED_MS).nullable(),
});

/** JSON-file backed {@link PlayEventStore}: `play-events.json` next to `plays.json`, owner-only. */
export class FilePlayEventStore implements PlayEventStore {
  /** Serialises read-modify-write cycles so concurrent reports never lose updates. */
  private queue: Promise<unknown> = Promise.resolve();
  /** In memory only: bumped by `resetPushed` so a push that began before it can't mark anything. */
  private epoch = 0;

  /** `now` decides the 400-day prune and `timeZone` the day of a new event; tests inject them. */
  constructor(
    private readonly now: () => number = Date.now,
    private readonly timeZone?: string,
  ) {}

  async list(): Promise<PlayEvent[]> {
    let raw: string;
    try {
      raw = await fs.readFile(playEventsFilePath(), "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
      throw err;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return [];
    }
    const list = (json as { events?: unknown } | null)?.events;
    if (!Array.isArray(list)) return [];
    // One bad entry is dropped, never the rest.
    const events: PlayEvent[] = [];
    for (const item of list) {
      const parsed = EventSchema.safeParse(item);
      if (parsed.success) events.push(parsed.data);
    }
    return events;
  }

  record(input: PlayEventInput): Promise<boolean> {
    const listenedMs = clampMs(input.listenedMs);
    return this.mutate((events) => {
      const existing = events.find(
        (e) => e.source === input.source && e.trackId === input.trackId && e.startedAt === input.startedAt,
      );
      if (existing) {
        if (listenedMs > existing.listenedMs) existing.listenedMs = listenedMs;
        return false;
      }
      events.push({
        id: randomUUID(),
        releaseId: input.releaseId,
        trackId: input.trackId,
        source: input.source,
        startedAt: input.startedAt,
        day: localDay(input.startedAt, this.timeZone),
        listenedMs,
        pushedListenedMs: null,
      });
      return true;
    });
  }

  removeRelease(releaseId: string): Promise<void> {
    return this.mutate((events) => {
      for (let i = events.length - 1; i >= 0; i--) if (events[i].releaseId === releaseId) events.splice(i, 1);
    }).then(() => undefined);
  }

  pushedEpoch(): number {
    return this.epoch;
  }

  markPushed(sent: Record<string, number>, epoch: number): Promise<void> {
    if (epoch !== this.epoch) return Promise.resolve();
    return this.mutate((events) => {
      // Checked again when this runs: a reset can land while the write waits its turn.
      if (epoch !== this.epoch) return;
      for (const event of events) {
        const ms = sent[event.id];
        if (ms !== undefined && ms > (event.pushedListenedMs ?? -1)) event.pushedListenedMs = Math.min(ms, event.listenedMs);
      }
    }).then(() => undefined);
  }

  resetPushed(): Promise<void> {
    this.epoch++;
    return this.mutate((events) => {
      for (const event of events) event.pushedListenedMs = null;
    }).then(() => undefined);
  }

  private mutate<T>(change: (events: PlayEvent[]) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const events = await this.list();
      const result = change(events);
      await this.write(this.trim(events));
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Events older than 400 days go, then the oldest pushed ones past the cap, then (only if still over) the oldest. */
  private trim(events: PlayEvent[]): PlayEvent[] {
    const cutoff = this.now() - RETENTION_DAYS * MS_PER_DAY;
    let kept = events.filter((e) => e.startedAt >= cutoff);
    if (kept.length <= MAX_PLAY_EVENTS) return kept;
    let excess = kept.length - MAX_PLAY_EVENTS;
    const byAge = [...kept].sort((a, b) => a.startedAt - b.startedAt);
    const drop = new Set<PlayEvent>();
    for (const e of byAge) {
      if (excess === 0) break;
      if (e.pushedListenedMs !== null) {
        drop.add(e);
        excess--;
      }
    }
    for (const e of byAge) {
      if (excess === 0) break;
      if (!drop.has(e)) {
        drop.add(e);
        excess--;
      }
    }
    kept = kept.filter((e) => !drop.has(e));
    return kept;
  }

  private async write(events: PlayEvent[]): Promise<void> {
    await fs.mkdir(settingsDir(), { recursive: true, mode: 0o700 });
    const file = playEventsFilePath();
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await fs.writeFile(tmp, JSON.stringify({ version: 1, events }), { encoding: "utf-8", mode: FILE_MODE });
    await fs.chmod(tmp, FILE_MODE);
    await fs.rename(tmp, file);
  }
}

function clampMs(ms: number): number {
  return Math.max(0, Math.min(MAX_EVENT_LISTENED_MS, Math.round(ms)));
}
