import { afterEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../../src/shared/types";
import type { SettingsStore } from "../../src/server/config/SettingsStore";
import type { PlayCounts } from "../../src/server/plays/PlayCountStore";
import type { ServerReleasePlays } from "../../src/server/plays/playsWire";
import {
  batchPlayEntries,
  loadReleasePlays,
  mergeReleasePlays,
  pendingPlayEntries,
} from "../../src/server/plays/releasePlays";
import type { SyncApi } from "../../src/server/sync/SyncApi";
import { FakePlayCountStore } from "./FakePlayCountStore";

const REL = "3f2a6c1e-8b7d-4e5a-9c1d-2a4b6c8d0e1f";
const OTHER_REL = "9b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8";
const MAC = "Tobys-MacBook-Pro.local";
const t = (n: number) => `a1b2c3d4-${String(n).padStart(4, "0")}-4a5b-8c9d-0123456789ab`;

function local(tracks: Record<string, { releaseId: string; count: number; pushed?: number }>): PlayCounts {
  return {
    version: 1,
    tracks: Object.fromEntries(
      Object.entries(tracks).map(([id, e]) => [id, { releaseId: e.releaseId, count: e.count, pushed: e.pushed ?? 0 }]),
    ),
  };
}

function device(name: string, count: number, current: boolean, platform = "ios") {
  return { deviceId: `dev-${name}`, name, platform, count, current };
}

function server(...tracks: { trackId: string; devices: ReturnType<typeof device>[] }[]): ServerReleasePlays {
  return { tracks: tracks.map((tr) => ({ ...tr, total: tr.devices.reduce((n, d) => n + d.count, 0) })) };
}

describe("pendingPlayEntries", () => {
  it("lists entries with count above pushed, with the absolute count", () => {
    const counts = local({
      [t(1)]: { releaseId: REL, count: 5 },
      [t(2)]: { releaseId: REL, count: 7, pushed: 3 },
      [t(3)]: { releaseId: REL, count: 4, pushed: 4 },
    });
    expect(pendingPlayEntries(counts)).toEqual([
      { releaseId: REL, trackId: t(1), count: 5 },
      { releaseId: REL, trackId: t(2), count: 7 },
    ]);
  });

  it("never carries day buckets: an entry with days is pushed as releaseId, trackId and count only (#200)", () => {
    const counts: PlayCounts = {
      version: 1,
      tracks: { [t(1)]: { releaseId: REL, count: 5, pushed: 0, days: { "2026-10-15": 5 } } },
    };
    const [entry] = pendingPlayEntries(counts);
    expect(entry).toEqual({ releaseId: REL, trackId: t(1), count: 5 });
    expect(Object.keys(entry).sort()).toEqual(["count", "releaseId", "trackId"]);
  });

  it("leaves out entries the service would refuse", () => {
    const counts = local({
      "not-a-uuid": { releaseId: REL, count: 1 },
      [t(1)]: { releaseId: "nope", count: 1 },
      [t(2)]: { releaseId: REL, count: 1_000_001 },
      [t(3)]: { releaseId: REL, count: 1_000_000 },
    });
    expect(pendingPlayEntries(counts)).toEqual([{ releaseId: REL, trackId: t(3), count: 1_000_000 }]);
  });

  it("is empty when nothing is pending", () => {
    expect(pendingPlayEntries(local({}))).toEqual([]);
  });
});

describe("batchPlayEntries", () => {
  const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ releaseId: REL, trackId: t(i), count: 1 }));

  it("splits at 500 entries per request", () => {
    expect(batchPlayEntries(entries(1200)).map((b) => b.length)).toEqual([500, 500, 200]);
    expect(batchPlayEntries(entries(500)).map((b) => b.length)).toEqual([500]);
    expect(batchPlayEntries(entries(501)).map((b) => b.length)).toEqual([500, 1]);
  });

  it("makes no request for no entries", () => {
    expect(batchPlayEntries([])).toEqual([]);
  });
});

