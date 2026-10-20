import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { devices, playCounts, playDays, samplerLease, spotifyLinks } from "../../src/db/schema";
import type { ReleaseRecord } from "../../src/shared/types";
import { makeReleaseRecord } from "../support/fixtures";
import {
  getLink,
  idle,
  insertLink,
  makeSamplerKit,
  playing,
  PLAYER_URL,
  TOKEN_URL,
  type SamplerKit,
} from "../support/fakeSpotify";
import { createTestServices, type TestServices } from "../support/testServices";

const T0 = Date.UTC(2026, 2, 10, 12, 0, 0); // 10 Mar 2026, noon UTC
const URI_A = "spotify:local:Chromatics:Night+Drive:Night+Drive:61";
const URI_B = "spotify:local:Chromatics:Other+Album:Second:100";

let services: TestServices;
let kit: SamplerKit;
let userId: string;
let release: ReleaseRecord;

async function newUser(email: string): Promise<string> {
  const code = await services.auth.issueCode(email);
  return (await services.auth.verify({ email, code, deviceName: "D", platform: "mac" })).user.id;
}

async function addRelease(uid: string, over: Partial<ReleaseRecord>): Promise<ReleaseRecord> {
  const record = makeReleaseRecord(over);
  await services.releases.upsert(uid, record.id, record);
  return record;
}

beforeEach(async () => {
  services = await createTestServices();
  kit = makeSamplerKit(services.db, T0);
  userId = await newUser("a@example.com");
  release = await addRelease(userId, {}); // "Night Drive" by Chromatics, one track, 61.2 s
  await insertLink(services.db, kit.cipher, userId, T0);
});

async function tick(ms = 60_000) {
  kit.clock.now += ms;
  return kit.sampler.run();
}

