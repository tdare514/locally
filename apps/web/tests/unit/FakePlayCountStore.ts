import { emptyPlayCounts, type PlayCounts, type PlayCountStore } from "../../src/server/plays/PlayCountStore";

/** In-memory {@link PlayCountStore} fake, following the other fakes in tests/unit. */
export class FakePlayCountStore implements PlayCountStore {
  private counts: PlayCounts = emptyPlayCounts();

  async get(): Promise<PlayCounts> {
    return structuredClone(this.counts);
  }

  async increment(trackId: string, releaseId: string): Promise<void> {
    const entry = this.counts.tracks[trackId];
    this.counts.tracks[trackId] = entry
      ? { ...entry, releaseId, count: entry.count + 1 }
      : { releaseId, count: 1, pushed: 0 };
  }

  async removeRelease(releaseId: string): Promise<void> {
    for (const [id, entry] of Object.entries(this.counts.tracks)) {
      if (entry.releaseId === releaseId) delete this.counts.tracks[id];
    }
  }
}
