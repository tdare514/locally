/**
 * Central place that reads `process.env` and applies every default, so the
 * rest of the app never touches `process.env` directly. `npm run dev` and
 * `npm run check` must both work with none of these set (see `.env.example`).
 */

const DEV_AUTH_PEPPER = "dev-insecure-auth-pepper-do-not-use-in-production";
const DEV_TOKEN_PEPPER = "dev-insecure-token-pepper-do-not-use-in-production";

const DEV_SPOTIFY_TOKEN_KEY = Buffer.alloc(32, "dev-insecure-spotify-token-key").toString("base64");
const DEV_SAMPLER_SECRET = "dev-insecure-sampler-secret-do-not-use-in-production";
const DEV_SPOTIFY_REDIRECT_URI = "http://127.0.0.1:4000/v1/spotify/callback";

/** 50 GiB — a placeholder budget; set `STORAGE_ALERT_BYTES` to the real one before it matters. */
const DEFAULT_STORAGE_ALERT_BYTES = 50 * 1024 * 1024 * 1024;

/** 20 GiB of share egress in 24 hours: a placeholder; set `SHARE_EGRESS_ALERT_BYTES` to the real budget. */
const DEFAULT_SHARE_EGRESS_ALERT_BYTES = 20 * 1024 * 1024 * 1024;

/** `FILE_STORE=blob` requires `BLOB_READ_WRITE_TOKEN`, checked once here — see `resolveFileStore`. */
type FileStoreEnv = { fileStore: "local" } | { fileStore: "blob"; blobReadWriteToken: string };

/** `MAILER=resend` requires `RESEND_API_KEY`, checked once here — see `resolveMailer`. */
type MailerEnv = { mailer: "console" } | { mailer: "resend"; resendApiKey: string };

/** Present only when `SPOTIFY_CLIENT_ID` is set (#305); every Spotify route answers 404 otherwise. */
export type SpotifyEnv = {
  clientId: string;
  redirectUri: string;
  /** Exactly 32 bytes, decoded from `SPOTIFY_TOKEN_KEY` (base64). */
  tokenKey: Buffer;
  /** Guards the sampler route (step 2, #306); validated here so the deploy is complete up front. */
  samplerSecret: string;
};

export type Env = {
  /** Mirrored by scripts/migrate.mjs (`DATABASE_URL`, else `TURSO_DATABASE_URL`); keep the two in step. */
  databaseUrl: string;
  /** libSQL auth token when it isn't embedded in the URL (Turso's Vercel integration sets it separately). */
  databaseAuthToken: string | undefined;
  authPepper: string;
  tokenPepper: string;
  mailFrom: string;
  cronSecret: string | undefined;
  allowedOrigins: string[];
  publicBaseUrl: string;
  /** Cost guardrail: the cleanup cron logs a warning once total stored bytes reach this. */
  storageAlertBytes: number;
  /** Kill switch for public share links (#146): only the exact string `"true"` turns them on; off by default. */
  publicSharesEnabled: boolean;
  /** Cost guardrail: the cleanup cron warns when share downloads in the last 24 hours reach this many bytes. */
  shareEgressAlertBytes: number;
  /**
   * Apply migrations on the first request (true) or only verify the schema is
   * current (false). Defaults to true outside production, where the Vercel
   * build migrates instead (scripts/migrate.mjs); `DB_MIGRATE_ON_START`
   * overrides it.
   */
  migrateOnStart: boolean;
  spotify: SpotifyEnv | null;
} & FileStoreEnv &
  MailerEnv;

let warnedInsecurePeppers = false;

function parseAllowedOrigins(raw: string | undefined): string[] {
  const value = raw && raw.trim().length > 0 ? raw : "http://localhost:*,http://127.0.0.1:*";
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Parses an optional positive-integer byte count, falling back to `fallback` when unset or invalid. */
function parseByteCount(raw: string | undefined, fallback: number): number {
  if (!raw || raw.trim().length === 0) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Fails closed: `FILE_STORE=blob` without a token would otherwise silently fall back to `LocalFileStore`. */
function resolveFileStore(): FileStoreEnv {
  if (process.env.FILE_STORE === "blob") {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      throw new Error("FILE_STORE=blob requires BLOB_READ_WRITE_TOKEN to be set. See .env.example.");
    }
    return { fileStore: "blob", blobReadWriteToken: token };
  }
  return { fileStore: "local" };
}

/** Fails closed: `MAILER=resend` without a key would otherwise silently fall back to `ConsoleMailer`, printing sign-in codes to production logs. */
function resolveMailer(): MailerEnv {
  if (process.env.MAILER === "resend") {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error("MAILER=resend requires RESEND_API_KEY to be set. See .env.example.");
    }
    return { mailer: "resend", resendApiKey: key };
  }
  return { mailer: "console" };
}