describe("SpotifySampler counting", () => {
  it("counts a matched track once, under a cloud device, and returns counts only", async () => {
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 40_000, 61_200));
    const first = await kit.sampler.run();
    expect(first).toEqual({ sampled: 1, counted: 1, skipped: false, nextInMs: 10_000 });
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 100_000, 61_200));
    kit.clock.now += 51_000; // lease passed; the same session
    const second = await kit.sampler.run();
    expect(second).toEqual({ sampled: 1, counted: 0, skipped: false, nextInMs: 10_000 });

    const link = await getLink(services.db, userId);
    const [cloud] = await services.db.select().from(devices).where(eq(devices.platform, "cloud"));
    expect(cloud).toMatchObject({ userId, name: "Spotify (online)", platform: "cloud" });
    expect(link.cloudDeviceId).toBe(cloud!.id);
    const counts = await services.db.select().from(playCounts);
    expect(counts).toHaveLength(1);
    expect(counts[0]).toMatchObject({ userId, deviceId: cloud!.id, releaseId: release.id, trackId: release.tracks[0]!.id, count: 1 });
    expect(link.lastSampleAt).toBe(kit.clock.now);
    expect(link.sessionUri).toBe(URI_A);
    expect(link.sessionCounted).toBe(true);
  });

  it("buckets days in the user's zone across local midnight (America/Toronto)", async () => {
    await services.db.update(spotifyLinks).set({ timeZone: "America/Toronto" }).where(eq(spotifyLinks.userId, userId));
    const second = await addRelease(userId, {
      title: "Other Album",
      tracks: [{ id: crypto.randomUUID(), title: "Second", trackNumber: 1, file: "01.mp3", bytes: 10, durationSec: 100 }],
    });
    // 03:30 UTC on 10 Mar is 23:30 on 9 Mar in Toronto (EDT); 04:30 UTC is 00:30 on 10 Mar.
    kit.clock.now = Date.UTC(2026, 2, 10, 3, 30);
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 40_000, 61_200));
    expect((await kit.sampler.run()).counted).toBe(1);
    kit.clock.now = Date.UTC(2026, 2, 10, 4, 30);
    kit.spotify.answer(PLAYER_URL, playing(URI_B, 40_000, 100_000));
    expect((await kit.sampler.run()).counted).toBe(1);

    const days = await services.db.select().from(playDays);
    const byTrack = Object.fromEntries(days.map((d) => [d.trackId, d.day]));
    expect(byTrack[release.tracks[0]!.id]).toBe("2026-03-09");
    expect(byTrack[second.tracks[0]!.id]).toBe("2026-03-10");
    expect(days.every((d) => d.count === 1)).toBe(true);
  });

  it("adds to an existing count and day row on a later play", async () => {
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 40_000, 61_200));
    await kit.sampler.run();
    await tick();
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 2_000, 61_200)); // restarted
    await tick();
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 40_000, 61_200));
    await tick();
    const [count] = await services.db.select().from(playCounts);
    const [day] = await services.db.select().from(playDays);
    expect(count!.count).toBe(2);
    expect(day!.count).toBe(2);
  });

  it("clears the session for an unmatched local item, a podcast-like null item and a non-local track", async () => {
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 40_000, 61_200));
    await kit.sampler.run();
    expect((await getLink(services.db, userId)).sessionUri).toBe(URI_A);
    kit.spotify.answer(PLAYER_URL, playing("spotify:local:Nobody:None:Nope:100", 40_000, 100_000));
    await tick();
    const link = await getLink(services.db, userId);
    expect([link.sessionUri, link.sessionReleaseId, link.sessionTrackId, link.sessionProgressMs, link.sessionAt]).toEqual([null, null, null, null, null]);
    kit.spotify.answer(PLAYER_URL, playing("spotify:track:abc", 40_000));
    await tick();
    expect((await getLink(services.db, userId)).sessionUri).toBeNull();
    expect(await services.db.select().from(playCounts)).toHaveLength(1);
  });

  it("keeps the session on idle (204) and still notes the sample", async () => {
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 10_000, 61_200));
    await kit.sampler.run();
    kit.spotify.answer(PLAYER_URL, idle);
    await tick();
    const link = await getLink(services.db, userId);
    expect(link.sessionUri).toBe(URI_A);
    expect(link.lastSampleAt).toBe(kit.clock.now);
  });

  it("resolves the library only when the uri changes", async () => {
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 10_000, 61_200));
    await kit.sampler.run();
    // Soft-delete the release: a same-uri sample must reuse the session's ids and not resolve again.
    await services.releases.upsert(userId, release.id, { ...release, deleted: true, updatedAt: new Date(Date.now() + 1000).toISOString() });
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 40_000, 61_200));
    await tick();
    // The count insert is guarded to a live release, so nothing is written for the deleted one.
    expect(await services.db.select().from(playCounts)).toHaveLength(0);
    expect((await getLink(services.db, userId)).sessionUri).toBe(URI_A);
  });

  it("never matches another user's release", async () => {
    const other = await newUser("b@example.com");
    await addRelease(other, {
      title: "Secret Album",
      artist: "Zed",
      tracks: [{ id: crypto.randomUUID(), title: "Secret Song", trackNumber: 1, file: "01.mp3", bytes: 10, durationSec: 100 }],
    });
    kit.spotify.answer(PLAYER_URL, playing("spotify:local:Zed:Secret+Album:Secret+Song:100", 60_000, 100_000));
    expect(await kit.sampler.run()).toEqual({ sampled: 1, counted: 0, skipped: false, nextInMs: 10_000 });
    expect(await services.db.select().from(playCounts)).toHaveLength(0);
  });
});

