import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Release } from "../../src/shared/types";
import {
  CLOUD_PENDING_MAX_MS,
  CLOUD_PENDING_POLL_MS,
  CLOUD_REFRESH_MS,
  CloudPlays,
  isSpotifyAuthorizeUrl,
} from "../../src/server/spotify/CloudPlays";
import { PlayTracker } from "../../src/server/plays/PlayTracker";
import type { NowPlayingResult, SpotifyNowPlaying } from "../../src/server/plays/SpotifyNowPlaying";
import { SyncAuthError, SyncUnavailableError, type SpotifyLinkStatus, type SyncApi } from "../../src/server/sync/SyncApi";
import { FakePlayCountStore } from "./FakePlayCountStore";
import { MemorySettings } from "./spotifyFakes";

const AUTHORIZE = "https://accounts.spotify.com/authorize?client_id=x&state=y";
const START = Date.UTC(2026, 9, 19, 12, 0, 0);

/** The three link calls of the sync service, scripted by the test. */
class FakeLinkApi {
  status: SpotifyLinkStatus | "unavailable" | "auth" | "down" = { linked: false };
  authorizeUrl = AUTHORIZE;
  statusCalls = 0;
  starts: string[] = [];
  unlinks = 0;
  api = {
    spotifyLinkStatus: async () => {
      this.statusCalls++;
      if (this.status === "unavailable") throw new SyncUnavailableError("no");
      if (this.status === "auth") throw new SyncAuthError("expired");
      if (this.status === "down") throw new Error("network");
      return this.status;
    },
    spotifyLinkStart: async (timeZone: string) => {
      this.starts.push(timeZone);
      return { authorizeUrl: this.authorizeUrl };
    },
    spotifyUnlink: async () => {
      this.unlinks++;
      this.status = { linked: false };
    },
  } as unknown as SyncApi;
}

const linked = (problem: "reconnect" | "notOnTesterList" | "rateLimited" | null = null): SpotifyLinkStatus => ({
  linked: true,
  since: "2026-10-01T00:00:00Z",
  lastSampleAt: "2026-10-19T11:59:00Z",
  problem,
});

let settings: MemorySettings;
let link: FakeLinkApi;
let clock: number;
let cloud: CloudPlays;

beforeEach(() => {
  vi.useFakeTimers();
  settings = new MemorySettings();
  settings.value = {
    libraryDir: "/lib",
    sync: { baseUrl: "http://fake", deviceToken: "tok", email: "a@b.com", lastVersion: 0 },
  };
  link = new FakeLinkApi();
  clock = START;
  cloud = new CloudPlays({ settings, apiFactory: () => link.api, now: () => clock, timeZone: () => "Europe/London" });
});

afterEach(() => {
  cloud.stop();
  vi.useRealTimers();
});

describe("isSpotifyAuthorizeUrl", () => {
  it.each([
    [AUTHORIZE, true],
    ["https://accounts.spotify.com/authorize", true],
    ["http://accounts.spotify.com/authorize?x=1", false],
    ["https://accounts.spotify.com.evil.example/authorize?x=1", false],
    ["https://accounts.spotify.com/authorizeevil", false],
    ["https://accounts.spotify.com@evil.example/authorize", false],
    ["https://evil.example/https://accounts.spotify.com/authorize", false],
    ["javascript:alert(1)", false],
    ["", false],
  ])("%s -> %s", (url, ok) => {
    expect(isSpotifyAuthorizeUrl(url)).toBe(ok);
  });
});

