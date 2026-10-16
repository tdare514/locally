import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Release } from "../../src/shared/types";
import {
  IDLE_AFTER_NOT_PLAYING_MS,
  IDLE_POLL_INTERVAL_MS,
  PlayTracker,
} from "../../src/server/plays/PlayTracker";
import { SwitchingNowPlaying } from "../../src/server/plays/SwitchingNowPlaying";
import type { NowPlayingResult, SpotifyNowPlaying } from "../../src/server/plays/SpotifyNowPlaying";
import { WebApiNowPlaying } from "../../src/server/plays/WebApiNowPlaying";
import { SpotifyApiError } from "../../src/server/spotify/SpotifyClient";
import { FakePlayCountStore } from "./FakePlayCountStore";
import { MemorySettings, SAMPLE_SPOTIFY } from "./spotifyFakes";

const ID = "spotify:local:Artist:Album:Title:200";
const SHORT_ID = "spotify:local:Artist:Album:Short:20";
const START = Date.UTC(2026, 9, 16, 12, 0, 0);

const release: Release = {
  id: "r1",
  kind: "single",
  title: "Album",
  artist: "Artist",
  year: null,
  genre: null,
  coverPath: null,
  folderPath: "/lib/x",
  tracks: [
    { id: "t1", title: "Title", trackNumber: 1, filePath: "/lib/x.mp3", originalName: "x.mp3", durationSec: 200 },
    { id: "t2", title: "Short", trackNumber: 2, filePath: "/lib/y.mp3", originalName: "y.mp3", durationSec: 20 },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** The Web API as the client would answer: a body, null for 204, or an error to throw. */
class FakeWebApi {
  answer: unknown = null;
  error: SpotifyApiError | null = null;
  calls = 0;
  async requestOptional<T>(): Promise<T | null> {
    this.calls++;
    if (this.error) throw this.error;
    return this.answer as T | null;
  }
}

class FakeAppleScript implements SpotifyNowPlaying {
  next: NowPlayingResult = { running: false };
  calls = 0;
  async read(): Promise<NowPlayingResult> {
    this.calls++;
    return this.next;
  }
}

let web: FakeWebApi;
let apple: FakeAppleScript;
let store: FakePlayCountStore;
let settings: MemorySettings;
let clock: number;
let tracker: PlayTracker;
let switcher: SwitchingNowPlaying;

function player(uri: string, posSec: number, type = "Smartphone", isPlaying = true, durationMs = 200_000) {
  return { is_playing: isPlaying, progress_ms: posSec * 1000, item: { uri, duration_ms: durationMs }, device: { type } };
}

/** Advance the clock 5 s and poll once. */
async function tick(): Promise<void> {
  clock += 5000;
  await tracker.poll();
}

beforeEach(() => {
  web = new FakeWebApi();
  apple = new FakeAppleScript();
  store = new FakePlayCountStore();
  settings = new MemorySettings();
  settings.value = { libraryDir: "/lib", sync: null, trackPlays: true, countOtherDevices: true, spotify: SAMPLE_SPOTIFY };
  clock = START;
  switcher = new SwitchingNowPlaying({
    web: new WebApiNowPlaying(web),
    appleScript: apple,
    settings,
    now: () => clock,
  });
  tracker = new PlayTracker(
    switcher,
    settings,
    { list: async () => [release] },
    store,
    () => clock,
    5000,
    IDLE_POLL_INTERVAL_MS,
    "UTC",
  );
  // Poll by hand: the tracker is enabled without its own timer loop running ahead of the test.
  (tracker as unknown as { enabled: boolean }).enabled = true;
});

afterEach(() => {
  tracker.stop();
  vi.restoreAllMocks();
});

describe("PlayTracker on the Spotify account (#228)", () => {
  it.each(["Smartphone", "Computer"])("counts a library track played on a %s once, with its day", async (type) => {
    for (let pos = 0; pos <= 40; pos += 5) {
      web.answer = player(ID, pos, type);
      await tick();
    }
    expect((await store.get()).tracks).toEqual({
      t1: { releaseId: "r1", count: 1, pushed: 0, days: { "2026-10-16": 1 } },
    });
    expect(apple.calls).toBe(0);
  });

  it("applies the 90% rule to a short track", async () => {
    for (let pos = 0; pos <= 20; pos += 2) {
      web.answer = player(SHORT_ID, pos, "Smartphone", true, 20_000);
      clock += 2000;
      await tracker.poll();
    }
    expect((await store.get()).tracks.t2?.count).toBe(1);
  });

  it("does not count a phone play that stops before 30 s", async () => {
    for (let pos = 0; pos <= 20; pos += 5) {
      web.answer = player(ID, pos);
      await tick();
    }
    expect((await store.get()).tracks).toEqual({});
  });

  it("counts a Mac-only play once while on the Web API, without asking AppleScript", async () => {
    apple.next = { running: true, state: "playing", id: ID, positionSec: 0, durationMs: 200_000 };
    for (let pos = 0; pos <= 60; pos += 5) {
      web.answer = player(ID, pos, "Computer");
      await tick();
    }
    expect((await store.get()).tracks.t1.count).toBe(1);
    expect(apple.calls).toBe(0);
  });

  it("a 429 fallback then resume further along counts the track once", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The phone plays X and it counts at 30 s.
    let phonePos = 0;
    for (; phonePos <= 30; phonePos += 5) {
      web.answer = player(ID, phonePos);
      await tick();
    }
    expect((await store.get()).tracks.t1.count).toBe(1);

    // A 429 (Retry-After 60 s): AppleScript says the Mac isn't playing, so the counter resets.
    web.error = new SpotifyApiError("rateLimited", "slow", { retryAfterSec: 60, status: 429 });
    for (let i = 0; i < 12; i++) {
      phonePos += 5;
      await tick();
    }
    expect(switcher.fallingBack()).toBe(true);
    expect(switcher.currentSource()).toBe("this-mac");

    // The Web API comes back with X further along and keeps playing for over 30 s.
    web.error = null;
    for (let i = 0; i < 9; i++) {
      web.answer = player(ID, phonePos);
      await tick();
      phonePos += 5;
    }
    expect(switcher.currentSource()).toBe("account");
    expect((await store.get()).tracks.t1.count).toBe(1);
  });

  it("turning the setting off returns to AppleScript", async () => {
    web.answer = player(ID, 0);
    await tick();
    expect(web.calls).toBe(1);
    expect(apple.calls).toBe(0);

    settings.value = { ...settings.value, countOtherDevices: false };
    apple.next = { running: true, state: "playing", id: ID, positionSec: 0, durationMs: 200_000 };
    for (let pos = 0; pos <= 40; pos += 5) {
      apple.next = { running: true, state: "playing", id: ID, positionSec: pos, durationMs: 200_000 };
      await tick();
    }
    expect(web.calls).toBe(1);
    expect(apple.calls).toBe(9);
    expect(switcher.currentSource()).toBe("this-mac");
    expect(switcher.fallingBack()).toBe(false);
  });
});

describe("PlayTracker fallback samples (#228)", () => {
  const B = "spotify:local:Artist:Album:Other:200";

  /** The account plays A to 30 s (counts), then a 429; `during` is what the Mac reports on each fallback tick. */
  async function outage(during: (phonePos: number) => NowPlayingResult): Promise<number> {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let phonePos = 0;
    for (; phonePos <= 30; phonePos += 5) {
      web.answer = player(ID, phonePos);
      await tick();
    }
    expect((await store.get()).tracks.t1.count).toBe(1);
    web.error = new SpotifyApiError("rateLimited", "slow", { retryAfterSec: 60, status: 429 });
    for (let i = 0; i < 12; i++) {
      phonePos += 5;
      apple.next = during(phonePos);
      await tick();
    }
    web.error = null;
    // The account is back with A well past where it was and plays on for 40 s.
    for (let i = 0; i < 9; i++) {
      web.answer = player(ID, phonePos);
      await tick();
      phonePos += 5;
    }
    expect(switcher.currentSource()).toBe("account");
    return (await store.get()).tracks.t1.count;
  }

  const paused = (id: string, pos: number): NowPlayingResult => ({
    running: true,
    state: "paused",
    id,
    positionSec: pos,
    durationMs: 200_000,
  });

  it("(a) a paused other track B at 120 during the fallback does not make A count again", async () => {
    expect(await outage(() => paused(B, 120))).toBe(1);
  });

  it("(b) a stale paused A at 0 during the fallback does not make A count again", async () => {
    expect(await outage(() => paused(ID, 0))).toBe(1);
  });

  it("the Mac playing A at a consistent position during the fallback does not count it again", async () => {
    expect(
      await outage((pos) => ({ running: true, state: "playing", id: ID, positionSec: pos, durationMs: 200_000 })),
    ).toBe(1);
  });

  it("Spotify not running on the Mac during the fallback, then the account resumes A: once", async () => {
    expect(await outage(() => ({ running: false }))).toBe(1);
  });

  it("a fresh local track C playing on the Mac during the fallback does count", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    web.error = new SpotifyApiError("offline", "x");
    for (let pos = 0; pos <= 20; pos += 2) {
      apple.next = { running: true, state: "playing", id: SHORT_ID, positionSec: pos, durationMs: 20_000 };
      clock += 2000;
      await tracker.poll();
    }
    expect((await store.get()).tracks.t2?.count).toBe(1);
  });

  it("a held fallback leaves the status on and the idle clock running", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    web.error = new SpotifyApiError("offline", "x");
    apple.next = { running: false };
    await tick();
    expect(tracker.status()).toBe("on");
    expect(switcher.fallingBack()).toBe(true);
  });
});