describe("SpotifySampler lease", () => {
  it("lets a run right after a finished run proceed (the lease is released at the end)", async () => {
    kit.spotify.answer(PLAYER_URL, idle);
    expect(await kit.sampler.run()).toEqual({ sampled: 1, counted: 0, skipped: false, nextInMs: 30_000 });
    kit.clock.now += 5_000;
    expect(await kit.sampler.run()).toEqual({ sampled: 1, counted: 0, skipped: false, nextInMs: 30_000 });
    const [lease] = await services.db.select().from(samplerLease);
    expect(lease!.until).toBe(kit.clock.now);
  });

  it("skips a run that overlaps one still in progress, and the lease expires after 50 s if a run crashed", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    kit.spotify.answer(PLAYER_URL, idle);
    kit.spotify.onCall = async () => {
      await gate;
    };
    const first = kit.sampler.run();
    await vi.waitFor(() => expect(kit.spotify.callsTo(PLAYER_URL)).toHaveLength(1));
    kit.clock.now += 10_000;
    expect(await kit.sampler.run()).toEqual({ sampled: 0, counted: 0, skipped: true, nextInMs: 10_000 });
    release();
    expect(await first).toEqual({ sampled: 1, counted: 0, skipped: false, nextInMs: 30_000 });

    // A crashed run never released: simulate it and check the expiry.
    await services.db.update(samplerLease).set({ until: kit.clock.now + 50_000 });
    kit.spotify.onCall = null;
    kit.clock.now += 49_000;
    expect((await kit.sampler.run()).skipped).toBe(true);
    kit.clock.now += 2_000;
    expect((await kit.sampler.run()).skipped).toBe(false);
  });

  it("writes nothing when its lease was taken by another run, and its release leaves the new lease alone", async () => {
    const BS_UNTIL = T0 + 10_000 + 50_000; // what a second run would have written
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 40_000, 61_200));
    kit.spotify.onCall = async () => {
      kit.clock.now += 10_000; // still inside A's lease, clear of the 5 s margin
      await services.db.update(samplerLease).set({ until: BS_UNTIL }); // B took over
    };
    expect(await kit.sampler.run()).toEqual({ sampled: 1, counted: 1, skipped: false, nextInMs: 10_000 });

    expect(await services.db.select().from(playCounts)).toHaveLength(0);
    expect(await services.db.select().from(playDays)).toHaveLength(0);
    const link = await getLink(services.db, userId);
    expect(link.sessionUri).toBeNull();
    expect(link.lastSampleAt).toBeNull();
    const [lease] = await services.db.select().from(samplerLease);
    expect(lease!.until).toBe(BS_UNTIL);
  });

  it("skips the user, writing nothing, once the clock is within 5 s of the lease expiry", async () => {
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 40_000, 61_200));
    kit.spotify.onCall = async () => {
      kit.clock.now += 46_000; // lease runs to T0 + 50 s; the cut-off is T0 + 45 s
    };
    expect(await kit.sampler.run()).toEqual({ sampled: 0, counted: 0, skipped: false, nextInMs: 30_000 });
    expect(await services.db.select().from(playCounts)).toHaveLength(0);
    const link = await getLink(services.db, userId);
    expect(link.sessionUri).toBeNull();
    expect(link.lastSampleAt).toBeNull();
  });
});

