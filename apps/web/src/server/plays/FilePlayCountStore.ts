import fs from "node:fs/promises";
import { z } from "zod";
import { playsFilePath, settingsDir } from "../config/paths";
import { emptyPlayCounts, type PlayCounts, type PlayCountStore, type PlaySource, type SourceCounts } from "./PlayCountStore";
import { cleanStoredDays, localDay, pruneDays, RETENTION_DAYS } from "./playDays";

const FILE_MODE = 0o600;
/** A session key lives as long as the route accepts a report of its session (400 days), unless it is released first. */
const SESSION_KEY_TTL_MS = RETENTION_DAYS * 86_400_000;
/** A backstop only: keys are released within seconds of the counted marker, so the set normally holds a handful. */
const SESSION_KEY_CAP = 20_000;

const SourceCountsSchema = z.object({
  count: z.number().int().min(0),
  pushed: z.number().int().min(0),
  days: z.unknown().optional(),
  pushedDays: z.unknown().optional(),
});

function readSource(raw: unknown): SourceCounts | undefined {
  const parsed = SourceCountsSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const days = cleanStoredDays(parsed.data.days);
  const pushedDays = cleanStoredDays(parsed.data.pushedDays);
  return {
    count: parsed.data.count,
    pushed: parsed.data.pushed,
    ...(days ? { days } : {}),
    ...(pushedDays ? { pushedDays } : {}),
  };
}

const PlayCountsSchema = z.object({
  version: z.literal(1),
  tracks: z.record(
    z.string(),
    z.object({
      releaseId: z.string(),
      count: z.number().int().min(0),
      pushed: z.number().int().min(0),
      // Read loosely, then cleaned by `cleanStoredDays`: a bad `days` must never cost the totals (#200).
      days: z.unknown().optional(),
      pushedDays: z.unknown().optional(),
      // Locally's own source (#338), read loosely like `days`: a bad one is dropped, never the Spotify totals.
      locally: z.unknown().optional(),
    }),
  ),
  daysInSync: z.boolean().optional(),
  countedSessions: z.unknown().optional(),
});

