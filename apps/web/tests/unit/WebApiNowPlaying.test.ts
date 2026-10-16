import { describe, expect, it } from "vitest";
import { WebApiNowPlaying } from "../../src/server/plays/WebApiNowPlaying";
import { SpotifyApiError } from "../../src/server/spotify/SpotifyClient";

const URI = "spotify:local:Artist:Album:Title:200";

function webApi(body: unknown) {
  const paths: string[] = [];
  const np = new WebApiNowPlaying({
    requestOptional: async <T>(path: string) => {
      paths.push(path);
      return body as T | null;
    },
  });
  return { np, paths };
}

describe("WebApiNowPlaying", () => {
  it.each(["Smartphone", "Computer"])("maps a playing %s", async (type) => {
    const { np, paths } = webApi({
      is_playing: true,
      progress_ms: 12_500,
      item: { uri: URI, duration_ms: 200_000 },
      device: { type },
    });
    expect(await np.read()).toEqual({ running: true, state: "playing", id: URI, positionSec: 12.5, durationMs: 200_000 });
    expect(paths).toEqual(["/me/player"]);
  });

  it("maps a paused player", async () => {
    const { np } = webApi({ is_playing: false, progress_ms: 1000, item: { uri: URI, duration_ms: 5000 }, device: { type: "Smartphone" } });
    expect(await np.read()).toMatchObject({ running: true, state: "paused", id: URI });
  });

  it("maps no item to id null", async () => {
    const { np } = webApi({ is_playing: true, progress_ms: 0, item: null, device: { type: "Computer" } });
    expect(await np.read()).toEqual({ running: true, state: "playing", id: null, positionSec: 0, durationMs: 0 });
  });

  it("maps 204 No Content (no active player) to not running", async () => {
    const { np } = webApi(null);
    expect(await np.read()).toEqual({ running: false });
  });

  it.each([
    ["a string body", "oops"],
    ["a numeric uri", { is_playing: true, progress_ms: 1000, item: { uri: 5, duration_ms: 1000 } }],
    ["a missing progress", { is_playing: true, item: { uri: URI, duration_ms: 1000 } }],
    ["a string progress", { is_playing: true, progress_ms: "1000", item: { uri: URI, duration_ms: 1000 } }],
    ["an array item", { is_playing: true, progress_ms: 1000, item: [] }],
  ])("treats %s as id null", async (_name, body) => {
    const { np } = webApi(body);
    const r = await np.read();
    expect(r).toMatchObject({ running: true, id: null });
  });

  it("throws the client's error as is", async () => {
    const err = new SpotifyApiError("rateLimited", "slow", { retryAfterSec: 5, status: 429 });
    const np = new WebApiNowPlaying({
      requestOptional: async () => {
        throw err;
      },
    });
    await expect(np.read()).rejects.toBe(err);
  });
});
