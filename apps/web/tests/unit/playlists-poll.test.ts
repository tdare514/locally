import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextPollDelayMs, startPlaylistsPolling, POLL_WINDOW_MS } from "../../src/lib/playlists-poll";
import type { SpotifyPlaylistsResponse } from "../../src/shared/types";

const busy: SpotifyPlaylistsResponse = { connected: true, tracks: {}, refreshing: true };
const done: SpotifyPlaylistsResponse = { connected: true, tracks: { t1: [{ id: "x", name: "Gym" }] }, refreshing: false };

describe("nextPollDelayMs", () => {
  it("is 2.5 s for the first 30 s, then 10 s, while refreshing; stops after 4 minutes", () => {
    expect(nextPollDelayMs(0, busy)).toBe(2500);
    expect(nextPollDelayMs(29_999, busy)).toBe(2500);
    expect(nextPollDelayMs(30_000, busy)).toBe(10_000);
    expect(nextPollDelayMs(POLL_WINDOW_MS, busy)).toBeNull();
  });
  it("stops when done or not connected, and follows the server's retry hint", () => {
    expect(nextPollDelayMs(0, done)).toBeNull();
    expect(nextPollDelayMs(0, { connected: false, tracks: {}, refreshing: false })).toBeNull();
    expect(nextPollDelayMs(1000, { ...done, retryAfterSec: 45 })).toBe(45_500);
    expect(nextPollDelayMs(POLL_WINDOW_MS - 1000, { ...done, retryAfterSec: 45 })).toBeNull();
  });
});

describe("startPlaylistsPolling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the lines when a refresh delayed 45 s finally finishes", async () => {
    const start = Date.now();
    const fetchFn = vi.fn(async () => (Date.now() - start < 45_000 ? busy : done));
    const seen: SpotifyPlaylistsResponse[] = [];
    const polling = startPlaylistsPolling(fetchFn, (r) => seen.push(r));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(seen.at(-1)).toEqual(done);
    const calls = fetchFn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchFn.mock.calls.length).toBe(calls);
    polling.stop();
  });

  it("stops on unmount and looks again once on poke", async () => {
    const fetchFn = vi.fn(async () => busy);
    const polling = startPlaylistsPolling(fetchFn, () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    polling.poke();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    polling.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("gives up after 4 minutes of refreshing", async () => {
    const fetchFn = vi.fn(async () => busy);
    startPlaylistsPolling(fetchFn, () => {});
    await vi.advanceTimersByTimeAsync(POLL_WINDOW_MS + 60_000);
    const n = fetchFn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchFn.mock.calls.length).toBe(n);
  });
});
