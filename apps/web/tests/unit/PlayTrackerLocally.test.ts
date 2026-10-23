import { describe, expect, it } from "vitest";
import type { Release } from "../../src/shared/types";
import { LocallyNowPlaying, LOCALLY_PLAYING_TTL_MS } from "../../src/server/plays/LocallyNowPlaying";
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
  position = 0;
  async read(): Promise<NowPlayingResult> {
    return { running: true, state: "playing", id: ID, positionSec: this.position, durationMs: 200_000 };
  }
}

/** Plays the same Spotify track for 40 s of 5 s polls and returns what the store holds. */
async function listen(locallyTrack: string | null) {
  let clock = Date.UTC(2026, 9, 16, 12, 0, 0);
  const locally = new LocallyNowPlaying(() => clock);
  const np = new FakeNowPlaying();
  const store = new FakePlayCountStore();
  const tracker = new PlayTracker(
    np,
    { get: async () => ({ libraryDir: "/lib", sync: null }) } as never,
    { list: async () => [release] },
    store,
    () => clock,
    5000,
    30_000,
    "UTC",
    undefined,
    locally,
  );
  tracker.setEnabled(true);
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 9; i++) {
    clock += 5000;
    np.position += 5;
    // Locally reports on every tick while it plays.
    locally.set(locallyTrack);
    await tracker.poll();
  }
  tracker.stop();
  return store.get();
}

describe("the Spotify tracker while Locally plays (#338)", () => {
  it("counts a Spotify play of a track Locally is not playing", async () => {
    expect((await listen(null)).tracks.t1?.count).toBe(1);
  });

  it("ignores a read of the track Locally is playing, so the play is not counted twice", async () => {
    expect((await listen("t1")).tracks.t1).toBeUndefined();
  });

  it("still counts Spotify's play of a different track than Locally's", async () => {
    expect((await listen("some-other-track")).tracks.t1?.count).toBe(1);
  });
});

describe("LocallyNowPlaying", () => {
  it("lapses after the heartbeat stops and clears on null", () => {
    let clock = 0;
    const np = new LocallyNowPlaying(() => clock);
    np.set("t1");
    expect(np.trackId()).toBe("t1");
    clock += LOCALLY_PLAYING_TTL_MS + 1;
    expect(np.trackId()).toBeNull();
    np.set("t1");
    np.set(null);
    expect(np.trackId()).toBeNull();
  });
});
