import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Release, Settings } from "../../src/shared/types";
import { IDLE_POLL_INTERVAL_MS, PlayTracker } from "../../src/server/plays/PlayTracker";
import type { NowPlayingResult, SpotifyNowPlaying } from "../../src/server/plays/SpotifyNowPlaying";
import { FakePlayCountStore } from "./FakePlayCountStore";

const ID = "spotify:local:Artist:Album:Title:200";

const release: Release = {
  id: "r1",
  kind: "single",
  title: "Album",
  artist: "Artist",
  year: null,
  genre: null,
  coverPath: null,
  folderPath: "/lib/x",
  tracks: [{ id: "t1", title: "Title", trackNumber: 1, filePath: "/lib/x.mp3", originalName: "x.mp3", durationSec: 200 }],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

class FakeNowPlaying implements SpotifyNowPlaying {
  next: NowPlayingResult = { running: false };
  calls = 0;
  async read(): Promise<NowPlayingResult> {
    this.calls++;
    return this.next;
  }
}

let np: FakeNowPlaying;
let store: FakePlayCountStore;
let clock: number;
let releases: Release[];
let tracker: PlayTracker;

function playing(pos: number): NowPlayingResult {
  return { running: true, state: "playing", id: ID, positionSec: pos, durationMs: 200_000 };
}

async function tick(pos: number): Promise<void> {
  clock += 5000;
  np.next = playing(pos);
  await tracker.poll();
}

beforeEach(() => {
  np = new FakeNowPlaying();
  store = new FakePlayCountStore();
  clock = 0;
  releases = [release];
  tracker = new PlayTracker(
    np,
    { get: async () => ({ libraryDir: "/lib", sync: null }) as Settings },
    { list: async () => releases },
    store,
    () => clock,
    5000,
  );
});

afterEach(() => {
  tracker.stop();
  vi.useRealTimers();
});

describe("PlayTracker", () => {
  it("increments the store with the resolved ids when a play counts", async () => {
    tracker.setEnabled(true);
    await vi.waitFor(() => expect(np.calls).toBe(1)); // initial poll
    for (let pos = 0; pos <= 30; pos += 5) await tick(pos);
    expect((await store.get()).tracks).toEqual({ t1: { releaseId: "r1", count: 1, pushed: 0 } });
  });

  it("ignores a play with no match and warns once about ambiguity", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    releases = [release, { ...release, id: "r2", tracks: [{ ...release.tracks[0], id: "t2" }] }];
    tracker.setEnabled(true);
    await vi.waitFor(() => expect(np.calls).toBe(1));
    for (let pos = 0; pos <= 30; pos += 5) await tick(pos);
    expect((await store.get()).tracks).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("reports status from the last poll", async () => {
    expect(tracker.status()).toBe("off");
    tracker.setEnabled(true);
    expect(tracker.status()).toBe("on");
    await vi.waitFor(() => expect(np.calls).toBe(1));
    expect(tracker.status()).toBe("spotify-not-running");
    np.next = { error: "permission-denied" };
    await tracker.poll();
    expect(tracker.status()).toBe("permission-denied");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    np.next = { error: "failed" };
    await tracker.poll();
    await tracker.poll();
    expect(tracker.status()).toBe("on");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    await tick(0);
    expect(tracker.status()).toBe("on");
    tracker.setEnabled(false);
    expect(tracker.status()).toBe("off");
  });

  it("polls on the interval and setEnabled(false) stops polling", async () => {
    vi.useFakeTimers();
    np.next = playing(0); // Spotify running, so the 5 s interval applies
    tracker.setEnabled(true);
    await vi.advanceTimersByTimeAsync(0);
    const afterStart = np.calls;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(np.calls).toBe(afterStart + 2);
    tracker.setEnabled(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(np.calls).toBe(afterStart + 2);
  });

  it("never overlaps polls", async () => {
    let release!: () => void;
    let calls = 0;
    const slow: SpotifyNowPlaying = {
      read: () => {
        calls++;
        return new Promise((resolve) => {
          release = () => resolve({ running: false });
        });
      },
    };
    const t = new PlayTracker(slow, { get: async () => ({}) as Settings }, { list: async () => [] }, store, () => 0, 5000);
    t.setEnabled(true);
    await t.poll();
    await t.poll();
    expect(calls).toBe(1);
    release();
    t.stop();
  });

  describe("idle backoff (#162)", () => {
    it("polls every 30 s, not 5 s, while Spotify is not running", async () => {
      vi.useFakeTimers();
      tracker.setEnabled(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(np.calls).toBe(1);
      expect(tracker.status()).toBe("spotify-not-running");
      await vi.advanceTimersByTimeAsync(IDLE_POLL_INTERVAL_MS - 1);
      expect(np.calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(np.calls).toBe(2);
      await vi.advanceTimersByTimeAsync(IDLE_POLL_INTERVAL_MS);
      expect(np.calls).toBe(3);
    });

    it("goes back to 5 s on the first poll that finds Spotify running", async () => {
      vi.useFakeTimers();
      tracker.setEnabled(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(np.calls).toBe(1);
      np.next = playing(0);
      await vi.advanceTimersByTimeAsync(IDLE_POLL_INTERVAL_MS); // still on the 30 s cadence
      expect(np.calls).toBe(2);
      expect(tracker.status()).toBe("on");
      await vi.advanceTimersByTimeAsync(5000);
      expect(np.calls).toBe(3);
      await vi.advanceTimersByTimeAsync(5000);
      expect(np.calls).toBe(4);
    });

    it("backs off again when Spotify closes", async () => {
      vi.useFakeTimers();
      np.next = playing(0);
      tracker.setEnabled(true);
      await vi.advanceTimersByTimeAsync(5000);
      expect(np.calls).toBe(2);
      np.next = { running: false };
      await vi.advanceTimersByTimeAsync(5000);
      expect(np.calls).toBe(3);
      expect(tracker.status()).toBe("spotify-not-running");
      await vi.advanceTimersByTimeAsync(IDLE_POLL_INTERVAL_MS - 1);
      expect(np.calls).toBe(3);
      await vi.advanceTimersByTimeAsync(1);
      expect(np.calls).toBe(4);
    });

    it("stop() cancels a pending poll", async () => {
      vi.useFakeTimers();
      tracker.setEnabled(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(np.calls).toBe(1);
      expect(vi.getTimerCount()).toBe(1);
      tracker.stop();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(IDLE_POLL_INTERVAL_MS * 2);
      expect(np.calls).toBe(1);
    });

    it("does not stack polls when one takes longer than the interval", async () => {
      vi.useFakeTimers();
      let calls = 0;
      let active = 0;
      let maxActive = 0;
      const slow: SpotifyNowPlaying = {
        read: async () => {
          calls++;
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 12_000));
          active--;
          return { running: true, state: "playing", id: ID, positionSec: 0, durationMs: 200_000 };
        },
      };
      const t = new PlayTracker(slow, { get: async () => ({}) as Settings }, { list: async () => [] }, store, () => 0, 5000);
      t.setEnabled(true);
      await vi.advanceTimersByTimeAsync(11_999);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1); // first poll finishes, next is scheduled 5 s later
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(4999);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toBe(2);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(maxActive).toBe(1);
      t.stop();
    });
  });
});