describe("PlayTracker idle polling after 2 minutes not playing (#228)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });
  afterEach(() => vi.useRealTimers());

  async function advance(ms: number) {
    await vi.advanceTimersByTimeAsync(ms);
  }

  it("slows to the idle interval once paused for 2 minutes, and returns to 5 s on the first playing sample", async () => {
    web.answer = player(ID, 10, "Smartphone", false);
    switcher = new SwitchingNowPlaying({ web: new WebApiNowPlaying(web), appleScript: apple, settings, now: () => Date.now() });
    const t2 = new PlayTracker(
      switcher,
      settings,
      { list: async () => [release] },
      store,
      () => Date.now(),
      5000,
      IDLE_POLL_INTERVAL_MS,
      "UTC",
    );
    t2.setEnabled(true);
    await advance(0);
    expect(web.calls).toBe(1);

    // Paused: still every 5 s for the first 2 minutes (polls at 0, 5, ..., 120).
    await advance(IDLE_AFTER_NOT_PLAYING_MS);
    expect(web.calls).toBe(25);

    // Now idle: nothing for the next 25 s, then a poll at 30 s.
    await advance(25_000);
    expect(web.calls).toBe(25);
    await advance(5_000);
    expect(web.calls).toBe(26);

    // Playing again; the poll that sees it is the next idle one (30 s later), then 5 s.
    web.answer = player(ID, 20, "Smartphone", true);
    await advance(IDLE_POLL_INTERVAL_MS);
    expect(web.calls).toBe(27);
    await advance(5_000);
    expect(web.calls).toBe(28);
    await advance(5_000);
    expect(web.calls).toBe(29);
    t2.stop();
  });
});
