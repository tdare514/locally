/**
 * Central place that reads `process.env` and applies every default, so the
 * rest of the app never touches `process.env` directly. `npm run dev` and
 * `npm run check` must both work with none of these set (see `.env.example`).
 */

const DEV_AUTH_PEPPER = "dev-insecure-auth-pepper-do-not-use-in-production";
const DEV_TOKEN_PEPPER = "dev-insecure-token-pepper-do-not-use-in-production";

export interface Env {
  databaseUrl: string;
  authPepper: string;
  tokenPepper: string;
  fileStore: "local" | "blob";
  blobReadWriteToken: string | undefined;
  mailer: "console" | "resend";
  resendApiKey: string | undefined;
  mailFrom: string;
  cronSecret: string | undefined;
  allowedOrigins: string[];
  publicBaseUrl: string;
}

let warnedInsecurePeppers = false;

function parseAllowedOrigins(raw: string | undefined): string[] {
  const value = raw && raw.trim().length > 0 ? raw : "http://localhost:*,http://127.0.0.1:*";
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Read and validate every env var this app uses, applying dev-friendly defaults. */
export function loadEnv(): Env {
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

  const fileStore = process.env.FILE_STORE === "blob" ? "blob" : "local";
  const mailer = process.env.MAILER === "resend" ? "resend" : "console";

  return {
    databaseUrl: process.env.DATABASE_URL || "file:./data/dev.db",
    authPepper,
    tokenPepper,
    fileStore,
    blobReadWriteToken: process.env.BLOB_READ_WRITE_TOKEN,
    mailer,
    resendApiKey: process.env.RESEND_API_KEY,
    mailFrom: process.env.MAIL_FROM || "Locally Sync <sync@example.com>",
    cronSecret: process.env.CRON_SECRET,
    allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
    publicBaseUrl: (process.env.PUBLIC_BASE_URL || "http://localhost:4000").replace(/\/+$/, ""),
  };
}
