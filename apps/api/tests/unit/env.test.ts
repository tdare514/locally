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

  describe("migrateOnStart", () => {
    function stubProduction() {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AUTH_PEPPER", "a-real-auth-pepper");
      vi.stubEnv("TOKEN_PEPPER", "a-real-token-pepper");
      vi.stubEnv("CRON_SECRET", "a-real-cron-secret");
      vi.stubEnv("DATABASE_URL", "libsql://db.example.turso.io");
    }

    it("is true in development and false in production by default", () => {
      vi.stubEnv("DB_MIGRATE_ON_START", "");
      vi.stubEnv("NODE_ENV", "development");
      expect(loadEnv().migrateOnStart).toBe(true);

      stubProduction();
      expect(loadEnv().migrateOnStart).toBe(false);
    });

    it("DB_MIGRATE_ON_START=true turns it on in production", () => {
      stubProduction();
      vi.stubEnv("DB_MIGRATE_ON_START", "true");
      expect(loadEnv().migrateOnStart).toBe(true);
    });

    it("DB_MIGRATE_ON_START=false turns it off in development", () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("DB_MIGRATE_ON_START", "false");
      expect(loadEnv().migrateOnStart).toBe(false);
    });

    it("ignores an unrecognised DB_MIGRATE_ON_START value", () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("DB_MIGRATE_ON_START", "maybe");
      expect(loadEnv().migrateOnStart).toBe(true);
    });
  });

  describe("Spotify (#305)", () => {
    const GOOD_KEY = Buffer.alloc(32, 7).toString("base64");

    function prod(overrides: Record<string, string> = {}) {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AUTH_PEPPER", "a-real-auth-pepper");
      vi.stubEnv("TOKEN_PEPPER", "a-real-token-pepper");
      vi.stubEnv("CRON_SECRET", "a-real-cron-secret");
      vi.stubEnv("DATABASE_URL", "libsql://example");
      const all: Record<string, string> = {
        SPOTIFY_CLIENT_ID: "cid",
        SPOTIFY_REDIRECT_URI: "https://sync.example.com/v1/spotify/callback",
        SPOTIFY_TOKEN_KEY: GOOD_KEY,
        SAMPLER_SECRET: "sampler",
        ...overrides,
      };
      for (const [k, v] of Object.entries(all)) vi.stubEnv(k, v);
    }

    it("is null unless SPOTIFY_CLIENT_ID is set", () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("SPOTIFY_CLIENT_ID", "");
      expect(loadEnv().spotify).toBeNull();
    });

    it("loads a complete production config", () => {
      prod();
      const spotify = loadEnv().spotify!;
      expect(spotify.clientId).toBe("cid");
      expect(spotify.tokenKey).toHaveLength(32);
      expect(spotify.samplerSecret).toBe("sampler");
    });

    it.each(["SPOTIFY_REDIRECT_URI", "SPOTIFY_TOKEN_KEY", "SAMPLER_SECRET"])("refuses production without %s", (name) => {
      prod({ [name]: "" });
      expect(() => loadEnv()).toThrow(new RegExp(name));
    });

    it("refuses production with a token key that is not 32 bytes", () => {
      prod({ SPOTIFY_TOKEN_KEY: Buffer.alloc(16).toString("base64") });
      expect(() => loadEnv()).toThrow(/SPOTIFY_TOKEN_KEY/);
      prod({ SPOTIFY_TOKEN_KEY: "not base64 !!!" });
      expect(() => loadEnv()).toThrow(/SPOTIFY_TOKEN_KEY/);
    });

    it("refuses production with a non-https or invalid redirect", () => {
      prod({ SPOTIFY_REDIRECT_URI: "http://sync.example.com/v1/spotify/callback" });
      expect(() => loadEnv()).toThrow(/SPOTIFY_REDIRECT_URI/);
      prod({ SPOTIFY_REDIRECT_URI: "not a url" });
      expect(() => loadEnv()).toThrow(/SPOTIFY_REDIRECT_URI/);
    });

    it("falls back to loud insecure defaults in development", () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("SPOTIFY_CLIENT_ID", "cid");
      vi.stubEnv("SPOTIFY_REDIRECT_URI", "");
      vi.stubEnv("SPOTIFY_TOKEN_KEY", "");
      vi.stubEnv("SAMPLER_SECRET", "");
      const spotify = loadEnv().spotify!;
      expect(spotify.redirectUri).toBe("http://127.0.0.1:4000/v1/spotify/callback");
      expect(spotify.tokenKey).toHaveLength(32);
    });
  });
});
