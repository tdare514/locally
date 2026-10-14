import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { playCounts } from "../../src/db/schema";
import { makeReleaseRecord } from "../support/fixtures";
import { createTestServices, type TestServices } from "../support/testServices";

interface Account {
  userId: string;
  deviceId: string;
}

describe("PlaysService", () => {
  let services: TestServices;
  let alice: Account;
  let aliceIos: Account;
  let bob: Account;
  let releaseId: string;
  const trackA = crypto.randomUUID();
  const trackB = crypto.randomUUID();

  async function signIn(email: string, deviceName: string, platform: "mac" | "ios"): Promise<Account> {
    const code = await services.auth.issueCode(email);
    const res = await services.auth.verify({ email, code, deviceName, platform });
    return { userId: res.user.id, deviceId: res.device.id };
  }

  async function storedCount(deviceId: string, trackId: string): Promise<number | undefined> {
    const [row] = await services.db.select().from(playCounts).where(eq(playCounts.deviceId, deviceId));
    return row && row.trackId === trackId ? row.count : undefined;
  }

  beforeEach(async () => {
    services = await createTestServices();
    alice = await signIn("alice@example.com", "Alice Mac", "mac");
    aliceIos = await signIn("alice@example.com", "Alice iPhone", "ios");
    bob = await signIn("bob@example.com", "Bob Mac", "mac");
    const record = makeReleaseRecord();
    releaseId = record.id;
    await services.releases.upsert(alice.userId, releaseId, record);
  });

  it("keeps the larger count: push 5 then 3 stays 5, push 3 then 5 becomes 5", async () => {
    await services.plays.push(alice.userId, alice.deviceId, [{ releaseId, trackId: trackA, count: 5 }]);
    await services.plays.push(alice.userId, alice.deviceId, [{ releaseId, trackId: trackA, count: 3 }]);
    expect(await storedCount(alice.deviceId, trackA)).toBe(5);

    await services.plays.push(alice.userId, aliceIos.deviceId, [{ releaseId, trackId: trackB, count: 3 }]);
    await services.plays.push(alice.userId, aliceIos.deviceId, [{ releaseId, trackId: trackB, count: 5 }]);
    expect(await storedCount(aliceIos.deviceId, trackB)).toBe(5);
  });

  it("is idempotent when the same batch is pushed again", async () => {
    const counts = [
      { releaseId, trackId: trackA, count: 7 },
      { releaseId, trackId: trackB, count: 2 },
    ];
    expect(await services.plays.push(alice.userId, alice.deviceId, counts)).toEqual({ accepted: 2, ignored: 0 });
    expect(await services.plays.push(alice.userId, alice.deviceId, counts)).toEqual({ accepted: 2, ignored: 0 });
    const rows = await services.db.select().from(playCounts);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.count).sort()).toEqual([2, 7]);
  });

  it("ignores foreign, tombstoned and unknown releases and applies the rest", async () => {
    const foreign = makeReleaseRecord();
    await services.releases.upsert(bob.userId, foreign.id, foreign);
    const gone = makeReleaseRecord();
    await services.releases.upsert(alice.userId, gone.id, gone);
    await services.releases.tombstone(alice.userId, gone.id);

    const result = await services.plays.push(alice.userId, alice.deviceId, [
      { releaseId: foreign.id, trackId: crypto.randomUUID(), count: 1 },
      { releaseId: gone.id, trackId: crypto.randomUUID(), count: 1 },
      { releaseId: crypto.randomUUID(), trackId: crypto.randomUUID(), count: 1 },
      { releaseId, trackId: trackA, count: 9 },
    ]);

    expect(result).toEqual({ accepted: 1, ignored: 3 });
    const rows = await services.db.select().from(playCounts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: alice.userId, deviceId: alice.deviceId, releaseId, trackId: trackA, count: 9 });
  });

  it("returns per-track totals and devices, flags the requesting device, and lists revoked devices", async () => {
    await services.plays.push(alice.userId, alice.deviceId, [
      { releaseId, trackId: trackA, count: 4 },
      { releaseId, trackId: trackB, count: 1 },
    ]);
    await services.plays.push(alice.userId, aliceIos.deviceId, [{ releaseId, trackId: trackA, count: 6 }]);
    await services.auth.revokeDevice(alice.userId, aliceIos.deviceId);

    const result = await services.plays.forRelease(alice.userId, releaseId, alice.deviceId);
    const expectedTracks = [trackA, trackB].sort();
    expect(result!.tracks.map((t) => t.trackId)).toEqual(expectedTracks);

    const a = result!.tracks.find((t) => t.trackId === trackA)!;
    expect(a.total).toBe(10);
    expect(a.devices).toEqual([
      { deviceId: alice.deviceId, name: "Alice Mac", platform: "mac", count: 4, current: true },
      { deviceId: aliceIos.deviceId, name: "Alice iPhone", platform: "ios", count: 6, current: false },
    ]);
    const b = result!.tracks.find((t) => t.trackId === trackB)!;
    expect(b.total).toBe(1);
    expect(b.devices).toHaveLength(1);
  });

  it("returns an empty track list for a release with no plays", async () => {
    expect(await services.plays.forRelease(alice.userId, releaseId, alice.deviceId)).toEqual({ tracks: [] });
  });

  it("returns null for a tombstoned, foreign or unknown release", async () => {
    await services.plays.push(alice.userId, alice.deviceId, [{ releaseId, trackId: trackA, count: 1 }]);
    expect(await services.plays.forRelease(bob.userId, releaseId, bob.deviceId)).toBeNull();
    expect(await services.plays.forRelease(alice.userId, crypto.randomUUID(), alice.deviceId)).toBeNull();
    await services.releases.tombstone(alice.userId, releaseId);
    expect(await services.plays.forRelease(alice.userId, releaseId, alice.deviceId)).toBeNull();
  });

  it("never lets another user overwrite a device's row", async () => {
    await services.plays.push(alice.userId, alice.deviceId, [{ releaseId, trackId: trackA, count: 2 }]);
    const bobRelease = makeReleaseRecord();
    await services.releases.upsert(bob.userId, bobRelease.id, bobRelease);
    // Bob names Alice's device id (the route never allows it; the service must still not hijack the row).
    await services.plays.push(bob.userId, alice.deviceId, [{ releaseId: bobRelease.id, trackId: trackA, count: 50 }]);
    const rows = await services.db.select().from(playCounts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: alice.userId, releaseId, count: 2 });
  });
});
