import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Release } from "../../../src/shared/types";
import type { Services } from "../../../src/server/container";
import { LocallyNowPlaying } from "../../../src/server/plays/LocallyNowPlaying";
import { FakePlayCountStore } from "../FakePlayCountStore";

let services: Services;
vi.mock("../../../src/server/container", () => ({ getServices: () => services }));

import { POST, PUT } from "../../../src/app/api/plays/locally/route";

const R1 = "11111111-1111-4111-8111-111111111111";
const T1 = "22222222-2222-4222-8222-222222222222";
const release = { id: R1, tracks: [{ id: T1 }] } as unknown as Release;
let store: FakePlayCountStore;
let nowPlaying: LocallyNowPlaying;

const req = (body: unknown) => new Request("http://localhost/api/plays/locally", { method: "POST", body: JSON.stringify(body) }) as never;

beforeEach(() => {
  delete process.env.LOCALLY_DEMO;
  store = new FakePlayCountStore();
  nowPlaying = new LocallyNowPlaying();
  services = {
    settings: { get: async () => ({ libraryDir: "/lib" }) },
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

  it("403s in the demo", async () => {
    process.env.LOCALLY_DEMO = "1";
    expect((await POST(req({ releaseId: R1, trackId: T1 }))).status).toBe(403);
    expect((await PUT(req({ trackId: T1 }))).status).toBe(403);
    delete process.env.LOCALLY_DEMO;
  });
});
