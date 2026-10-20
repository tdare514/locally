import { afterEach, describe, expect, it, vi } from "vitest";
import { SwitchingNowPlaying } from "../../src/server/plays/SwitchingNowPlaying";
import type { NowPlayingResult, SpotifyNowPlaying } from "../../src/server/plays/SpotifyNowPlaying";
import { SpotifyApiError } from "../../src/server/spotify/SpotifyClient";
import { MemorySettings, SAMPLE_SPOTIFY } from "./spotifyFakes";

const WEB: NowPlayingResult = { running: true, state: "playing", id: "web", positionSec: 1, durationMs: 0 };
const MAC: NowPlayingResult = { running: true, state: "playing", id: "spotify:local:M:A:C:1", positionSec: 1, durationMs: 0 };

class Fake implements SpotifyNowPlaying {
  calls = 0;
  fail: unknown = null;
  constructor(private readonly result: NowPlayingResult) {}
  async read(): Promise<NowPlayingResult> {
    this.calls++;
    if (this.fail) throw this.fail;
    return this.result;
  }
}

function setup(over: { spotify?: boolean; countOtherDevices?: boolean } = {}) {
  const settings = new MemorySettings();
  settings.value = {
    ...settings.value,
    countOtherDevices: over.countOtherDevices ?? true,
    ...(over.spotify === false ? {} : { spotify: SAMPLE_SPOTIFY }),
  };
  const web = new Fake(WEB);
  const mac = new Fake(MAC);
  let clock = 1_000_000;
  const sw = new SwitchingNowPlaying({ web, appleScript: mac, settings, now: () => clock });
  return { settings, web, mac, sw, advance: (ms: number) => (clock += ms) };
}

afterEach(() => vi.restoreAllMocks());

describe("SwitchingNowPlaying", () => {
  it("reads the Web API while connected and on", async () => {
    const { sw, web, mac } = setup();
    expect(await sw.read()).toBe(WEB);
    expect(web.calls).toBe(1);
    expect(mac.calls).toBe(0);
    expect(sw.currentSource()).toBe("account");
    expect(sw.fallingBack()).toBe(false);
  });

  it("reads AppleScript when the setting is off", async () => {
    const { sw, web, mac } = setup({ countOtherDevices: false });
    expect(await sw.read()).toBe(MAC);
    expect(web.calls).toBe(0);
    expect(mac.calls).toBe(1);
    expect(sw.currentSource()).toBe("this-mac");
    expect(sw.fallingBack()).toBe(false);
  });

  it("reads AppleScript when disconnected, and again after the setting is turned off", async () => {
    const off = setup({ spotify: false });
    expect(await off.sw.read()).toBe(MAC);
    expect(off.web.calls).toBe(0);

    const t = setup();
    await t.sw.read();
    t.settings.value = { ...t.settings.value, countOtherDevices: false };
    expect(await t.sw.read()).toBe(MAC);
    expect(t.web.calls).toBe(1);
  });

  const cases: [string, SpotifyApiError, number][] = [
    ["a 429 without Retry-After", new SpotifyApiError("rateLimited", "x", { status: 429 }), 60],
    ["a 429 with a short Retry-After", new SpotifyApiError("rateLimited", "x", { retryAfterSec: 5, status: 429 }), 60],
    ["a 429 with a long Retry-After", new SpotifyApiError("rateLimited", "x", { retryAfterSec: 300, status: 429 }), 300],
    ["offline", new SpotifyApiError("offline", "x"), 60],
    ["a 403", new SpotifyApiError("http", "x", { status: 403 }), 60],
    ["a tester-list 403", new SpotifyApiError("notOnTesterList", "x", { status: 403 }), 60],
    ["an unrefreshable 401", new SpotifyApiError("disconnected", "x"), 60],
    ["a malformed answer", new SpotifyApiError("http", "x"), 60],
  ];

  it.each(cases)("%s falls back for that read and holds off %i s", async (_n, err, sec) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { sw, web, mac, advance } = setup();
    web.fail = err;
    expect(await sw.read()).toBe(MAC);
    expect(sw.fallingBack()).toBe(true);
    expect(sw.currentSource()).toBe("this-mac");

    advance(sec * 1000 - 1);
    expect(await sw.read()).toBe(MAC);
    expect(web.calls).toBe(1); // held off: the Web API is not asked
    expect(mac.calls).toBe(2);

    web.fail = null;
    advance(1);
    expect(await sw.read()).toBe(WEB); // back after the hold-off
    expect(web.calls).toBe(2);
    expect(sw.fallingBack()).toBe(false);
    expect(sw.currentSource()).toBe("account");
  });

  it("a failure during the retry holds off again, and logs once per streak without secrets", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { sw, web, advance } = setup();
    web.fail = new SpotifyApiError("offline", "x");
    await sw.read();
    advance(60_000);
    await sw.read();
    expect(web.calls).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SAMPLE_SPOTIFY.accessToken);
    web.fail = null;
    advance(60_000);
    await sw.read();
    web.fail = new SpotifyApiError("offline", "x");
    advance(1);
    await sw.read();
    expect(warn).toHaveBeenCalledTimes(2); // a new streak logs again
  });

  it("falls back on a non-Spotify error too", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { sw, web } = setup();
    web.fail = new Error("boom");
    expect(await sw.read()).toBe(MAC);
    expect(sw.fallingBack()).toBe(true);
  });

  it("takes the hold-off from when the failure arrived, not when the request began", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { sw, web, advance } = setup();
    web.read = async () => {
      web.calls++;
      advance(20_000); // the request is slow
      throw new SpotifyApiError("rateLimited", "x", { retryAfterSec: 60, status: 429 });
    };
    await sw.read();
    advance(59_999);
    await sw.read();
    expect(web.calls).toBe(1); // 60 s after the failure arrived is not yet
    web.read = async () => WEB;
    advance(1);
    expect(await sw.read()).toBe(WEB);
  });

  it("during a fallback only this Mac's active local play passes; everything else holds", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { sw, web, advance } = setup();
    const mac = (over: object): NowPlayingResult => ({ ...(MAC as object), ...over }) as NowPlayingResult;
    const cases: [string, NowPlayingResult, boolean][] = [
      ["playing local", MAC, true],
      ["paused local", mac({ state: "paused" }), false],
      ["stopped", mac({ state: "stopped" }), false],
      ["not running", { running: false }, false],
      ["non-local track", mac({ id: "spotify:track:abc" }), false],
      ["no track", mac({ id: null }), false],
      ["error", { error: "failed" }, false],
      ["permission denied", { error: "permission-denied" }, false],
    ];
    web.fail = new SpotifyApiError("offline", "x");
    for (const [name, result, passes] of cases) {
      (sw as unknown as { deps: { appleScript: { read: () => Promise<NowPlayingResult> } } }).deps.appleScript.read = async () => result;
      advance(1000); // inside the hold-off after the first failure
      expect(await sw.read(), name).toEqual(passes ? result : { hold: true });
    }
  });

  it("with the setting off every AppleScript result passes through", async () => {
    const { sw, mac } = setup({ countOtherDevices: false });
    mac.read = async () => ({ running: false });
    expect(await sw.read()).toEqual({ running: false });
    mac.read = async () => ({ error: "failed" });
    expect(await sw.read()).toEqual({ error: "failed" });
  });
});
