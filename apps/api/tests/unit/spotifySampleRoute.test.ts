import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSamplerKit, idle, insertLink, PLAYER_URL } from "../support/fakeSpotify";
import { createTestServices, type TestServices } from "../support/testServices";

let testServices: TestServices;

vi.mock("../../src/server/container", () => ({
  getServices: async () => testServices,
}));

import * as sampleRoute from "../../src/app/v1/internal/spotify-sample/route";
import * as releaseRoute from "../../src/app/v1/releases/[id]/route";
import * as releasesListRoute from "../../src/app/v1/releases/route";
import * as meRoute from "../../src/app/v1/me/route";
import * as authVerifyRoute from "../../src/app/v1/auth/verify/route";
import { makeReleaseRecord } from "../support/fixtures";

const SECRET = "sampler-secret-for-tests";

function post(authorization?: string): Request {
  return new Request("http://localhost/v1/internal/spotify-sample", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

function json(url: string, method: string, body?: unknown, token?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function signIn(email: string): Promise<{ token: string; userId: string }> {
  const code = await testServices.auth.issueCode(email);
  const res = await authVerifyRoute.POST(
    json("http://localhost/v1/auth/verify", "POST", { email, code, deviceName: "Mac", platform: "mac" })
  );
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

describe("POST /v1/internal/spotify-sample", () => {
  beforeEach(async () => {
    testServices = await createTestServices();
  });

  async function enable() {
    const kit = makeSamplerKit(testServices.db, Date.now());
    testServices.sampler = kit.sampler;
    testServices.samplerSecret = SECRET;
    return kit;
  }

  it("404s when the feature is off, even with the right bearer", async () => {
    const res = await sampleRoute.POST(post(`Bearer ${SECRET}`));
    expect(res.status).toBe(404);
  });

  it("401s with a missing, wrong or cron-style bearer", async () => {
    await enable();
    testServices.cronSecret = "the-cron-secret";
    expect((await sampleRoute.POST(post())).status).toBe(401);
    expect((await sampleRoute.POST(post("Bearer nope"))).status).toBe(401);
    expect((await sampleRoute.POST(post(`Bearer ${SECRET}x`))).status).toBe(401);
    expect((await sampleRoute.POST(post(SECRET))).status).toBe(401);
    expect((await sampleRoute.POST(post("Bearer the-cron-secret"))).status).toBe(401);
  });

  it("runs with the right bearer, replies with counts only, and skips a call while a lease is held", async () => {
    const kit = await enable();
    const { userId } = await signIn("a@example.com");
    await insertLink(testServices.db, kit.cipher, userId, Date.now());
    kit.spotify.answer(PLAYER_URL, idle);
    const first = await sampleRoute.POST(post(`Bearer ${SECRET}`));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ sampled: 1, counted: 0, skipped: false, nextInMs: 30_000 });
    const { samplerLease } = await import("../../src/db/schema");
    await testServices.db.update(samplerLease).set({ until: Date.now() + 30_000 }); // another run holds it
    const second = await sampleRoute.POST(post(`Bearer ${SECRET}`));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ sampled: 0, counted: 0, skipped: true, nextInMs: 10_000 });
  });

  it("does not let the sampler secret reach the cleanup-style routes, nor a device token reach the sampler", async () => {
    await enable();
    const { token } = await signIn("a@example.com");
    expect((await sampleRoute.POST(post(`Bearer ${token}`))).status).toBe(401);
  });
});

describe("GET /v1/me with a cloud device", () => {
  beforeEach(async () => {
    testServices = await createTestServices();
  });

  it("lists only real devices", async () => {
    const { token, userId } = await signIn("a@example.com");
    const { devices } = await import("../../src/db/schema");
    await testServices.db.insert(devices).values({
      id: crypto.randomUUID(), userId, name: "Spotify (online)", platform: "cloud", tokenHash: "x", createdAt: Date.now(), lastSeenAt: Date.now(), revokedAt: null, installId: null,
    });
    const res = await meRoute.GET(json("http://localhost/v1/me", "GET", undefined, token));
    const body = (await res.json()) as { devices: { platform: string }[]; devicesHasMore: boolean };
    expect(body.devices.map((d) => d.platform)).toEqual(["mac"]);
    expect(body.devicesHasMore).toBe(false);
  });
});

describe("tracks[].localId", () => {
  const LOCAL = "spotify:local:Artist:Album:Title:200";

  beforeEach(async () => {
    testServices = await createTestServices();
  });

  async function put(token: string, record: unknown, id: string) {
    return releaseRoute.PUT(json(`http://localhost/v1/releases/${id}`, "PUT", record, token), { params: Promise.resolve({ id }) });
  }

  it("is accepted and round-trips through PUT and GET", async () => {
    const { token } = await signIn("a@example.com");
    const record = makeReleaseRecord();
    (record.tracks[0] as { localId?: string }).localId = LOCAL;
    expect((await put(token, record, record.id)).status).toBe(200);
    const res = await releasesListRoute.GET(json("http://localhost/v1/releases?sinceVersion=0", "GET", undefined, token));
    const body = (await res.json()) as { releases: { tracks: { localId?: string }[] }[] };
    expect(body.releases[0]!.tracks[0]!.localId).toBe(LOCAL);
  });

  it("stays absent when not sent", async () => {
    const { token } = await signIn("a@example.com");
    const record = makeReleaseRecord();
    expect((await put(token, record, record.id)).status).toBe(200);
    const res = await releasesListRoute.GET(json("http://localhost/v1/releases?sinceVersion=0", "GET", undefined, token));
    const body = (await res.json()) as { releases: { tracks: object[] }[] };
    expect("localId" in body.releases[0]!.tracks[0]!).toBe(false);
  });

  it("is a 400 with a bad prefix or over 1000 characters", async () => {
    const { token } = await signIn("a@example.com");
    for (const bad of ["spotify:track:abc", "local:x", "", LOCAL + "x".repeat(1000)]) {
      const record = makeReleaseRecord();
      (record.tracks[0] as { localId?: string }).localId = bad;
      expect((await put(token, record, record.id)).status).toBe(400);
    }
  });

  it("platform 'cloud' is still refused as a client's origin and sign-in platform", async () => {
    const { token } = await signIn("a@example.com");
    const record = makeReleaseRecord({ origin: "cloud" as unknown as "mac" });
    expect((await put(token, record, record.id)).status).toBe(400);
    const code = await testServices.auth.issueCode("b@example.com");
    const res = await authVerifyRoute.POST(
      json("http://localhost/v1/auth/verify", "POST", { email: "b@example.com", code, deviceName: "X", platform: "cloud" })
    );
    expect(res.status).toBe(400);
  });
});