describe("mergeReleasePlays", () => {
  it("signed out: this Mac only, the total is its count", () => {
    const merged = mergeReleasePlays(local({ [t(1)]: { releaseId: REL, count: 12 } }), REL, null);
    expect(merged).toEqual({
      tracks: [
        { trackId: t(1), total: 12, devices: [{ name: "This Mac", platform: "mac", count: 12, current: true }] },
      ],
    });
  });

  it("only counts tracks of the asked release", () => {
    const merged = mergeReleasePlays(
      local({ [t(1)]: { releaseId: REL, count: 2 }, [t(2)]: { releaseId: OTHER_REL, count: 9 } }),
      REL,
      null,
    );
    expect(merged.tracks.map((tr) => tr.trackId)).toEqual([t(1)]);
  });

  it("a device on a platform it has never heard of is another device, even with this Mac's name (#185)", () => {
    const merged = mergeReleasePlays(
      local({ [t(1)]: { releaseId: REL, count: 4 } }),
      REL,
      server({ trackId: t(1), devices: [device("Toby's MacBook", 9, false, "web"), device("Gadget", 2, false, "future-thing")] }),
      "Toby's MacBook",
    );
    expect(merged.tracks[0].total).toBe(15);
    expect(merged.tracks[0].devices.map((d) => [d.name, d.platform, d.count])).toEqual([
      ["Toby's MacBook", "web", 9],
      ["Gadget", "future-thing", 2],
      ["This Mac", "mac", 4],
    ]);
  });

  it("this Mac is the local count when it is ahead of the service", () => {
    const merged = mergeReleasePlays(
      local({ [t(1)]: { releaseId: REL, count: 12 } }),
      REL,
      server({ trackId: t(1), devices: [device("Toby's MacBook", 9, true, "mac"), device("iPhone 14", 7, false)] }),
    );
    expect(merged.tracks).toEqual([
      {
        trackId: t(1),
        total: 19,
        devices: [
          { name: "iPhone 14", platform: "ios", count: 7, current: false },
          { name: "This Mac", platform: "mac", count: 12, current: true },
        ],
      },
    ]);
  });

  it("this Mac is the service's count when that is ahead (counts lost locally)", () => {
    const merged = mergeReleasePlays(
      local({ [t(1)]: { releaseId: REL, count: 2 } }),
      REL,
      server({ trackId: t(1), devices: [device("Mac", 10, true, "mac"), device("iPhone", 1, false)] }),
    );
    expect(merged.tracks[0].total).toBe(11);
    expect(merged.tracks[0].devices.find((d) => d.current)?.count).toBe(10);
  });

  it("does not add this Mac's pushed count twice", () => {
    const merged = mergeReleasePlays(
      local({ [t(1)]: { releaseId: REL, count: 5, pushed: 5 } }),
      REL,
      server({ trackId: t(1), devices: [device("Mac", 5, true, "mac")] }),
    );
    expect(merged.tracks[0].total).toBe(5);
  });

  it("sums several other devices and keeps a track only the service knows", () => {
    const merged = mergeReleasePlays(
      local({}),
      REL,
      server({ trackId: t(1), devices: [device("iPhone", 3, false), device("iPad", 4, false)] }),
    );
    expect(merged.tracks).toEqual([
      {
        trackId: t(1),
        total: 7,
        devices: [
          { name: "iPhone", platform: "ios", count: 3, current: false },
          { name: "iPad", platform: "ios", count: 4, current: false },
        ],
      },
    ]);
  });

  it("lists no track without plays", () => {
    const merged = mergeReleasePlays(
      local({ [t(1)]: { releaseId: REL, count: 0 } }),
      REL,
      server({ trackId: t(2), devices: [device("Mac", 0, true, "mac")] }),
    );
    expect(merged).toEqual({ tracks: [] });
  });

  describe("this Mac's old device row after a sign-out and sign-in", () => {
    const merge = (local_: PlayCounts, srv: ServerReleasePlays, deviceName?: string) =>
      mergeReleasePlays(local_, REL, srv, deviceName);

    it("folds a revoked Mac row with this Mac's name into this Mac, not on top of it", () => {
      const merged = merge(
        local({ [t(1)]: { releaseId: REL, count: 5 } }),
        server({ trackId: t(1), devices: [device(MAC, 5, true, "mac"), device(MAC, 5, false, "mac")] }),
        MAC,
      );
      expect(merged.tracks).toEqual([
        { trackId: t(1), total: 5, devices: [{ name: "This Mac", platform: "mac", count: 5, current: true }] },
      ]);
    });

    it("uses the biggest of local, current row and old rows, several old rows included", () => {
      const merged = merge(
        local({ [t(1)]: { releaseId: REL, count: 2 } }),
        server({
          trackId: t(1),
          devices: [device(MAC, 1, true, "mac"), device(MAC, 9, false, "mac"), device(MAC, 6, false, "mac")],
        }),
        MAC,
      );
      expect(merged.tracks[0].total).toBe(9);
    });

    it("folds an old row when the service holds no row for the current device yet", () => {
      const merged = merge(
        local({ [t(1)]: { releaseId: REL, count: 5 } }),
        server({ trackId: t(1), devices: [device(MAC, 5, false, "mac")] }),
        MAC,
      );
      expect(merged.tracks[0].total).toBe(5);
    });

    it("also matches the name the service holds for the current row, if the hostname has drifted", () => {
      const merged = merge(
        local({ [t(1)]: { releaseId: REL, count: 4 } }),
        server({
          trackId: t(1),
          devices: [device("Tobys-MacBook-Pro", 4, true, "mac"), device("Tobys-MacBook-Pro", 4, false, "mac")],
        }),
        MAC,
      );
      expect(merged.tracks[0].total).toBe(4);
    });

    it("still adds a Mac with a different name", () => {
      const merged = merge(
        local({ [t(1)]: { releaseId: REL, count: 5 } }),
        server({
          trackId: t(1),
          devices: [device(MAC, 5, true, "mac"), device(MAC, 5, false, "mac"), device("Studio Mac", 3, false, "mac")],
        }),
        MAC,
      );
      expect(merged.tracks[0].total).toBe(8);
      expect(merged.tracks[0].devices).toEqual([
        { name: "Studio Mac", platform: "mac", count: 3, current: false },
        { name: "This Mac", platform: "mac", count: 5, current: true },
      ]);
    });

    it("never folds a phone that happens to share the name", () => {
      const merged = merge(
        local({ [t(1)]: { releaseId: REL, count: 5 } }),
        server({ trackId: t(1), devices: [device(MAC, 2, false, "ios")] }),
        MAC,
      );
      expect(merged.tracks[0].total).toBe(7);
    });
  });
});