describe("SpotifyPlayerClient tokens", () => {
  it("refreshes under 60 s left and saves the rotated token before using the new access token", async () => {
    await services.db.update(spotifyLinks).set({ accessExpiresAt: T0 + 59_000 }).where(eq(spotifyLinks.userId, userId));
    kit.spotify.answer(TOKEN_URL, () => Response.json({ access_token: "ACCESS-1", refresh_token: "REFRESH-1", expires_in: 3600 }));
    kit.spotify.answer(PLAYER_URL, idle);
    let storedAtPlayerCall: { refresh: string; access: string } | null = null;
    kit.spotify.onCall = async (call) => {
      if (call.url !== PLAYER_URL) return;
      const { spotifyLinkAad } = await import("../../src/server/spotify/SpotifyLinkService");
      const row = await getLink(services.db, userId);
      const aad = spotifyLinkAad(userId);
      storedAtPlayerCall = { refresh: kit.cipher.decrypt(row.refreshTokenEnc, aad), access: kit.cipher.decrypt(row.accessTokenEnc, aad) };
    };
    await kit.sampler.run();

    const refreshCall = kit.spotify.callsTo(TOKEN_URL)[0]!;
    expect(Object.fromEntries(new URLSearchParams(refreshCall.body))).toEqual({
      grant_type: "refresh_token",
      refresh_token: "REFRESH-0",
      client_id: "client-123",
    });
    expect(storedAtPlayerCall).toEqual({ refresh: "REFRESH-1", access: "ACCESS-1" });
    expect(kit.spotify.callsTo(PLAYER_URL)[0]!.authorization).toBe("Bearer ACCESS-1");
    expect((await getLink(services.db, userId)).accessExpiresAt).toBe(T0 + 3_600_000);
  });

  it("does not refresh when the token has more than 60 s left", async () => {
    kit.spotify.answer(PLAYER_URL, idle);
    await kit.sampler.run();
    expect(kit.spotify.callsTo(TOKEN_URL)).toHaveLength(0);
    expect(kit.spotify.callsTo(PLAYER_URL)[0]!.authorization).toBe("Bearer ACCESS-0");
  });

  it("keeps the old refresh token when Spotify sends no new one", async () => {
    await services.db.update(spotifyLinks).set({ accessExpiresAt: T0 }).where(eq(spotifyLinks.userId, userId));
    kit.spotify.answer(TOKEN_URL, () => Response.json({ access_token: "ACCESS-1", expires_in: 3600 }));
    kit.spotify.answer(PLAYER_URL, idle);
    await kit.sampler.run();
    const { spotifyLinkAad } = await import("../../src/server/spotify/SpotifyLinkService");
    const row = await getLink(services.db, userId);
    expect(kit.cipher.decrypt(row.refreshTokenEnc, spotifyLinkAad(userId))).toBe("REFRESH-0");
  });

  it("refreshes once and retries on a 401", async () => {
    kit.spotify.answer(PLAYER_URL, () => new Response(null, { status: 401 }), idle);
    kit.spotify.answer(TOKEN_URL, () => Response.json({ access_token: "ACCESS-1", refresh_token: "REFRESH-1", expires_in: 3600 }));
    expect(await kit.sampler.run()).toEqual({ sampled: 1, counted: 0, skipped: false, nextInMs: 30_000 });
    expect(kit.spotify.callsTo(TOKEN_URL)).toHaveLength(1);
    expect(kit.spotify.callsTo(PLAYER_URL).map((c) => c.authorization)).toEqual(["Bearer ACCESS-0", "Bearer ACCESS-1"]);
  });

  it("skips the user, changing nothing, when a retry still gets a 401", async () => {
    kit.spotify.answer(PLAYER_URL, () => new Response(null, { status: 401 }));
    kit.spotify.answer(TOKEN_URL, () => Response.json({ access_token: "ACCESS-1", refresh_token: "REFRESH-1", expires_in: 3600 }));
    expect((await kit.sampler.run()).sampled).toBe(0);
    expect(kit.spotify.callsTo(PLAYER_URL)).toHaveLength(2);
    expect((await getLink(services.db, userId)).problem).toBeNull();
  });

  it("sets reconnect on invalid_grant and stops sampling that user", async () => {
    await services.db.update(spotifyLinks).set({ accessExpiresAt: T0 }).where(eq(spotifyLinks.userId, userId));
    kit.spotify.answer(TOKEN_URL, () => Response.json({ error: "invalid_grant" }, { status: 400 }));
    expect(await kit.sampler.run()).toEqual({ sampled: 0, counted: 0, skipped: false, nextInMs: 30_000 });
    expect((await getLink(services.db, userId)).problem).toBe("reconnect");
    expect(kit.spotify.callsTo(PLAYER_URL)).toHaveLength(0);
    await tick();
    expect(kit.spotify.calls).toHaveLength(1); // not tried again
  });

  it("skips and changes nothing on a refresh server error", async () => {
    await services.db.update(spotifyLinks).set({ accessExpiresAt: T0 }).where(eq(spotifyLinks.userId, userId));
    kit.spotify.answer(TOKEN_URL, () => new Response("oops", { status: 503 }));
    expect((await kit.sampler.run()).sampled).toBe(0);
    const row = await getLink(services.db, userId);
    expect(row.problem).toBeNull();
    expect(row.accessExpiresAt).toBe(T0);
  });
});

