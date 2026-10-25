import { emptyPlayCounts, type PlayCounts, type PlayCountStore, type PlaySource } from "../../src/server/plays/PlayCountStore";

/** In-memory {@link PlayCountStore} fake, following the other fakes in tests/unit. */
export class FakePlayCountStore implements PlayCountStore {
  private counts: PlayCounts = emptyPlayCounts();

  async get(): Promise<PlayCounts> {
    return structuredClone(this.counts);
  }

  async increment(trackId: string, releaseId: string, day: string, source: PlaySource = "spotify"): Promise<void> {
    const entry = this.counts.tracks[trackId];
    if (source === "locally") {
      const own = entry?.locally;
      const ownDays = { ...own?.days };
      ownDays[day] = (ownDays[day] ?? 0) + 1;
      const locally = { count: (own?.count ?? 0) + 1, pushed: own?.pushed ?? 0, days: ownDays };
      this.counts.tracks[trackId] = entry ? { ...entry, releaseId, locally } : { releaseId, count: 0, pushed: 0, locally };
      return;
    }
    const days = { ...entry?.days };
    days[day] = (days[day] ?? 0) + 1;
    this.counts.tracks[trackId] = entry
      ? { ...entry, releaseId, count: entry.count + 1, days }
      : { releaseId, count: 1, pushed: 0, days };
  }

  async incrementOnce(trackId: string, releaseId: string, day: string, source: PlaySource, sessionKey: string): Promise<boolean> {
    if (this.counts.countedSessions?.[sessionKey] !== undefined) return false;
    await this.increment(trackId, releaseId, day, source);
    this.counts.countedSessions = { ...this.counts.countedSessions, [sessionKey]: Date.now() };
    return true;
  }

  async releaseSession(sessionKey: string): Promise<void> {
    if (this.counts.countedSessions) delete this.counts.countedSessions[sessionKey];
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

  async markPushed(
    sent: Record<string, number>,
    epoch: number,
    sentDays?: Record<string, Record<string, number>>,
    source: PlaySource = "spotify",
  ): Promise<void> {
    if (epoch !== this.epoch) return;
    const pick = (trackId: string) => (source === "locally" ? this.counts.tracks[trackId]?.locally : this.counts.tracks[trackId]);
    for (const [trackId, count] of Object.entries(sent)) {
      const entry = pick(trackId);
      if (entry && count > entry.pushed) entry.pushed = count;
    }
    for (const [trackId, days] of Object.entries(sentDays ?? {})) {
      const entry = pick(trackId);
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