describe("CloudPlays link flow (#307)", () => {
  it("is available but off when signed in and not linked", async () => {
    expect(await cloud.view()).toEqual({ available: true, linked: false, lastSampleAt: null, problem: null, pending: false });
    expect(cloud.active()).toBe(false);
  });

  it("start sends the Mac's time zone, goes pending, and polls every 2 s until linked", async () => {
    const out = await cloud.start();
    expect(out.authorizeUrl).toBe(AUTHORIZE);
    expect(link.starts).toEqual(["Europe/London"]);
    expect((await cloud.view()).pending).toBe(true);

    await vi.advanceTimersByTimeAsync(CLOUD_PENDING_POLL_MS * 3);
    expect(link.statusCalls).toBe(3);
    expect(cloud.active()).toBe(false);

    link.status = linked();
    await vi.advanceTimersByTimeAsync(CLOUD_PENDING_POLL_MS);
    expect(cloud.active()).toBe(true);
    expect(await cloud.view()).toMatchObject({ available: true, linked: true, problem: null, pending: false });

    // Pending ended: no more polling.
    const calls = link.statusCalls;
    await vi.advanceTimersByTimeAsync(CLOUD_PENDING_POLL_MS * 5);
    expect(link.statusCalls).toBe(calls);
  });

  it("gives up polling after 10 minutes", async () => {
    await cloud.start();
    clock += CLOUD_PENDING_MAX_MS + 1;
    await vi.advanceTimersByTimeAsync(CLOUD_PENDING_POLL_MS);
    expect((await cloud.view()).pending).toBe(false);
  });

  it.each(["reconnect", "notOnTesterList", "rateLimited"] as const)("a %s problem is linked but not active", async (problem) => {
    link.status = linked(problem);
    const view = await cloud.view();
    expect(view).toMatchObject({ linked: true, problem });
    expect(cloud.active()).toBe(false);
  });

  it("reconnect goes pending again while the problem stands, and ends when it clears", async () => {
    link.status = linked("reconnect");
    await cloud.view();
    await cloud.start();
    expect((await cloud.view()).pending).toBe(true);
    link.status = linked(null);
    await vi.advanceTimersByTimeAsync(CLOUD_PENDING_POLL_MS);
    expect(await cloud.view()).toMatchObject({ problem: null, pending: false });
    expect(cloud.active()).toBe(true);
  });

  it("unlink deletes the link and turns counting off", async () => {
    link.status = linked();
    await cloud.view();
    expect(cloud.active()).toBe(true);
    await cloud.unlink();
    expect(link.unlinks).toBe(1);
    expect(cloud.active()).toBe(false);
    expect(await cloud.view()).toMatchObject({ available: true, linked: false });
  });

  it("a 404 hides the row", async () => {
    link.status = "unavailable";
    expect(await cloud.view()).toMatchObject({ available: false, linked: false });
    expect(cloud.active()).toBe(false);
  });

  it("is unavailable and makes no request when signed out", async () => {
    settings.value = { libraryDir: "/lib", sync: null };
    expect((await cloud.view()).available).toBe(false);
    expect(link.statusCalls).toBe(0);
  });

  it("refuses an address that is not Spotify's own", async () => {
    link.authorizeUrl = "https://evil.example/authorize";
    await expect(cloud.start()).rejects.toThrow(/unexpected Spotify address/);
    expect((await cloud.view()).pending).toBe(false);
  });

  it("keeps the last answer through a network failure, and drops it on a sign-in error", async () => {
    link.status = linked();
    await cloud.view();
    link.status = "down";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await cloud.refresh();
    expect(cloud.active()).toBe(true);
    link.status = "auth";
    await cloud.refresh();
    expect(cloud.active()).toBe(false);
  });

  it("refreshIfStale reads at most every 5 minutes and goes inactive at once on sign-out", async () => {
    link.status = linked();
    await cloud.refreshIfStale();
    await cloud.refreshIfStale();
    expect(link.statusCalls).toBe(1);
    clock += CLOUD_REFRESH_MS;
    await cloud.refreshIfStale();
    expect(link.statusCalls).toBe(2);
    settings.value = { libraryDir: "/lib", sync: null };
    await cloud.refreshIfStale();
    expect(cloud.active()).toBe(false);
  });
});

describe("PlayTracker stands down while online counting is active (#307)", () => {
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
    reads = 0;
    position = 0;
    async read(): Promise<NowPlayingResult> {
      this.reads++;
      return { running: true, state: "playing", id: ID, positionSec: this.position, durationMs: 200_000 };
    }
  }

  let nowPlaying: FakeNowPlaying;
  let store: FakePlayCountStore;
  let tracker: PlayTracker;

  beforeEach(() => {
    nowPlaying = new FakeNowPlaying();
    store = new FakePlayCountStore();
    tracker = new PlayTracker(nowPlaying, settings, { list: async () => [release] }, store, () => clock, 5000, 30_000, "UTC", cloud);
    (tracker as unknown as { enabled: boolean }).enabled = true;
  });

  afterEach(() => tracker.stop());

  /** Five seconds on, then one poll; the position moves with the clock like a track playing. */
  async function tick(): Promise<void> {
    clock += 5000;
    nowPlaying.position += 5;
    await tracker.poll();
  }

  it("counts nothing, reads nothing and reports standing down while linked", async () => {
    link.status = linked();
    for (let i = 0; i < 12; i++) await tick();
    expect(nowPlaying.reads).toBe(0);
    expect((await store.get()).tracks).toEqual({});
    expect(tracker.standingDown()).toBe(true);
    expect(tracker.status()).toBe("on");
  });

  it("counts normally when online counting is off", async () => {
    for (let i = 0; i < 12; i++) await tick();
    expect(nowPlaying.reads).toBe(12);
    expect((await store.get()).tracks.t1?.count).toBe(1);
    expect(tracker.standingDown()).toBe(false);
  });

  it.each(["reconnect", "notOnTesterList", "rateLimited"] as const)("resumes once the link has a %s problem", async (problem) => {
    link.status = linked();
    await tick();
    expect(tracker.standingDown()).toBe(true);

    link.status = linked(problem);
    clock += CLOUD_REFRESH_MS; // the next 5-minute read sees it
    nowPlaying.position = 0;
    await tick();
    expect(tracker.standingDown()).toBe(false);
    for (let i = 0; i < 8; i++) await tick();
    expect(nowPlaying.reads).toBeGreaterThan(0);
    expect((await store.get()).tracks.t1?.count).toBe(1);
  });

  it("resumes after an unlink without waiting for the 5-minute read", async () => {
    link.status = linked();
    await tick();
    expect(tracker.standingDown()).toBe(true);
    await cloud.unlink();
    nowPlaying.position = 0;
    for (let i = 0; i < 8; i++) await tick();
    expect(tracker.standingDown()).toBe(false);
    expect((await store.get()).tracks.t1?.count).toBe(1);
  });

  it("does not credit the time spent standing down when it resumes mid-track", async () => {
    link.status = linked();
    for (let i = 0; i < 20; i++) await tick(); // 100 s into the track, counted online
    await cloud.unlink();
    await tick(); // first poll back: re-anchors, a jump is not a listen
    expect((await store.get()).tracks).toEqual({});
  });
});
