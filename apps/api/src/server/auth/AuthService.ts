import crypto from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../../db/client";
import { authCodes, devices, users } from "../../db/schema";
import { DEFAULT_STORAGE_LIMIT_BYTES } from "../../db/schema";
import { NotFoundError, UnauthorizedError } from "../../shared/errors";
import type { DeviceSummary, Platform } from "../../shared/types";
import type { Mailer } from "../mail/Mailer";

const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const TOKEN_BYTES = 32;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * A device token unused for this long stops working; the device signs in again with an email
 * code (the account never expires). Tentative: the owner hasn't settled the window (#33).
 */
export const TOKEN_IDLE_TTL_MS = 90 * DAY_MS;
/** `lastSeenAt` is refreshed at most this often, so authenticating isn't a write per request. */
export const LAST_SEEN_REFRESH_MS = DAY_MS;

export interface AuthContext {
  user: { id: string; email: string };
  device: { id: string; name: string; platform: Platform };
}

export interface VerifyInput {
  email: string;
  code: string;
  deviceName: string;
  platform: Platform;
}

export interface VerifyResult extends AuthContext {
  token: string;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function randomCode(): string {
  return crypto.randomInt(0, 10 ** CODE_LENGTH).toString().padStart(CODE_LENGTH, "0");
}

/**
 * Email + six-digit-code accounts: issuing and verifying sign-in codes,
 * authenticating a bearer token, and managing devices. No passwords and no
 * third-party identity provider (see `spec/sync.md`).
 */
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly mailer: Mailer,
    private readonly authPepper: string,
    private readonly tokenPepper: string,
    private readonly now: () => number = () => Date.now()
  ) {}

  private hashCode(code: string): string {
    return sha256(`${code}:${this.authPepper}`);
  }

  private hashToken(token: string): string {
    return sha256(`${token}:${this.tokenPepper}`);
  }

  private async getOrCreateUser(email: string): Promise<{ id: string; email: string }> {
    const [existing] = await this.db.select().from(users).where(eq(users.email, email));
    if (existing) return { id: existing.id, email: existing.email };

    const id = crypto.randomUUID();
    await this.db.insert(users).values({
      id,
      email,
      createdAt: this.now(),
      storageLimitBytes: DEFAULT_STORAGE_LIMIT_BYTES,
    });
    return { id, email };
  }

  /** Generate and email a fresh six-digit code, invalidating any still-active code for this email. */
  async issueCode(email: string): Promise<void> {
    const now = this.now();
    await this.db
      .update(authCodes)
      .set({ consumedAt: now })
      .where(and(eq(authCodes.email, email), isNull(authCodes.consumedAt)));

    const code = randomCode();
    await this.db.insert(authCodes).values({
      id: crypto.randomUUID(),
      email,
      codeHash: this.hashCode(code),
      createdAt: now,
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
      consumedAt: null,
    });

    await this.mailer.sendCode(email, code);
  }

  /** Verify a code, then create a device and its long-lived bearer token. */
  async verify(input: VerifyInput): Promise<VerifyResult> {
    const [row] = await this.db
      .select()
      .from(authCodes)
      .where(and(eq(authCodes.email, input.email), isNull(authCodes.consumedAt)))
      .orderBy(desc(authCodes.createdAt))
      .limit(1);

    if (!row) {
      throw new UnauthorizedError("No active code for this email. Request a new one.");
    }
    if (row.expiresAt < this.now()) {
      throw new UnauthorizedError("Code expired. Request a new one.");
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      throw new UnauthorizedError("Too many attempts. Request a new one.");
    }

    const expectedHash = Buffer.from(row.codeHash, "hex");
    const actualHash = Buffer.from(this.hashCode(input.code), "hex");
    const matches =
      expectedHash.length === actualHash.length && crypto.timingSafeEqual(expectedHash, actualHash);

    if (!matches) {
      await this.db
        .update(authCodes)
        .set({ attempts: row.attempts + 1 })
        .where(eq(authCodes.id, row.id));
      throw new UnauthorizedError("Incorrect code");
    }

    await this.db.update(authCodes).set({ consumedAt: this.now() }).where(eq(authCodes.id, row.id));

    const user = await this.getOrCreateUser(input.email);

    const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    const deviceId = crypto.randomUUID();
    const now = this.now();
    await this.db.insert(devices).values({
      id: deviceId,
      userId: user.id,
      name: input.deviceName,
      platform: input.platform,
      tokenHash: this.hashToken(token),
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null,
    });

    return {
      token,
      user,
      device: { id: deviceId, name: input.deviceName, platform: input.platform },
    };
  }

  /**
   * Resolve a bearer token to its user and device. Rejects revoked devices and
   * tokens idle for longer than `TOKEN_IDLE_TTL_MS`; refreshes `lastSeenAt` at
   * most once per `LAST_SEEN_REFRESH_MS`.
   */
  async authenticate(token: string): Promise<AuthContext> {
    const tokenHash = this.hashToken(token);
    const [device] = await this.db.select().from(devices).where(eq(devices.tokenHash, tokenHash));

    if (!device || device.revokedAt !== null) {
      throw new UnauthorizedError("Invalid or revoked device token");
    }

    const now = this.now();
    if (now - device.lastSeenAt > TOKEN_IDLE_TTL_MS) {
      throw new UnauthorizedError("Device token expired. Sign in again.");
    }
    if (now - device.lastSeenAt >= LAST_SEEN_REFRESH_MS) {
      await this.db.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, device.id));
    }

    const [user] = await this.db.select().from(users).where(eq(users.id, device.userId));
    if (!user) {
      throw new UnauthorizedError("Invalid or revoked device token");
    }

    return {
      user: { id: user.id, email: user.email },
      device: { id: device.id, name: device.name, platform: device.platform },
    };
  }

  /** List every device for a user, most recently created first. */
  async listDevices(userId: string): Promise<DeviceSummary[]> {
    const rows = await this.db
      .select()
      .from(devices)
      .where(eq(devices.userId, userId))
      .orderBy(desc(devices.createdAt));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      platform: row.platform,
      createdAt: new Date(row.createdAt).toISOString(),
      lastSeenAt: new Date(row.lastSeenAt).toISOString(),
      revoked: row.revokedAt !== null,
    }));
  }

  /** Revoke a device's token. Scoped to `userId` so one account can't revoke another's device. */
  async revokeDevice(userId: string, deviceId: string): Promise<void> {
    const [device] = await this.db
      .select()
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)));
    if (!device) {
      throw new NotFoundError("Device not found");
    }
    await this.db.update(devices).set({ revokedAt: this.now() }).where(eq(devices.id, deviceId));
  }
}
