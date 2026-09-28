/**
 * Central place that reads `process.env` and applies every default, so the
 * rest of the app never touches `process.env` directly. `npm run dev` and
 * `npm run check` must both work with none of these set (see `.env.example`).
 */

const DEV_AUTH_PEPPER = "dev-insecure-auth-pepper-do-not-use-in-production";
const DEV_TOKEN_PEPPER = "dev-insecure-token-pepper-do-not-use-in-production";

/** 50 GiB — a placeholder budget; set `STORAGE_ALERT_BYTES` to the real one before it matters. */
const DEFAULT_STORAGE_ALERT_BYTES = 50 * 1024 * 1024 * 1024;

/** `FILE_STORE=blob` requires `BLOB_READ_WRITE_TOKEN`, checked once here — see `resolveFileStore`. */
type FileStoreEnv = { fileStore: "local" } | { fileStore: "blob"; blobReadWriteToken: string };

/** `MAILER=resend` requires `RESEND_API_KEY`, checked once here — see `resolveMailer`. */
type MailerEnv = { mailer: "console" } | { mailer: "resend"; resendApiKey: string };

export type Env = {
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
    ...resolveFileStore(),
    ...resolveMailer(),
  };
}
