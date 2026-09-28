import { describe, expect, it } from "vitest";
import { applySyncBaseUrlChange, isLoopbackHost } from "../../src/server/sync/settings";
import type { SyncSettings } from "../../src/shared/types";

const existing: SyncSettings = {
  baseUrl: "https://sync.example.com",
  deviceToken: "secret-token",
  email: "a@b.com",
  lastVersion: 3,
};

describe("isLoopbackHost", () => {
  it("accepts localhost, 127.0.0.1, and both IPv6 loopback spellings", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
  });

  it("rejects everything else, including *.localhost and LAN IPs", () => {
    expect(isLoopbackHost("foo.localhost")).toBe(false);
    expect(isLoopbackHost("192.168.1.23")).toBe(false);
    expect(isLoopbackHost("example.com")).toBe(false);
  });
});

describe("applySyncBaseUrlChange", () => {
  it("allows http on loopback hosts: localhost, 127.0.0.1, [::1]", () => {
    for (const url of ["http://localhost:4000", "http://127.0.0.1:4000", "http://[::1]:4000"]) {
      const result = applySyncBaseUrlChange(null, url);
      expect(result.ok).toBe(true);
    }
  });

  it("rejects non-loopback http", () => {
    for (const url of ["http://example.com:5000", "http://192.168.1.23:4000"]) {
      const result = applySyncBaseUrlChange(null, url);
      expect(result).toEqual({
        ok: false,
        error: "sync.baseUrl must use https (http is only allowed for localhost)",
      });
    }
  });

  it("allows https anywhere", () => {
    const result = applySyncBaseUrlChange(null, "https://sync.example.com");
    expect(result.ok).toBe(true);
  });

  it("rejects an invalid URL", () => {
    const result = applySyncBaseUrlChange(null, "not a url");
    expect(result).toEqual({ ok: false, error: "sync.baseUrl must be a valid URL" });
  });

  it("rejects an empty string", () => {
    const result = applySyncBaseUrlChange(null, "   ");
    expect(result).toEqual({ ok: false, error: "sync.baseUrl must be a non-empty string" });
  });

  it("rejects non-http(s) schemes, e.g. ftp", () => {
    const result = applySyncBaseUrlChange(null, "ftp://localhost");
    expect(result).toEqual({
      ok: false,
      error: "sync.baseUrl must use https (http is only allowed for localhost)",
    });
  });

  it("preserves token/email/lastVersion when the base URL is unchanged", () => {
    const result = applySyncBaseUrlChange(existing, "https://sync.example.com");
    expect(result).toEqual({ ok: true, sync: existing });
  });

  it("resets token/email/lastVersion when the base URL changes", () => {
    const result = applySyncBaseUrlChange(existing, "https://other.example.com");
    expect(result).toEqual({
      ok: true,
      sync: { baseUrl: "https://other.example.com", deviceToken: null, email: null, lastVersion: 0 },
    });
  });

  it("creates fresh settings from a null current", () => {
    const result = applySyncBaseUrlChange(null, "https://sync.example.com");
    expect(result).toEqual({
      ok: true,
      sync: { baseUrl: "https://sync.example.com", deviceToken: null, email: null, lastVersion: 0 },
    });
  });

  it("normalises a trailing slash so it equals the stored URL without a reset", () => {
    const result = applySyncBaseUrlChange(existing, "https://sync.example.com/");
    expect(result).toEqual({ ok: true, sync: existing });
  });
});
