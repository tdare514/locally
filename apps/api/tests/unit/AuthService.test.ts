import { beforeEach, describe, expect, it } from "vitest";
import { createDb, migrateDb, type Db } from "../../src/db/client";
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
    await auth.issueCode("person@example.com");
    const code = mailer.codeFor("person@example.com");
    expect(code).toMatch(/^\d{6}$/);

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
    await auth.issueCode("person@example.com");
    const first = await auth.verify({
      email: "person@example.com",
      code: mailer.codeFor("person@example.com"),
      deviceName: "Mac",
      platform: "mac",
    });

    await auth.issueCode("person@example.com");
    const second = await auth.verify({
      email: "person@example.com",
      code: mailer.codeFor("person@example.com"),
      deviceName: "iPhone",
      platform: "ios",
    });

    expect(second.user.id).toBe(first.user.id);
    expect(second.device.id).not.toBe(first.device.id);
  });

  it("counts wrong-code attempts and locks out after 5", async () => {
    await auth.issueCode("person@example.com");

    for (let i = 0; i < 5; i++) {
      await expect(
        auth.verify({ email: "person@example.com", code: "000000", deviceName: "Mac", platform: "mac" })
      ).rejects.toThrow(UnauthorizedError);
    }

    // The 6th attempt is blocked by the attempt cap, even with the right code.
    const rightCode = mailer.codeFor("person@example.com");
    await expect(
      auth.verify({ email: "person@example.com", code: rightCode, deviceName: "Mac", platform: "mac" })
    ).rejects.toThrow(/too many attempts/i);
  });

  it("rejects an expired code", async () => {
    await auth.issueCode("person@example.com");
    const code = mailer.codeFor("person@example.com");

    clock += 11 * 60 * 1000; // past the 10-minute expiry

    await expect(
      auth.verify({ email: "person@example.com", code, deviceName: "Mac", platform: "mac" })
    ).rejects.toThrow(/expired/i);
  });

  it("invalidates a previous code when a new one is issued", async () => {
    await auth.issueCode("person@example.com");
    const staleCode = mailer.codeFor("person@example.com");

    await auth.issueCode("person@example.com");

    await expect(
      auth.verify({ email: "person@example.com", code: staleCode, deviceName: "Mac", platform: "mac" })
    ).rejects.toThrow(UnauthorizedError);
  });

  it("rejects authenticate() for a revoked device", async () => {
    await auth.issueCode("person@example.com");
    const { token, user, device } = await auth.verify({
      email: "person@example.com",
      code: mailer.codeFor("person@example.com"),
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
    await auth.issueCode("a@example.com");
    const a = await auth.verify({
      email: "a@example.com",
      code: mailer.codeFor("a@example.com"),
      deviceName: "A's Mac",
      platform: "mac",
    });

    await auth.issueCode("b@example.com");
    const b = await auth.verify({
      email: "b@example.com",
      code: mailer.codeFor("b@example.com"),
      deviceName: "B's Mac",
      platform: "mac",
    });

    await expect(auth.revokeDevice(b.user.id, a.device.id)).rejects.toThrow(NotFoundError);
    // A's device still works.
    await expect(auth.authenticate(a.token)).resolves.toMatchObject({ user: { id: a.user.id } });
  });

  describe("token idle expiry", () => {
    it("still authenticates one day short of TOKEN_IDLE_TTL_MS", async () => {
      await auth.issueCode("idle@example.com");
      const { token } = await auth.verify({
        email: "idle@example.com",
        code: mailer.codeFor("idle@example.com"),
        deviceName: "Mac",
        platform: "mac",
      });

      clock += TOKEN_IDLE_TTL_MS - 24 * 60 * 60 * 1000;
      await expect(auth.authenticate(token)).resolves.toBeDefined();
    });

    it("rejects a token idle for more than TOKEN_IDLE_TTL_MS", async () => {
      const start = clock;
      await auth.issueCode("idle2@example.com");
      const { token } = await auth.verify({
        email: "idle2@example.com",
        code: mailer.codeFor("idle2@example.com"),
        deviceName: "Mac",
        platform: "mac",
      });

      clock = start + TOKEN_IDLE_TTL_MS + 1;
      await expect(auth.authenticate(token)).rejects.toThrow(UnauthorizedError);
    });

    it("keeps working when used regularly, sliding the idle window forward", async () => {
      await auth.issueCode("active@example.com");
      const { token } = await auth.verify({
        email: "active@example.com",
        code: mailer.codeFor("active@example.com"),
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

  describe("lastSeenAt refresh throttling", () => {
    it("does not rewrite lastSeenAt within LAST_SEEN_REFRESH_MS, but does after", async () => {
      await auth.issueCode("refresh@example.com");
      const { token, user } = await auth.verify({
        email: "refresh@example.com",
        code: mailer.codeFor("refresh@example.com"),
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
