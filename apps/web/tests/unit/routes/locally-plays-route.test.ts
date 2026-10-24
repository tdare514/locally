import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Release } from "../../../src/shared/types";
import type { Services } from "../../../src/server/container";
import { LocallyNowPlaying } from "../../../src/server/plays/LocallyNowPlaying";
import { PlayCountSession } from "../../../src/lib/play-queue";
import { FakePlayCountStore } from "../FakePlayCountStore";

let services: Services;
vi.mock("../../../src/server/container", () => ({ getServices: () => services }));

import { POST, PUT } from "../../../src/app/api/plays/locally/route";

const R1 = "11111111-1111-4111-8111-111111111111";
const T1 = "22222222-2222-4222-8222-222222222222";
const release = { id: R1, tracks: [{ id: T1 }] } as unknown as Release;
let store: FakePlayCountStore;
let nowPlaying: LocallyNowPlaying;
let trackPlays: boolean | undefined;

const req = (body: unknown) => new Request("http://localhost/api/plays/locally", { method: "POST", body: JSON.stringify(body) }) as never;

beforeEach(() => {
  delete process.env.LOCALLY_DEMO;
  trackPlays = true;
  store = new FakePlayCountStore();
  nowPlaying = new LocallyNowPlaying();
  services = {
    settings: { get: async () => ({ libraryDir: "/lib", trackPlays }) },
    library: { find: async (_d: string, id: string) => (id === R1 ? release : null) },
    playStore: store,
    locallyPlaying: nowPlaying,
  } as unknown as Services;
});

describe("/api/plays/locally (#338)", () => {
  it("counts a Locally play against the release and track it names", async () => {
    expect((await POST(req({ releaseId: R1, trackId: T1 }))).status).toBe(200);
    const entry = (await store.get()).tracks[T1];
    expect(entry.releaseId).toBe(R1);
    expect(entry.count).toBe(0);
    expect(entry.locally?.count).toBe(1);
    expect(Object.values(entry.locally?.days ?? {})).toEqual([1]);
  });

  it("404s a track the release does not hold, 400s a bad body", async () => {
    expect((await POST(req({ releaseId: R1, trackId: "33333333-3333-4333-8333-333333333333" }))).status).toBe(404);
    expect((await POST(req({ releaseId: "nope", trackId: T1 }))).status).toBe(400);
    expect((await store.get()).tracks).toEqual({});
  });

  it("records which track is playing, and clears it", async () => {
    await PUT(req({ trackId: T1 }));
    expect(nowPlaying.trackId()).toBe(T1);
    await PUT(req({ trackId: null }));
    expect(nowPlaying.trackId()).toBeNull();
  });

  it("counts nothing and answers 204 while Count plays is off (or never set)", async () => {
    for (const off of [false, undefined]) {
      trackPlays = off;
      expect((await POST(req({ releaseId: R1, trackId: T1 }))).status).toBe(204);
      expect((await PUT(req({ trackId: T1 }))).status).toBe(204);
      expect((await store.get()).tracks).toEqual({});
      expect(nowPlaying.trackId()).toBeNull();
    }
  });

  it("a Locally play past 30 s changes nothing with Count plays off, and counts with it on", async () => {
    // The player's rule (PlayCountSession) reports a play after 30 s; the report is a POST to this route.
    const play = async () => {
      const posts: Promise<Response>[] = [];
      const session = new PlayCountSession((item) => posts.push(POST(req(item))));
      for (let s = 0; s <= 31; s++) session.sample({ releaseId: R1, trackId: T1 }, { at: s * 1000, playing: true, positionSec: s, durationSec: 200 });
      return Promise.all(posts);
    };
    trackPlays = false;
    expect((await play()).map((r) => r.status)).toEqual([204]);
    expect((await store.get()).tracks).toEqual({});
    trackPlays = true;
    expect((await play()).map((r) => r.status)).toEqual([200]);
    expect((await store.get()).tracks[T1].locally?.count).toBe(1);
  });

  it("403s in the demo", async () => {
    process.env.LOCALLY_DEMO = "1";
    expect((await POST(req({ releaseId: R1, trackId: T1 }))).status).toBe(403);
    expect((await PUT(req({ trackId: T1 }))).status).toBe(403);
    delete process.env.LOCALLY_DEMO;
  });
});
