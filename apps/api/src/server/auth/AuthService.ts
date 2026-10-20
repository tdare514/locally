import crypto from "node:crypto";
import { and, asc, desc, eq, isNotNull, isNull, ne, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client";
import { authCodes, devices, users } from "../../db/schema";
import { DEFAULT_STORAGE_LIMIT_BYTES } from "../../db/schema";
import { NotFoundError, UnauthorizedError } from "../../shared/errors";
import type { DevicePlatform, DeviceSummary, Platform } from "../../shared/types";
import type { Mailer } from "../mail/Mailer";

const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const TOKEN_BYTES = 32;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * A device token unused for this long stops working; the device signs in again with an email
 * code (the account never expires). A year, by the owner's call (#33).
 */
export const TOKEN_IDLE_TTL_MS = 365 * DAY_MS;
/** `lastSeenAt` is refreshed at most this often, so authenticating isn't a write per request. */
export const LAST_SEEN_REFRESH_MS = DAY_MS;

export interface AuthContext {
  user: { id: string; email: string };
  device: { id: string; name: string; platform: DevicePlatform };
}

export interface VerifyInput {
  email: string;
  code: string;
  deviceName: string;
  platform: Platform;
  /** A Mac's install ID (#210); ignored for other platforms. */
  installId?: string;
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

  /**
   * Persist a fresh six-digit code (invalidating any still-active code for
   * this email) and return the plaintext. The auth route emails it after the
   * response (#31) so Resend latency never blocks `{ ok: true }`.
   */
  async issueCode(email: string): Promise<string> {
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
    return code;
  }

  /** Deliver a code issued by `issueCode`. Failures are the caller's to log. */
  async sendCode(email: string, code: string): Promise<void> {
    await this.mailer.sendCode(email, code);
  }

  /**
   * Verify a code, then give the caller a device and its long-lived bearer token. A Mac that
   * signs back in after a sign-out gets its old device row back (see `reviveMac`); every other
   * sign-in creates a new device.
   */
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

    // Claim the code with a conditional update: of two verifies racing on the same code, exactly
    // one changes a row; the other is refused as if the code were already used (#175).
    const claimed = await this.db
      .update(authCodes)
      .set({ consumedAt: this.now() })
      .where(and(eq(authCodes.id, row.id), isNull(authCodes.consumedAt)))
      .returning({ id: authCodes.id });
    if (claimed.length === 0) {
      throw new UnauthorizedError("No active code for this email. Request a new one.");
    }

    const user = await this.getOrCreateUser(input.email);

    const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    const tokenHash = this.hashToken(token);
    const now = this.now();

    const installId = input.platform === "mac" ? (input.installId ?? null) : null;
    const revivedId =
      input.platform === "mac"
        ? await this.reviveMac(user.id, input.deviceName, installId, tokenHash, now)
        : null;
    const deviceId = revivedId ?? crypto.randomUUID();
    if (revivedId === null) {
      await this.db.insert(devices).values({
        id: deviceId,
        userId: user.id,
        name: input.deviceName,
        platform: input.platform,
        tokenHash,
        createdAt: now,
        lastSeenAt: now,
        revokedAt: null,
        installId,
      });
    }

    return {
      token,
      user,
      device: { id: deviceId, name: input.deviceName, platform: input.platform },
    };
  }

  /**
   * Take back one of this user's revoked Macs, if there is one, and return its id; otherwise
   * null (the caller inserts a new device). In order (#210):
   *   1. a revoked Mac with the same install ID (only when the Mac sent one);
   *   2. a revoked Mac with the same name and no install ID (the #175 rule, for rows made before
   *      install IDs), or, for a Mac that sent no install ID, any revoked Mac of that name;
   *   3. otherwise null.
   * A row with a different non-null install ID is never revived by name, so two Macs that share
   * a hostname don't share a row.
   *
   * Play counts are stored per device and summed over every device, revoked ones included
   * (#104), so a Mac that signs out and back in would otherwise push its counts again under a
   * new id and the total would double (#175). Macs only: two phones of one model share a name,
   * and phones don't count plays. An active Mac is never touched.
   */
  private async reviveMac(
    userId: string,
    name: string,
    installId: string | null,
    tokenHash: string,
    now: number
  ): Promise<string | null> {
    if (installId !== null) {
      const byId = await this.reviveWhere(userId, eq(devices.installId, installId), installId, tokenHash, now);
      if (byId !== null) return byId;
    }
    // A Mac with an install ID only takes rows that have none; an old Mac (no ID) keeps the
    // plain name rule.
    const byName = and(eq(devices.name, name), installId === null ? undefined : isNull(devices.installId));
    return this.reviveWhere(userId, byName, installId, tokenHash, now);
  }

  /**
   * One UPDATE ... RETURNING is the whole step, so it is atomic: the row is picked and changed
   * in a single statement whose WHERE repeats the preconditions (this user, a Mac, still
   * revoked). Two verifies racing for the same row cannot both revive it, since the loser no
   * longer matches `revoked_at IS NOT NULL`. The new token hash replaces the old one, so the old
   * token stops working at once. The row keeps its install ID, or gains `installId`.
   */
  private async reviveWhere(
    userId: string,
    match: SQL | undefined,
    installId: string | null,
    tokenHash: string,
    now: number
  ): Promise<string | null> {
    const candidate = this.db
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.userId, userId), eq(devices.platform, "mac"), match, isNotNull(devices.revokedAt)))
      .orderBy(desc(devices.lastSeenAt), desc(devices.createdAt), asc(devices.id))
      .limit(1);

    const [revived] = await this.db
      .update(devices)
      .set({
        revokedAt: null,
        tokenHash,
        lastSeenAt: now,
        ...(installId !== null ? { installId } : {}),
      })
      .where(
        and(
          eq(devices.id, candidate),
          eq(devices.userId, userId),
          eq(devices.platform, "mac"),
          isNotNull(devices.revokedAt)
        )
      )
      .returning({ id: devices.id });
    return revived?.id ?? null;
  }

  /**
   * Resolve a bearer token to its user and device. Rejects revoked devices and
   * tokens idle for longer than `TOKEN_IDLE_TTL_MS`; refreshes `lastSeenAt` at
   * most once per `LAST_SEEN_REFRESH_MS`.
   */
  async authenticate(token: string): Promise<AuthContext> {
    const tokenHash = this.hashToken(token);
    const [device] = await this.db.select().from(devices).where(eq(devices.tokenHash, tokenHash));

    // A cloud device (#306) has a throwaway token hash and can never sign in; refuse it explicitly as well.
    if (!device || device.revokedAt !== null || device.platform === "cloud") {
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
  async listDevices(userId: string): Promise<{ devices: DeviceSummary[]; hasMore: boolean }> {
    const rows = await this.db
      .select()
      .from(devices)
      .where(and(eq(devices.userId, userId), ne(devices.platform, "cloud")))
      .orderBy(desc(devices.createdAt))
      .limit(51);

    const hasMore = rows.length > 50;
    return {
      devices: rows.slice(0, 50).map((row) => ({
        id: row.id,
        name: row.name,
        platform: row.platform,
        createdAt: new Date(row.createdAt).toISOString(),
        lastSeenAt: new Date(row.lastSeenAt).toISOString(),
        revoked: row.revokedAt !== null,
      })),
      hasMore,
    };
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
