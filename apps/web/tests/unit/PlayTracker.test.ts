import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Release, Settings } from "../../src/shared/types";
import { PlayTracker } from "../../src/server/plays/PlayTracker";
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
});
