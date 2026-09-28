import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { authCodes, devices, files, pendingDeletes, releases, userCounters, users } from "../../src/db/schema";
import { UnauthorizedError, ValidationError } from "../../src/shared/errors";
import { makeReleaseRecord } from "../support/fixtures";
import { createTestServices, type TestServices } from "../support/testServices";

interface Account {
  userId: string;
  email: string;
  tokens: string[];
  deviceIds: string[];
  releaseIds: string[];
}

describe("AccountService", () => {
  let services: TestServices;
  let a: Account;
  let b: Account;

  beforeEach(async () => {
    services = await createTestServices();

    async function seedAccount(email: string): Promise<Account> {
      // Two devices, one of them revoked.
      const firstCode = await services.auth.issueCode(email);
      const first = await services.auth.verify({
        email,
        code: firstCode,
        deviceName: "Device 1",
        platform: "mac",
      });
      const secondCode = await services.auth.issueCode(email);
      const second = await services.auth.verify({
        email,
        code: secondCode,
        deviceName: "Device 2",
        platform: "ios",
      });
      await services.auth.revokeDevice(first.user.id, second.device.id);

      // Three releases, one tombstoned, each with a file whose blob exists
      // in the temp LocalFileStore.
      const releaseIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const record = makeReleaseRecord({
          cover: null,
          tracks: [
            {
              id: crypto.randomUUID(),
              title: `Track ${i}`,
              trackNumber: 1,
              file: `${i}.mp3`,
              bytes: 1024,
              durationSec: 30,
            },
          ],
        });
        await services.releases.upsert(first.user.id, record.id, record);
        await services.files.createUploads(first.user.id, record.id, [
          { name: `${i}.mp3`, bytes: 1024, contentType: "audio/mpeg" },
        ]);
        releaseIds.push(record.id);
      }
      await services.releases.tombstone(first.user.id, releaseIds[0]!);

      // An open (unconsumed) auth code for this email.
      await services.auth.issueCode(email);

      return {
        userId: first.user.id,
        email,
        tokens: [first.token, second.token],
        deviceIds: [first.device.id, second.device.id],
        releaseIds,
      };
    }

    a = await seedAccount("account-a@example.com");
    b = await seedAccount("account-b@example.com");
  });

  it("removes every row for the account and queues exactly its storage keys, leaving the other account untouched", async () => {
    const result = await services.account.deleteAccount(a.userId, a.email);

    expect(result.deletedDevices).toBe(2);
    expect(result.deletedReleases).toBe(3);
    expect(result.deletedFiles).toBe(3);
    expect(result.queuedKeys.sort()).toEqual(
      a.releaseIds.map((releaseId, i) => `users/${a.userId}/releases/${releaseId}/${i}.mp3`).sort()
    );

    const remainingUsers = await services.db.select().from(users);
    expect(remainingUsers.map((u) => u.id)).not.toContain(a.userId);
    expect(remainingUsers.map((u) => u.id)).toContain(b.userId);

    const remainingDevices = await services.db.select().from(devices);
    expect(remainingDevices.every((d) => d.userId !== a.userId)).toBe(true);
    expect(remainingDevices.filter((d) => d.userId === b.userId)).toHaveLength(2);

    const remainingCounters = await services.db.select().from(userCounters);
    expect(remainingCounters.map((c) => c.userId)).not.toContain(a.userId);
    expect(remainingCounters.map((c) => c.userId)).toContain(b.userId);

    const remainingReleases = await services.db.select().from(releases);
    expect(remainingReleases.every((r) => r.userId !== a.userId)).toBe(true);
    expect(remainingReleases.filter((r) => r.userId === b.userId)).toHaveLength(3);

    const remainingFiles = await services.db.select().from(files);
    expect(remainingFiles.every((f) => f.userId !== a.userId)).toBe(true);
    expect(remainingFiles.filter((f) => f.userId === b.userId)).toHaveLength(3);

    const remainingAuthCodes = await services.db.select().from(authCodes);
    expect(remainingAuthCodes.map((c) => c.email)).not.toContain(a.email);
    expect(remainingAuthCodes.map((c) => c.email)).toContain(b.email);

    const queued = await services.db.select().from(pendingDeletes);
    expect(queued.map((q) => q.storageKey).sort()).toEqual(result.queuedKeys.sort());
    for (const key of queued.map((q) => q.storageKey)) {
      expect(key.startsWith(`users/${a.userId}/`)).toBe(true);
    }
  });

  it("rejects a mismatched email with ValidationError and deletes nothing (case/whitespace still matches)", async () => {
    await expect(services.account.deleteAccount(a.userId, "someone-else@example.com")).rejects.toThrow(ValidationError);
    await expect(services.account.deleteAccount(a.userId, b.email)).rejects.toThrow(ValidationError);

    // A different case with extra surrounding whitespace is still a match.
    const result = await services.account.deleteAccount(a.userId, `  ${a.email.toUpperCase()}  `);
    expect(result.deletedDevices).toBe(2);
  });

  it("full row counts are unchanged after a rejected delete", async () => {
    const before = {
      users: (await services.db.select().from(users)).length,
      devices: (await services.db.select().from(devices)).length,
      releases: (await services.db.select().from(releases)).length,
      files: (await services.db.select().from(files)).length,
      authCodes: (await services.db.select().from(authCodes)).length,
    };

    await expect(services.account.deleteAccount(a.userId, "nope@example.com")).rejects.toThrow(ValidationError);

    expect(await services.db.select().from(users)).toHaveLength(before.users);
    expect(await services.db.select().from(devices)).toHaveLength(before.devices);
    expect(await services.db.select().from(releases)).toHaveLength(before.releases);
    expect(await services.db.select().from(files)).toHaveLength(before.files);
    expect(await services.db.select().from(authCodes)).toHaveLength(before.authCodes);
  });

  it("invalidates every one of the account's tokens", async () => {
    await services.account.deleteAccount(a.userId, a.email);

    for (const token of a.tokens) {
      await expect(services.auth.authenticate(token)).rejects.toThrow(UnauthorizedError);
    }
    // B's tokens are unaffected.
    await expect(services.auth.authenticate(b.tokens[0]!)).resolves.toBeDefined();
  });

  it("a re-sign-in with the same email creates a fresh, empty account", async () => {
    await services.account.deleteAccount(a.userId, a.email);

    const code = await services.auth.issueCode(a.email);
    const resignedIn = await services.auth.verify({
      email: a.email,
      code,
      deviceName: "New Device",
      platform: "mac",
    });

    expect(resignedIn.user.id).not.toBe(a.userId);
    const listed = await services.releases.listSince(resignedIn.user.id, 0);
    expect(listed.releases).toHaveLength(0);
    expect(await services.quota.usedBytes(resignedIn.user.id)).toBe(0);
  });
});