/** Decodes a base64 string that must be exactly 32 bytes, or returns null. */
function decodeTokenKey(raw: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

let warnedInsecureSpotify = false;

/**
 * Null unless `SPOTIFY_CLIENT_ID` is set. In production every other Spotify value must be set and valid, or
 * the server refuses to start; in development unset ones fall back to loud insecure defaults. A value that is
 * set but invalid is refused in both.
 */
function resolveSpotify(isProduction: boolean): SpotifyEnv | null {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) return null;

  const rawKey = process.env.SPOTIFY_TOKEN_KEY;
  const rawRedirect = process.env.SPOTIFY_REDIRECT_URI;
  const rawSampler = process.env.SAMPLER_SECRET;

  if (isProduction) {
    const missing = (["SPOTIFY_REDIRECT_URI", "SPOTIFY_TOKEN_KEY", "SAMPLER_SECRET"] as const).filter(
      (name) => !process.env[name]
    );
    if (missing.length > 0) {
      throw new Error(
        `${missing.join(", ")} must be set in production when SPOTIFY_CLIENT_ID is set — refusing to start with an insecure default. See .env.example.`
      );
    }
  }

  const tokenKey = decodeTokenKey(rawKey || DEV_SPOTIFY_TOKEN_KEY);
  if (!tokenKey) {
    throw new Error("SPOTIFY_TOKEN_KEY must be base64 of exactly 32 bytes (openssl rand -base64 32). See .env.example.");
  }

  const redirectUri = rawRedirect || DEV_SPOTIFY_REDIRECT_URI;
  let redirect: URL;
  try {
    redirect = new URL(redirectUri);
  } catch {
    throw new Error("SPOTIFY_REDIRECT_URI must be a valid URL. See .env.example.");
  }
  if (isProduction && redirect.protocol !== "https:") {
    throw new Error("SPOTIFY_REDIRECT_URI must be https in production. See .env.example.");
  }

  if ((!rawKey || !rawSampler || !rawRedirect) && !warnedInsecureSpotify) {
    warnedInsecureSpotify = true;
    console.warn(
      "[sync-api] SPOTIFY_TOKEN_KEY, SAMPLER_SECRET and/or SPOTIFY_REDIRECT_URI are not set. Using insecure " +
        "development defaults — stored Spotify tokens are NOT safe beyond your own machine. See .env.example."
    );
  }

  return { clientId, redirectUri, tokenKey, samplerSecret: rawSampler || DEV_SAMPLER_SECRET };
}

/** `DB_MIGRATE_ON_START=true|1|false|0`; anything else (or unset) means `fallback`. */
function parseMigrateOnStart(raw: string | undefined, fallback: boolean): boolean {
  const v = raw?.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return fallback;
}

/** Read and validate every env var this app uses, applying dev-friendly defaults. */
export function loadEnv(): Env {
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    const missing: string[] = (["AUTH_PEPPER", "TOKEN_PEPPER", "CRON_SECRET"] as const).filter(
      (name) => !process.env[name]
    );
    // Without a database URL the server would fall back to a local SQLite
    // file, which a serverless deploy can't keep.
    if (!process.env.DATABASE_URL && !process.env.TURSO_DATABASE_URL) {
      missing.push("DATABASE_URL (or TURSO_DATABASE_URL)");
    }
    if (missing.length > 0) {
      throw new Error(
        `${missing.join(", ")} must be set in production — refusing to start with an insecure default. See .env.example.`
      );
    }
  }

  const authPepper = process.env.AUTH_PEPPER || DEV_AUTH_PEPPER;
  const tokenPepper = process.env.TOKEN_PEPPER || DEV_TOKEN_PEPPER;

  if ((authPepper === DEV_AUTH_PEPPER || tokenPepper === DEV_TOKEN_PEPPER) && !warnedInsecurePeppers) {
    warnedInsecurePeppers = true;
    console.warn(
      "[sync-api] AUTH_PEPPER and/or TOKEN_PEPPER are not set. Using insecure development " +
        "defaults — codes and tokens hashed with these are NOT safe to expose beyond your own " +
        "machine. Set both env vars before deploying. See .env.example."
    );
  }

  return {
    databaseUrl: process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL || "file:./data/dev.db",
    databaseAuthToken: process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || undefined,
    authPepper,
    tokenPepper,
    mailFrom: process.env.MAIL_FROM || "Locally Sync <sync@example.com>",
    cronSecret: process.env.CRON_SECRET,
    allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
    publicBaseUrl: (process.env.PUBLIC_BASE_URL || "http://localhost:4000").replace(/\/+$/, ""),
    storageAlertBytes: parseByteCount(process.env.STORAGE_ALERT_BYTES, DEFAULT_STORAGE_ALERT_BYTES),
    publicSharesEnabled: process.env.PUBLIC_SHARES_ENABLED === "true",
    shareEgressAlertBytes: parseByteCount(process.env.SHARE_EGRESS_ALERT_BYTES, DEFAULT_SHARE_EGRESS_ALERT_BYTES),
    migrateOnStart: parseMigrateOnStart(process.env.DB_MIGRATE_ON_START, !isProduction),
    spotify: resolveSpotify(isProduction),
    ...resolveFileStore(),
    ...resolveMailer(),
  };
}
