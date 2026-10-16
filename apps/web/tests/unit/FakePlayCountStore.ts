import { emptyPlayCounts, type PlayCounts, type PlayCountStore } from "../../src/server/plays/PlayCountStore";

/** In-memory {@link PlayCountStore} fake, following the other fakes in tests/unit. */
export class FakePlayCountStore implements PlayCountStore {
  private counts: PlayCounts = emptyPlayCounts();

  async get(): Promise<PlayCounts> {
    return structuredClone(this.counts);
  }

  async increment(trackId: string, releaseId: string, day: string): Promise<void> {
    const entry = this.counts.tracks[trackId];
    const days = { ...entry?.days };
    days[day] = (days[day] ?? 0) + 1;
    this.counts.tracks[trackId] = entry
      ? { ...entry, releaseId, count: entry.count + 1, days }
      : { releaseId, count: 1, pushed: 0, days };
  }

  async removeRelease(releaseId: string): Promise<void> {
    for (const [id, entry] of Object.entries(this.counts.tracks)) {
      if (entry.releaseId === releaseId) delete this.counts.tracks[id];
    }
  }

  private epoch = 0;

  pushedEpoch(): number {
    return this.epoch;
  }

  async markPushed(sent: Record<string, number>, epoch: number, sentDays?: Record<string, Record<string, number>>): Promise<void> {
    if (epoch !== this.epoch) return;
    for (const [trackId, count] of Object.entries(sent)) {
      const entry = this.counts.tracks[trackId];
      if (entry && count > entry.pushed) entry.pushed = count;
    }
    for (const [trackId, days] of Object.entries(sentDays ?? {})) {
      const entry = this.counts.tracks[trackId];
      if (!entry) continue;
      for (const [day, count] of Object.entries(days)) {
        if (count > (entry.pushedDays?.[day] ?? 0)) entry.pushedDays = { ...entry.pushedDays, [day]: count };
      }
    }
  }

  async markDaysInSync(epoch: number): Promise<void> {
    if (epoch !== this.epoch) return;
    this.counts.daysInSync = true;
  }

  async resetPushed(): Promise<void> {
    this.epoch++;
    for (const entry of Object.values(this.counts.tracks)) {
      entry.pushed = 0;
      delete entry.pushedDays;
    }
    delete this.counts.daysInSync;
  }

  /** Test helper: set an entry directly. */
  seed(
    trackId: string,
    releaseId: string,
    count: number,
    pushed = 0,
    days?: Record<string, number>,
    pushedDays?: Record<string, number>,
  ): void {
    this.counts.tracks[trackId] = {
      releaseId,
      count,
      pushed,
      ...(days ? { days } : {}),
      ...(pushedDays ? { pushedDays } : {}),
    };
  }

  /** Test helper: set `daysInSync` directly. */
  seedDaysInSync(value: boolean): void {
    if (value) this.counts.daysInSync = true;
    else delete this.counts.daysInSync;
  }
}
