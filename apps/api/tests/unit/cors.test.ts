import { describe, expect, it } from "vitest";
import { isOriginAllowed, corsHeaders } from "../../src/server/http/cors";

describe("isOriginAllowed", () => {
  const allowed = ["http://localhost:*", "http://127.0.0.1:*", "https://app.example.com"];

  it("matches any port on a wildcard host", () => {
    expect(isOriginAllowed("http://localhost:3000", allowed)).toBe(true);
    expect(isOriginAllowed("http://localhost:4000", allowed)).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1:5173", allowed)).toBe(true);
  });

  it("matches a literal origin exactly", () => {
    expect(isOriginAllowed("https://app.example.com", allowed)).toBe(true);
    expect(isOriginAllowed("https://evil.example.com", allowed)).toBe(false);
  });

  it("rejects a scheme mismatch even on an otherwise-allowed host", () => {
    expect(isOriginAllowed("https://localhost:3000", allowed)).toBe(false);
  });

  it("rejects a non-numeric suffix on a wildcard-port pattern", () => {
    expect(isOriginAllowed("http://localhost:abc", allowed)).toBe(false);
    expect(isOriginAllowed("http://localhost.evil.com:3000", allowed)).toBe(false);
  });
});

describe("corsHeaders", () => {
  it("echoes the given origin and allows the methods this API uses", () => {
    const headers = corsHeaders("http://localhost:3000");
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");
    expect(headers["Access-Control-Allow-Methods"]).toContain("PUT");
    expect(headers["Access-Control-Allow-Headers"]).toContain("Authorization");
  });
});
