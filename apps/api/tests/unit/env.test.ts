import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "../../src/server/config/env";

describe("loadEnv", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("throws when FILE_STORE=blob but BLOB_READ_WRITE_TOKEN is empty", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FILE_STORE", "blob");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");

    expect(() => loadEnv()).toThrow(/BLOB_READ_WRITE_TOKEN/);
  });

  it("throws when MAILER=resend but RESEND_API_KEY is empty", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("MAILER", "resend");
    vi.stubEnv("RESEND_API_KEY", "");

    expect(() => loadEnv()).toThrow(/RESEND_API_KEY/);
  });

  it("throws in production when AUTH_PEPPER/TOKEN_PEPPER are unset", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_PEPPER", "");
    vi.stubEnv("TOKEN_PEPPER", "");
    vi.stubEnv("CRON_SECRET", "a-real-cron-secret");

    expect(() => loadEnv()).toThrow(/AUTH_PEPPER/);
  });

  it("throws in production when CRON_SECRET is unset", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_PEPPER", "a-real-auth-pepper");
    vi.stubEnv("TOKEN_PEPPER", "a-real-token-pepper");
    vi.stubEnv("CRON_SECRET", "");

    expect(() => loadEnv()).toThrow(/CRON_SECRET/);
  });

  it("returns defaults in dev with nothing set, and does not throw", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_PEPPER", "");
    vi.stubEnv("TOKEN_PEPPER", "");
    vi.stubEnv("FILE_STORE", "");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("MAILER", "");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("TURSO_DATABASE_URL", "");
    vi.stubEnv("TURSO_AUTH_TOKEN", "");
    vi.stubEnv("ALLOWED_ORIGINS", "");
    vi.stubEnv("PUBLIC_BASE_URL", "");

    let env: ReturnType<typeof loadEnv> | undefined;
    expect(() => {
      env = loadEnv();
    }).not.toThrow();

    expect(env?.fileStore).toBe("local");
    expect(env?.mailer).toBe("console");
    expect(env?.databaseUrl).toBe("file:./data/dev.db");
    expect(env?.publicBaseUrl).toBe("http://localhost:4000");
    expect(env?.cronSecret).toBeFalsy();
  });

  it("production with everything required set does not throw", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_PEPPER", "a-real-auth-pepper");
    vi.stubEnv("TOKEN_PEPPER", "a-real-token-pepper");
    vi.stubEnv("CRON_SECRET", "a-real-cron-secret");
    vi.stubEnv("DATABASE_URL", "libsql://db.example.turso.io");

    expect(() => loadEnv()).not.toThrow();
  });

  it("throws in production when no database URL is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_PEPPER", "a-real-auth-pepper");
    vi.stubEnv("TOKEN_PEPPER", "a-real-token-pepper");
    vi.stubEnv("CRON_SECRET", "a-real-cron-secret");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("TURSO_DATABASE_URL", "");

    expect(() => loadEnv()).toThrow(/DATABASE_URL/);
  });

  it("reads the Turso integration's URL and token when DATABASE_URL is unset", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_PEPPER", "a-real-auth-pepper");
    vi.stubEnv("TOKEN_PEPPER", "a-real-token-pepper");
    vi.stubEnv("CRON_SECRET", "a-real-cron-secret");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DATABASE_AUTH_TOKEN", "");
    vi.stubEnv("TURSO_DATABASE_URL", "libsql://db.example.turso.io");
    vi.stubEnv("TURSO_AUTH_TOKEN", "a-turso-token");

    const env = loadEnv();
    expect(env.databaseUrl).toBe("libsql://db.example.turso.io");
    expect(env.databaseAuthToken).toBe("a-turso-token");
  });
});
