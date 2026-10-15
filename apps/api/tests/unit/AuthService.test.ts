import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, migrateDb, type Db } from "../../src/db/client";
import { devices } from "../../src/db/schema";
import { AuthService, TOKEN_IDLE_TTL_MS, LAST_SEEN_REFRESH_MS } from "../../src/server/auth/AuthService";
import { UnauthorizedError, NotFoundError } from "../../src/shared/errors";
import { FakeMailer } from "../support/testServices";

async function freshDb(): Promise<Db> {
  const db = createDb(":memory:");
  await migrateDb(db);
  return db;
}

describe("AuthService", () => {
  let db: Db;
  let mailer: FakeMailer;
  let clock: number;
  let auth: AuthService;

  beforeEach(async () => {
    db = await freshDb();
    mailer = new FakeMailer();
    clock = Date.UTC(2026, 0, 1);
    auth = new AuthService(db, mailer, "test-auth-pepper", "test-token-pepper", () => clock);
  });

  it("round-trips a code: issue, verify, and get a device token", async () => {
    const code = await auth.issueCode("person@example.com");
    expect(code).toMatch(/^\d{6}$/);
    await auth.sendCode("person@example.com", code);
    expect(mailer.codeFor("person@example.com")).toBe(code);

    const result = await auth.verify({
      email: "person@example.com",
      code,
      deviceName: "Toby's MacBook",
      platform: "mac",
    });

    expect(result.user.email).toBe("person@example.com");
    expect(result.device.name).toBe("Toby's MacBook");
    expect(result.token.length).toBeGreaterThan(20);

    const authed = await auth.authenticate(result.token);
    expect(authed.user.id).toBe(result.user.id);
    expect(authed.device.id).toBe(result.device.id);
  });

  it("creates the same user on a second sign-in from a different device", async () => {
    const firstCode = await auth.issueCode("person@example.com");
    const first = await auth.verify({
      email: "person@example.com",
      code: firstCode,
      deviceName: "Mac",
      platform: "mac",
    });

    const secondCode = await auth.issueCode("person@example.com");
    const second = await auth.verify({
      email: "person@example.com",
      code: secondCode,
      deviceName: "iPhone",
      platform: "ios",
    });

    expect(second.user.id).toBe(first.user.id);
    expect(second.device.id).not.toBe(first.device.id);
  });

  it("counts wrong-code attempts and locks out after 5", async () => {
    const rightCode = await auth.issueCode("person@example.com");

    for (let i = 0; i < 5; i++) {
      await expect(
        auth.verify({ email: "person@example.com", code: "000000", deviceName: "Mac", platform: "mac" })
      ).rejects.toThrow(UnauthorizedError);
    }

    // The 6th attempt is blocked by the attempt cap, even with the right code.
    await expect(
      auth.verify({ email: "person@example.com", code: rightCode, deviceName: "Mac", platform: "mac" })
    ).rejects.toThrow(/too many attempts/i);
  });

  it("rejects an expired code", async () => {
    const code = await auth.issueCode("person@example.com");

    clock += 11 * 60 * 1000; // past the 10-minute expiry

    await expect(
      auth.verify({ email: "person@example.com", code, deviceName: "Mac", platform: "mac" })
    ).rejects.toThrow(/expired/i);
  });

  it("invalidates a previous code when a new one is issued", async () => {
    const staleCode = await auth.issueCode("person@example.com");

    await auth.issueCode("person@example.com");

    await expect(
      auth.verify({ email: "person@example.com", code: staleCode, deviceName: "Mac", platform: "mac" })
    ).rejects.toThrow(UnauthorizedError);
  });

  it("rejects authenticate() for a revoked device", async () => {
    const code = await auth.issueCode("person@example.com");
    const { token, user, device } = await auth.verify({
      email: "person@example.com",
      code,
      deviceName: "Mac",
      platform: "mac",
    });

    await auth.revokeDevice(user.id, device.id);

    await expect(auth.authenticate(token)).rejects.toThrow(UnauthorizedError);
  });

  it("rejects authenticate() for a garbage token", async () => {
    await expect(auth.authenticate("not-a-real-token")).rejects.toThrow(UnauthorizedError);
  });

  it("does not let one user revoke another user's device", async () => {
    const aCode = await auth.issueCode("a@example.com");
    const a = await auth.verify({
      email: "a@example.com",
      code: aCode,
      deviceName: "A's Mac",
      platform: "mac",
    });

    const bCode = await auth.issueCode("b@example.com");
    const b = await auth.verify({
      email: "b@example.com",
      code: bCode,
      deviceName: "B's Mac",
      platform: "mac",
    });

    await expect(auth.revokeDevice(b.user.id, a.device.id)).rejects.toThrow(NotFoundError);
    // A's device still works.
    await expect(auth.authenticate(a.token)).resolves.toMatchObject({ user: { id: a.user.id } });
  });

  describe("token idle expiry", () => {
    it("still authenticates one day short of TOKEN_IDLE_TTL_MS", async () => {
      const code = await auth.issueCode("idle@example.com");
      const { token } = await auth.verify({
        email: "idle@example.com",
        code,
        deviceName: "Mac",
        platform: "mac",
      });

      clock += TOKEN_IDLE_TTL_MS - 24 * 60 * 60 * 1000;
      await expect(auth.authenticate(token)).resolves.toBeDefined();
    });

    it("rejects a token idle for more than TOKEN_IDLE_TTL_MS", async () => {
      const start = clock;
      const code = await auth.issueCode("idle2@example.com");
      const { token } = await auth.verify({
        email: "idle2@example.com",
        code,
        deviceName: "Mac",
        platform: "mac",
      });

      clock = start + TOKEN_IDLE_TTL_MS + 1;
      await expect(auth.authenticate(token)).rejects.toThrow(UnauthorizedError);
    });

    it("keeps working when used regularly, sliding the idle window forward", async () => {
      const code = await auth.issueCode("active@example.com");
      const { token } = await auth.verify({
        email: "active@example.com",
        code,
        deviceName: "Mac",
        platform: "mac",
      });

      // Used every 60 days for over 700 days total; each use refreshes
      // lastSeenAt, so the token never sits idle long enough to expire even
      // though the total elapsed time far exceeds TOKEN_IDLE_TTL_MS.
      for (let day = 60; day <= 720; day += 60) {
        clock = Date.UTC(2026, 0, 1) + day * 24 * 60 * 60 * 1000;
        await expect(auth.authenticate(token)).resolves.toBeDefined();
      }
    });
  });

  describe("signing back in (#175)", () => {
    const EMAIL = "person@example.com";

    async function signIn(email: string, deviceName: string, platform: "mac" | "ios") {
      const code = await auth.issueCode(email);
      return auth.verify({ email, code, deviceName, platform });
    }

    async function deviceRow(id: string) {
      const [row] = await db.select().from(devices).where(eq(devices.id, id));
      return row!;
    }

    it("gives a Mac that signed out and back in its old device id, kills the old token and keeps one row", async () => {
      const first = await signIn(EMAIL, "Toby's MacBook", "mac");
      const before = await deviceRow(first.device.id);
      await auth.revokeDevice(first.user.id, first.device.id);
      await expect(auth.authenticate(first.token)).rejects.toThrow(UnauthorizedError);

      clock += 3 * 60 * 60 * 1000;
      const second = await signIn(EMAIL, "Toby's MacBook", "mac");

      expect(second.device.id).toBe(first.device.id);
      expect(second.token).not.toBe(first.token);
      // The old token's hash was replaced, so it is dead; the new one works.
      await expect(auth.authenticate(first.token)).rejects.toThrow(UnauthorizedError);
      await expect(auth.authenticate(second.token)).resolves.toMatchObject({
        user: { id: first.user.id },
        device: { id: first.device.id, name: "Toby's MacBook", platform: "mac" },
      });

      const after = await deviceRow(first.device.id);
      expect(after.revokedAt).toBeNull();
      expect(after.tokenHash).not.toBe(before.tokenHash);
      expect(after.lastSeenAt).toBe(clock);
      expect(after.createdAt).toBe(before.createdAt);
      const listed = await auth.listDevices(first.user.id);
      expect(listed.devices).toHaveLength(1);
      expect(listed.devices[0]).toMatchObject({ id: first.device.id, revoked: false });
    });

    it("keeps every earlier token dead across repeated sign-outs and sign-ins", async () => {
      const first = await signIn(EMAIL, "Mac", "mac");
      await auth.revokeDevice(first.user.id, first.device.id);
      const second = await signIn(EMAIL, "Mac", "mac");
      await auth.revokeDevice(second.user.id, second.device.id);
      const third = await signIn(EMAIL, "Mac", "mac");

      expect(third.device.id).toBe(first.device.id);
      await expect(auth.authenticate(first.token)).rejects.toThrow(UnauthorizedError);
      await expect(auth.authenticate(second.token)).rejects.toThrow(UnauthorizedError);
      await expect(auth.authenticate(third.token)).resolves.toBeDefined();
    });

    it("creates a new device for an iPhone that signs out and back in, as before", async () => {
      const first = await signIn(EMAIL, "iPhone 14", "ios");
      await auth.revokeDevice(first.user.id, first.device.id);

      const second = await signIn(EMAIL, "iPhone 14", "ios");

      expect(second.device.id).not.toBe(first.device.id);
      await expect(auth.authenticate(first.token)).rejects.toThrow(UnauthorizedError);
      await expect(auth.authenticate(second.token)).resolves.toBeDefined();
      expect((await deviceRow(first.device.id)).revokedAt).not.toBeNull();
      expect((await auth.listDevices(first.user.id)).devices).toHaveLength(2);
    });

    it("does not revive a revoked Mac for a differently named Mac, or a revoked iPhone for a Mac of the same name", async () => {
      const oldMac = await signIn(EMAIL, "Old Mac", "mac");
      await auth.revokeDevice(oldMac.user.id, oldMac.device.id);
      const phone = await signIn(EMAIL, "Shared Name", "ios");
      await auth.revokeDevice(phone.user.id, phone.device.id);

      const newMac = await signIn(EMAIL, "New Mac", "mac");
      const sameNameMac = await signIn(EMAIL, "Shared Name", "mac");

      expect(newMac.device.id).not.toBe(oldMac.device.id);
      expect(sameNameMac.device.id).not.toBe(phone.device.id);
      expect((await deviceRow(oldMac.device.id)).revokedAt).not.toBeNull();
      expect((await deviceRow(phone.device.id)).revokedAt).not.toBeNull();
    });

    it("lets two active Macs share a name with separate ids and never revives an active one", async () => {
      const a = await signIn(EMAIL, "MacBook Pro", "mac");
      const b = await signIn(EMAIL, "MacBook Pro", "mac");
      const c = await signIn(EMAIL, "MacBook Pro", "mac");

      expect(new Set([a.device.id, b.device.id, c.device.id]).size).toBe(3);
      // Signing in again did not replace anyone's token.
      for (const signedIn of [a, b, c]) {
        await expect(auth.authenticate(signedIn.token)).resolves.toMatchObject({
          device: { id: signedIn.device.id },
        });
      }
      expect((await auth.listDevices(a.user.id)).devices).toHaveLength(3);
    });

    it("revives only one device per sign-in: a second sign-in while the revived Mac is active adds a new one", async () => {
      const first = await signIn(EMAIL, "Mac", "mac");
      await auth.revokeDevice(first.user.id, first.device.id);
      const revived = await signIn(EMAIL, "Mac", "mac");
      const another = await signIn(EMAIL, "Mac", "mac");

      expect(revived.device.id).toBe(first.device.id);
      expect(another.device.id).not.toBe(first.device.id);
      await expect(auth.authenticate(revived.token)).resolves.toBeDefined();
      await expect(auth.authenticate(another.token)).resolves.toBeDefined();
    });

    it("revives the most recently seen of several revoked same-name Macs", async () => {
      const a = await signIn(EMAIL, "Mac", "mac");
      clock += 1000;
      const b = await signIn(EMAIL, "Mac", "mac");
      clock += 1000;
      const c = await signIn(EMAIL, "Mac", "mac");
      // `a` is the oldest device but the last one used: it is the most recently seen.
      clock += 2 * LAST_SEEN_REFRESH_MS;
      await auth.authenticate(a.token);
      for (const d of [a, b, c]) await auth.revokeDevice(d.user.id, d.device.id);

      clock += 1000;
      const back = await signIn(EMAIL, "Mac", "mac");

      expect(back.device.id).toBe(a.device.id);
      expect((await deviceRow(b.device.id)).revokedAt).not.toBeNull();
      expect((await deviceRow(c.device.id)).revokedAt).not.toBeNull();
    });

    it("never revives another user's revoked Mac, even with the same device name", async () => {
      const alice = await signIn("alice@example.com", "Mac", "mac");
      await auth.revokeDevice(alice.user.id, alice.device.id);
      const aliceBefore = await deviceRow(alice.device.id);

      const bob = await signIn("bob@example.com", "Mac", "mac");

      expect(bob.user.id).not.toBe(alice.user.id);
      expect(bob.device.id).not.toBe(alice.device.id);
      const aliceAfter = await deviceRow(alice.device.id);
      expect(aliceAfter).toEqual(aliceBefore);
      expect(aliceAfter.revokedAt).not.toBeNull();
      await expect(auth.authenticate(alice.token)).rejects.toThrow(UnauthorizedError);
      await expect(auth.authenticate(bob.token)).resolves.toMatchObject({ user: { id: bob.user.id } });
    });

    // Atomicity: the code is claimed with a conditional UPDATE (one changes the row, the other
    // changes none), and the revive is a single UPDATE ... RETURNING whose WHERE repeats
    // "revoked". So two verifies racing on one code leave exactly one live device, never two.
    it("lets only one of two parallel verifies of the same code through, leaving one live device", async () => {
      const first = await signIn(EMAIL, "Mac", "mac");
      await auth.revokeDevice(first.user.id, first.device.id);

      const code = await auth.issueCode(EMAIL);
      const input = { email: EMAIL, code, deviceName: "Mac", platform: "mac" as const };
      const results = await Promise.allSettled([auth.verify(input), auth.verify(input)]);

      const ok = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected");
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(UnauthorizedError);

      const rows = await db.select().from(devices).where(eq(devices.userId, first.user.id));
      expect(rows).toHaveLength(1);
      expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(1);
      expect(rows[0]!.id).toBe(first.device.id);
    });

    it("also inserts exactly one device when two parallel verifies of the same code find nothing to revive", async () => {
      // The account already exists, so the race is on the code and the device row alone.
      const phone = await signIn(EMAIL, "iPhone", "ios");
      const code = await auth.issueCode(EMAIL);
      const input = { email: EMAIL, code, deviceName: "Mac", platform: "mac" as const };
      const results = await Promise.allSettled([auth.verify(input), auth.verify(input)]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rows = await db.select().from(devices).where(eq(devices.userId, phone.user.id));
      expect(rows.map((r) => r.platform).sort()).toEqual(["ios", "mac"]);
    });
  });

  describe("lastSeenAt refresh throttling", () => {
    it("does not rewrite lastSeenAt within LAST_SEEN_REFRESH_MS, but does after", async () => {
      const code = await auth.issueCode("refresh@example.com");
      const { token, user } = await auth.verify({
        email: "refresh@example.com",
        code,
        deviceName: "Mac",
        platform: "mac",
      });

      const [initial] = (await auth.listDevices(user.id)).devices;
      const initialLastSeen = initial!.lastSeenAt;

      // Authenticate again an hour later: well under the refresh interval.
      clock += 60 * 60 * 1000;
      await auth.authenticate(token);
      const [afterHour] = (await auth.listDevices(user.id)).devices;
      expect(afterHour!.lastSeenAt).toBe(initialLastSeen);

      // Push past a full day since the original lastSeenAt: now it updates.
      clock = Date.UTC(2026, 0, 1) + LAST_SEEN_REFRESH_MS + 1;
      await auth.authenticate(token);
      const [afterDay] = (await auth.listDevices(user.id)).devices;
      expect(afterDay!.lastSeenAt).not.toBe(initialLastSeen);
      expect(new Date(afterDay!.lastSeenAt).getTime()).toBe(clock);
    });
  });
});