describe("loadReleasePlays", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  afterEach(() => {
    warn.mockClear();
  });

  function settingsStore(settings: Settings): SettingsStore {
    return { get: async () => settings, set: async (s) => s };
  }

  const signedOut: Settings = { libraryDir: "/tmp/lib", sync: null };
  const signedIn: Settings = {
    libraryDir: "/tmp/lib",
    sync: { baseUrl: "http://sync.test", deviceToken: "secret-token-123", email: "a@b.com", lastVersion: 0 },
  };

  it("makes no service call while signed out", async () => {
    const plays = new FakePlayCountStore();
    plays.seed(t(1), REL, 3);
    const factory = vi.fn();

    const res = await loadReleasePlays({ settings: settingsStore(signedOut), playStore: plays, syncApiFactory: factory, deviceName: MAC }, REL);

    expect(factory).not.toHaveBeenCalled();
    expect(res.tracks).toHaveLength(1);
    expect(res.tracks[0].total).toBe(3);
  });

  it("signed in: one service call with the device token, merged with this Mac", async () => {
    const plays = new FakePlayCountStore();
    plays.seed(t(1), REL, 3);
    const releasePlays = vi.fn(async () =>
      server({ trackId: t(1), devices: [device("Mac", 1, true, "mac"), device("iPhone", 2, false)] }),
    );
    const factory = vi.fn(() => ({ releasePlays }) as unknown as SyncApi);

    const res = await loadReleasePlays({ settings: settingsStore(signedIn), playStore: plays, syncApiFactory: factory, deviceName: MAC }, REL);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith("http://sync.test", "secret-token-123");
    expect(releasePlays).toHaveBeenCalledTimes(1);
    expect(releasePlays).toHaveBeenCalledWith(REL);
    expect(res.tracks[0].total).toBe(5);
  });

  it("folds this Mac's old device row using the device name it is given", async () => {
    const plays = new FakePlayCountStore();
    plays.seed(t(1), REL, 5);
    const factory = () =>
      ({
        releasePlays: async () =>
          server({ trackId: t(1), devices: [device(MAC, 5, true, "mac"), device(MAC, 5, false, "mac")] }),
      }) as unknown as SyncApi;

    const res = await loadReleasePlays({ settings: settingsStore(signedIn), playStore: plays, syncApiFactory: factory, deviceName: MAC }, REL);

    expect(res.tracks[0].total).toBe(5);
  });

  it("falls back to this Mac when the service fails, and never logs the token", async () => {
    const plays = new FakePlayCountStore();
    plays.seed(t(1), REL, 3);
    const factory = () =>
      ({
        releasePlays: async () => {
          throw new Error("Sync request failed (503)");
        },
      }) as unknown as SyncApi;

    const res = await loadReleasePlays({ settings: settingsStore(signedIn), playStore: plays, syncApiFactory: factory, deviceName: MAC }, REL);

    expect(res.tracks[0].total).toBe(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-token-123");
  });
});
