import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Services } from "../../../src/server/container";
import { PlaylistIndex } from "../../../src/server/spotify/PlaylistIndex";
import type { PlaylistCache, PlaylistCacheStore } from "../../../src/server/spotify/PlaylistCacheStore";
import type { Release } from "../../../src/shared/types";
import { MemorySettings, SAMPLE_SPOTIFY } from "../spotifyFakes";

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

let services: Services;
let available = true;
vi.mock("../../../src/server/container", () => ({
  getServices: () => {
    if (process.env.LOCALLY_DEMO === "1") throw new Error("getServices() is not available in the demo build");
    return services;
  },
}));
vi.mock("../../../src/server/spotify/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/server/spotify/config")>();
  return { ...actual, spotifyAvailable: () => process.env.LOCALLY_DEMO !== "1" && available };
});

import { GET } from "../../../src/app/api/spotify/playlists/route";
import { POST } from "../../../src/app/api/spotify/open-playlist/route";

const PL = "A".repeat(22);
const URI = "spotify:local:Artist:Album:Song+One:200";
const RELEASES: Release[] = ["r1", "r2"].map((id, i) => ({
  id, kind: "album", title: i ? "Other" : "Album", artist: i ? "Someone" : "Artist", year: null, genre: null,
  coverPath: null, folderPath: `/lib/${id}`, createdAt: "", updatedAt: "",
  tracks: [{ id: `t${i + 1}`, title: i ? "Elsewhere" : "Song One", trackNumber: 1, filePath: "/x", originalName: "x", durationSec: 200 }],
}));

let settings: MemorySettings;
let cache: PlaylistCache | null;

beforeEach(() => {
  available = true;
  execFileMock.mockReset();
  execFileMock.mockImplementation((_cmd: string, _args: string[], cb: (e: Error | null) => void) => cb(null));
  settings = new MemorySettings();
  settings.value = { ...settings.value, spotify: { ...SAMPLE_SPOTIFY } };
  cache = {
    revision: SAMPLE_SPOTIFY.revision,
    fetchedAt: Date.now(),
    playlists: {
      [PL]: { snapshotId: "s", name: "Night drive", localUris: [URI, "spotify:local:Someone:Other:Elsewhere:200"] },
    },
  };
  const store: PlaylistCacheStore = {
    read: async () => cache,
    write: async (c) => { cache = c; },
    remove: async () => { cache = null; },
  };
  const playlistIndex = new PlaylistIndex({
    client: { request: async () => { throw new Error("no network in this test"); } },
    store,
    settings,
    library: { list: async () => RELEASES },
  });
  services = { playlistIndex, settings } as unknown as Services;
});

afterEach(() => {
  delete process.env.LOCALLY_DEMO;
});

const get = (qs: string) => GET(new NextRequest(`http://127.0.0.1:3000/api/spotify/playlists${qs}`));
const post = (body: unknown) =>
  POST(new Request("http://127.0.0.1:3000/api/spotify/open-playlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));

describe("GET /api/spotify/playlists", () => {
  it("returns only the asked release's tracks, from the cache, with no token", async () => {
    const res = await get("?releaseId=r1");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      connected: true,
      tracks: { t1: [{ id: PL, name: "Night drive" }] },
      refreshing: false,
    });
    expect(text).not.toContain(SAMPLE_SPOTIFY.accessToken);
    expect(text).not.toContain(SAMPLE_SPOTIFY.refreshToken);
  });

  it("answers connected: false when not connected", async () => {
    const { spotify: _s, ...rest } = settings.value;
    void _s;
    settings.value = rest;
    const res = await get("?releaseId=r1");
    expect(await res.json()).toEqual({ connected: false, tracks: {}, refreshing: false });
  });

  it("is 404 when Spotify is unavailable and in the demo, 400 without a releaseId", async () => {
    available = false;
    expect((await get("?releaseId=r1")).status).toBe(404);
    available = true;
    process.env.LOCALLY_DEMO = "1";
    expect((await get("?releaseId=r1")).status).toBe(404);
    delete process.env.LOCALLY_DEMO;
    expect((await get("")).status).toBe(400);
  });
});

describe("POST /api/spotify/open-playlist", () => {
  const platform = process.platform;
  afterEach(() => Object.defineProperty(process, "platform", { value: platform }));

  it("opens exactly spotify:playlist:<id> with an argument array", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    const res = await post({ id: PL });
    expect(res.status).toBe(200);
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock.mock.calls[0][0]).toBe("open");
    expect(execFileMock.mock.calls[0][1]).toEqual([`spotify:playlist:${PL}`]);
  });

  it.each([
    ["too short", "abc"],
    ["too long", "A".repeat(23)],
    ["punctuation", `${"A".repeat(21)}:`],
    ["an option", "-a Calculator".padEnd(22, "x")],
    ["a path", "../".padEnd(22, "x")],
    ["a newline", `${"A".repeat(21)}\n`],
  ])("rejects an id that is %s with 400 and never runs open", async (_n, id) => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    expect((await post({ id })).status).toBe(400);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("rejects a missing, non-string or unreadable body", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    expect((await post({})).status).toBe(400);
    expect((await post({ id: 5 })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("is 404 when unavailable and in the demo, 400 off macOS", async () => {
    available = false;
    expect((await post({ id: PL })).status).toBe(404);
    available = true;
    process.env.LOCALLY_DEMO = "1";
    expect((await post({ id: PL })).status).toBe(404);
    delete process.env.LOCALLY_DEMO;
    Object.defineProperty(process, "platform", { value: "linux" });
    expect((await post({ id: PL })).status).toBe(400);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