function cleanSessions(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** JSON-file backed {@link PlayCountStore}: `plays.json` next to `settings.json`, owner-only. */
export class FilePlayCountStore implements PlayCountStore {
  /** Serialises read-modify-write cycles so concurrent increments never lose updates. */
  private queue: Promise<unknown> = Promise.resolve();
  /** In memory only: bumped by `resetPushed` so a push that began before it can't mark anything. */
  private epoch = 0;

  /**
   * `now` and `timeZone` decide which day is "today" for dropping day buckets older than 400 days
   * when the file is written; tests inject them, the app uses the system clock and zone.
   */
  constructor(
    private readonly now: () => number = Date.now,
    private readonly timeZone?: string,
  ) {}

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
    if (!parsed.success) return emptyPlayCounts();
    const tracks: PlayCounts["tracks"] = {};
    for (const [trackId, entry] of Object.entries(parsed.data.tracks)) {
      const days = cleanStoredDays(entry.days);
      const pushedDays = cleanStoredDays(entry.pushedDays);
      const locally = readSource(entry.locally);
      tracks[trackId] = {
        releaseId: entry.releaseId,
        count: entry.count,
        pushed: entry.pushed,
        ...(days ? { days } : {}),
        ...(pushedDays ? { pushedDays } : {}),
        ...(locally ? { locally } : {}),
      };
    }
    const countedSessions = cleanSessions(parsed.data.countedSessions);
    return {
      version: 1,
      tracks,
      ...(parsed.data.daysInSync ? { daysInSync: true as const } : {}),
      ...(countedSessions ? { countedSessions } : {}),
    };
  }

  async incrementOnce(trackId: string, releaseId: string, day: string, source: PlaySource, sessionKey: string): Promise<boolean> {
    let counted = false;
    await this.mutate((counts) => {
      if (counts.countedSessions?.[sessionKey] !== undefined) return;
      this.applyIncrement(counts, trackId, releaseId, day, source);
      counts.countedSessions = { ...counts.countedSessions, [sessionKey]: this.now() };
      counted = true;
    });
    return counted;
  }

  async releaseSession(sessionKey: string): Promise<void> {
    if ((await this.get()).countedSessions?.[sessionKey] === undefined) return;
    await this.mutate((counts) => {
      if (!counts.countedSessions) return;
      delete counts.countedSessions[sessionKey];
    });
  }

  increment(trackId: string, releaseId: string, day: string, source: PlaySource = "spotify"): Promise<void> {
    return this.mutate((counts) => this.applyIncrement(counts, trackId, releaseId, day, source));
  }

  private applyIncrement(counts: PlayCounts, trackId: string, releaseId: string, day: string, source: PlaySource): void {
    {
      const entry = counts.tracks[trackId];
      if (source === "locally") {
        const own = entry?.locally;
        const days = { ...own?.days };
        days[day] = (days[day] ?? 0) + 1;
        const locally: SourceCounts = { ...own, count: (own?.count ?? 0) + 1, pushed: own?.pushed ?? 0, days };
        counts.tracks[trackId] = entry ? { ...entry, releaseId, locally } : { releaseId, count: 0, pushed: 0, locally };
        return;
      }
      const days = { ...entry?.days };
      days[day] = (days[day] ?? 0) + 1;
      counts.tracks[trackId] = entry
        ? { ...entry, releaseId, count: entry.count + 1, days }
        : { releaseId, count: 1, pushed: 0, days };
    }
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

  markPushed(
    sent: Record<string, number>,
    epoch: number,
    sentDays?: Record<string, Record<string, number>>,
    source: PlaySource = "spotify",
  ): Promise<void> {
    if (epoch !== this.epoch) return Promise.resolve();
    return this.mutate((counts) => {
      // Checked again when this runs: a reset can land while the write waits its turn.
      if (epoch !== this.epoch) return;
      for (const [trackId, count] of Object.entries(sent)) {
        const target = counts.tracks[trackId] && (source === "locally" ? counts.tracks[trackId].locally : counts.tracks[trackId]);
        if (target && count > target.pushed) target.pushed = count;
      }
      for (const [trackId, days] of Object.entries(sentDays ?? {})) {
        const target = counts.tracks[trackId] && (source === "locally" ? counts.tracks[trackId].locally : counts.tracks[trackId]);
        if (!target) continue;
        for (const [day, count] of Object.entries(days)) {
          if (count > (target.pushedDays?.[day] ?? 0)) target.pushedDays = { ...target.pushedDays, [day]: count };
        }
      }
    });
  }

  markDaysInSync(epoch: number): Promise<void> {
    if (epoch !== this.epoch) return Promise.resolve();
    return this.mutate((counts) => {
      if (epoch !== this.epoch) return;
      counts.daysInSync = true;
    });
  }

  resetPushed(): Promise<void> {
    this.epoch++;
    return this.mutate((counts) => {
      for (const entry of Object.values(counts.tracks)) {
        entry.pushed = 0;
        delete entry.pushedDays;
        if (entry.locally) {
          entry.locally.pushed = 0;
          delete entry.locally.pushedDays;
        }
      }
      delete counts.daysInSync;
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
    this.dropOldDays(counts);
    this.dropOldSessions(counts);
    await fs.mkdir(settingsDir(), { recursive: true, mode: 0o700 });
    const file = playsFilePath();
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await fs.writeFile(tmp, JSON.stringify(counts, null, 2), { encoding: "utf-8", mode: FILE_MODE });
    await fs.chmod(tmp, FILE_MODE);
    await fs.rename(tmp, file);
  }

  /**
   * Session keys older than 400 days go (a report can't be that old, so the key can't be needed), and at most the
   * newest SESSION_KEY_CAP stay. A key not yet released is never dropped sooner: it is what stops a retry counting twice.
   */
  private dropOldSessions(counts: PlayCounts): void {
    if (!counts.countedSessions) return;
    const cutoff = this.now() - SESSION_KEY_TTL_MS;
    const kept = Object.entries(counts.countedSessions)
      .filter(([, at]) => at >= cutoff)
      .sort((a, b) => b[1] - a[1])
      .slice(0, SESSION_KEY_CAP);
    if (kept.length > 0) counts.countedSessions = Object.fromEntries(kept);
    else delete counts.countedSessions;
  }

  /** Day buckets older than 400 days go when the file is written; the all-time counts stay. */
  private dropOldDays(counts: PlayCounts): void {
    const today = localDay(this.now(), this.timeZone);
    for (const entry of Object.values(counts.tracks)) {
      const days = pruneDays(entry.days, today);
      if (days) entry.days = days;
      else delete entry.days;
      const pushedDays = pruneDays(entry.pushedDays, today);
      if (pushedDays) entry.pushedDays = pushedDays;
      else delete entry.pushedDays;
      if (entry.locally) {
        const ownDays = pruneDays(entry.locally.days, today);
        if (ownDays) entry.locally.days = ownDays;
        else delete entry.locally.days;
        const ownPushed = pruneDays(entry.locally.pushedDays, today);
        if (ownPushed) entry.locally.pushedDays = ownPushed;
        else delete entry.locally.pushedDays;
      }
    }
  }
}