describe("SpotifyPlayerClient /me/player failures", () => {
  it("backs off on 429 for max(60 s, Retry-After), then clears it on the next success", async () => {
    kit.spotify.answer(PLAYER_URL, () => new Response(null, { status: 429, headers: { "retry-after": "300" } }));
    await kit.sampler.run();
    let row = await getLink(services.db, userId);
    expect(row).toMatchObject({ problem: "rateLimited", backoffUntil: T0 + 300_000 });

    kit.clock.now += 120_000; // inside the back-off: not called
    expect((await kit.sampler.run()).sampled).toBe(0);
    expect(kit.spotify.callsTo(PLAYER_URL)).toHaveLength(1);

    kit.spotify.answer(PLAYER_URL, idle);
    kit.clock.now = T0 + 301_000;
    expect((await kit.sampler.run()).sampled).toBe(1);
    row = await getLink(services.db, userId);
    expect(row.problem).toBeNull();
    expect(row.backoffUntil).toBeNull();
  });

  it("uses at least 60 s when Retry-After is small or missing", async () => {
    kit.spotify.answer(PLAYER_URL, () => new Response(null, { status: 429, headers: { "retry-after": "5" } }));
    await kit.sampler.run();
    expect((await getLink(services.db, userId)).backoffUntil).toBe(T0 + 60_000);
    kit.clock.now += 61_000;
    kit.spotify.answer(PLAYER_URL, () => new Response(null, { status: 429 }));
    await kit.sampler.run();
    expect((await getLink(services.db, userId)).backoffUntil).toBe(kit.clock.now + 60_000);
  });

  it("sets notOnTesterList on a 403 that mentions 'not registered', and stops sampling", async () => {
    kit.spotify.answer(PLAYER_URL, () => new Response('{"error":{"status":403,"message":"User not registered in the Developer Dashboard"}}', { status: 403 }));
    await kit.sampler.run();
    expect((await getLink(services.db, userId)).problem).toBe("notOnTesterList");
    await tick();
    expect(kit.spotify.callsTo(PLAYER_URL)).toHaveLength(1);
  });

  it("changes nothing on any other failure", async () => {
    for (const status of [403, 500, 502, 404]) {
      kit.spotify.answer(PLAYER_URL, () => new Response("nope", { status }));
      const before = await getLink(services.db, userId);
      expect(await tick()).toEqual({ sampled: 0, counted: 0, skipped: false, nextInMs: 30_000 });
      expect(await getLink(services.db, userId)).toEqual(before);
    }
    kit.spotify.answer(PLAYER_URL, () => {
      throw new Error("timeout");
    });
    const before = await getLink(services.db, userId);
    expect((await tick()).sampled).toBe(0);
    expect(await getLink(services.db, userId)).toEqual(before);
  });

  it("never logs a token, uri or title", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 40_000, 61_200));
    await kit.sampler.run();
    kit.spotify.answer(PLAYER_URL, () => new Response("x", { status: 500 }));
    await tick();
    const logged = spies.flatMap((s) => s.mock.calls.flat()).join("\n");
    expect(logged).not.toMatch(/ACCESS|REFRESH|spotify:local|Night Drive|never read/);
    spies.forEach((s) => s.mockRestore());
  });
});

describe("the cloud device", () => {
  async function countOnce() {
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 40_000, 61_200));
    kit.clock.now += 61_000;
    await kit.sampler.run();
  }

  it("can never authenticate, and is hidden from the device list, count and hasMore", async () => {
    await countOnce();
    const [cloud] = await services.db.select().from(devices).where(eq(devices.platform, "cloud"));
    expect(cloud).toBeDefined();
    for (const token of [cloud!.tokenHash, cloud!.id, "", "x".repeat(43)]) {
      await expect(services.auth.authenticate(token)).rejects.toThrow();
    }
    const list = await services.auth.listDevices(userId);
    expect(list.devices.map((d) => d.platform)).toEqual(["mac"]);
    expect(list.hasMore).toBe(false);
  });

  it("does not push real devices out of the 50 listed, nor count itself toward devicesHasMore", async () => {
    await countOnce();
    for (let i = 0; i < 49; i++) {
      await services.db.insert(devices).values({
        id: crypto.randomUUID(), userId, name: `P${i}`, platform: "ios", tokenHash: `h${i}`, createdAt: Date.now() + i, lastSeenAt: Date.now(), revokedAt: null, installId: null,
      });
    }
    const list = await services.auth.listDevices(userId);
    expect(list.devices).toHaveLength(50); // 49 phones + the Mac, no cloud row
    expect(list.hasMore).toBe(false);
  });

  it("is never revived by a Mac sign-in, by install id or by name", async () => {
    await countOnce();
    await services.db.update(devices).set({ revokedAt: 1, installId: "inst-1" }).where(eq(devices.platform, "cloud"));
    const code = await services.auth.issueCode("a@example.com");
    const res = await services.auth.verify({ email: "a@example.com", code, deviceName: "Spotify (online)", platform: "mac", installId: "inst-1" });
    const [cloud] = await services.db.select().from(devices).where(eq(devices.platform, "cloud"));
    expect(res.device.id).not.toBe(cloud!.id);
    expect(cloud!.revokedAt).toBe(1);
  });

  it("is reused after an unlink and re-link, so counts stay on one row", async () => {
    await countOnce();
    const [first] = await services.db.select().from(devices).where(eq(devices.platform, "cloud"));
    await services.db.delete(spotifyLinks).where(eq(spotifyLinks.userId, userId)); // unlink
    await insertLink(services.db, kit.cipher, userId, kit.clock.now); // re-link
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 2_000, 61_200));
    await tick();
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 40_000, 61_200));
    await tick();
    const clouds = await services.db.select().from(devices).where(eq(devices.platform, "cloud"));
    expect(clouds.map((d) => d.id)).toEqual([first!.id]);
    expect((await getLink(services.db, userId)).cloudDeviceId).toBe(first!.id);
    const [count] = await services.db.select().from(playCounts).where(eq(playCounts.deviceId, first!.id));
    expect(count!.count).toBe(2);
  });

  it("shows in the per-release plays under its name, and in the summary", async () => {
    await countOnce();
    const plays = await services.plays.forRelease(userId, release.id, "someone-else");
    expect(plays!.tracks[0]!.total).toBe(1);
    expect(plays!.tracks[0]!.devices).toEqual([
      expect.objectContaining({ name: "Spotify (online)", platform: "cloud", count: 1, current: false }),
    ]);
    const day = new Date(kit.clock.now).toISOString().slice(0, 10);
    const summary = await services.plays.summary(userId, "someone-else", day, day);
    expect(summary.tracks[0]!.plays).toBe(1);
  });

  it("bumps lastSeenAt at most daily", async () => {
    await countOnce();
    const read = async () => (await services.db.select().from(devices).where(eq(devices.platform, "cloud")))[0]!.lastSeenAt;
    const created = await read();
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 2_000, 61_200));
    await tick();
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 40_000, 61_200));
    await tick();
    expect(await read()).toBe(created); // second count an hour-ish later: untouched
    kit.clock.now += 25 * 3_600_000;
    await services.db.update(spotifyLinks).set({ accessExpiresAt: kit.clock.now + 3_600_000 }).where(eq(spotifyLinks.userId, userId));
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 2_000, 61_200));
    await tick();
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 40_000, 61_200));
    await tick();
    expect(await read()).toBe(kit.clock.now);
  });
});

describe("a user without a problem is sampled, one with reconnect is not", () => {
  it("samples several users concurrently", async () => {
    const b = await newUser("b@example.com");
    await insertLink(services.db, kit.cipher, b, T0);
    const c = await newUser("c@example.com");
    await insertLink(services.db, kit.cipher, c, T0, { problem: "reconnect" });
    kit.spotify.answer(PLAYER_URL, idle);
    expect(await kit.sampler.run()).toEqual({ sampled: 2, counted: 0, skipped: false, nextInMs: 30_000 });
    expect(kit.spotify.callsTo(PLAYER_URL)).toHaveLength(2);
  });
});

describe("nextInMs", () => {
  it("is 10 s while a local track plays", async () => {
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 5_000, 61_200));
    expect((await kit.sampler.run()).nextInMs).toBe(10_000);
  });

  it("is 10 s while a non-local track plays", async () => {
    kit.spotify.answer(PLAYER_URL, playing("spotify:track:4uLU6hMCjMI75M1A2tKUQC", 5_000, 200_000));
    expect((await kit.sampler.run()).nextInMs).toBe(10_000);
  });

  it("is 30 s when paused", async () => {
    kit.spotify.answer(PLAYER_URL, playing(URI_A, 5_000, 61_200, false));
    expect((await kit.sampler.run()).nextInMs).toBe(30_000);
  });

  it("is 30 s when idle", async () => {
    kit.spotify.answer(PLAYER_URL, idle);
    expect((await kit.sampler.run()).nextInMs).toBe(30_000);
  });

  it("is 30 s with no links", async () => {
    await services.db.delete(spotifyLinks);
    expect(await kit.sampler.run()).toEqual({ sampled: 0, counted: 0, skipped: false, nextInMs: 30_000 });
  });

  it("is 10 s on a skipped run", async () => {
    await services.db.insert(samplerLease).values({ id: "spotify-sampler", until: kit.clock.now + 30_000 });
    expect(await kit.sampler.run()).toEqual({ sampled: 0, counted: 0, skipped: true, nextInMs: 10_000 });
  });
});
