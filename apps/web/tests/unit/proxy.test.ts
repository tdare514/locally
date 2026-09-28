import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "../../src/proxy";

interface Opts {
  host?: string | null;
  method?: string;
  path?: string;
  origin?: string;
  referer?: string;
}

/** Build a request the way the server sees it; the URL's own host is irrelevant, only the Host header counts. */
function request(opts: Opts = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.host !== null) headers.host = opts.host ?? "localhost:3000";
  if (opts.origin !== undefined) headers.origin = opts.origin;
  if (opts.referer !== undefined) headers.referer = opts.referer;
  return new NextRequest(`http://localhost:3000${opts.path ?? "/"}`, { method: opts.method ?? "GET", headers });
}

const post = (opts: Opts = {}) => request({ method: "POST", path: "/api/x", ...opts });

describe("proxy: loopback Host check", () => {
  it("rejects a non-loopback Host", () => {
    expect(proxy(request({ host: "evil.example" })).status).toBe(403);
    expect(proxy(request({ host: "192.168.1.10:3000" })).status).toBe(403);
  });

  it("rejects a missing Host", () => {
    expect(proxy(request({ host: null })).status).toBe(403);
  });

  it("passes a GET on localhost, 127.0.0.1 and IPv6 [::1]", () => {
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "localhost"]) {
      const res = proxy(request({ host }));
      expect(res.status, host).toBe(200);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });
});

describe("proxy: same-origin check on mutating API requests", () => {
  it("passes a POST whose Origin is exactly our own origin", () => {
    expect(proxy(post({ origin: "http://localhost:3000" })).status).toBe(200);
  });

  it("rejects another loopback port", () => {
    expect(proxy(post({ origin: "http://localhost:5173" })).status).toBe(403);
  });

  it("rejects a different loopback hostname on the same port", () => {
    expect(proxy(post({ host: "localhost:3000", origin: "http://127.0.0.1:3000" })).status).toBe(403);
  });

  it("passes when the page was loaded via the IP and Origin matches it", () => {
    // Guards against comparing with req.nextUrl.origin, which Next rewrites to "localhost".
    expect(proxy(post({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" })).status).toBe(200);
    expect(proxy(post({ host: "[::1]:3000", origin: "http://[::1]:3000" })).status).toBe(200);
  });

  it("rejects a different scheme", () => {
    expect(proxy(post({ origin: "https://localhost:3000" })).status).toBe(403);
  });

  it("rejects a missing Origin and Referer", () => {
    expect(proxy(post()).status).toBe(403);
  });

  it('rejects the literal "null" origin and unparsable values', () => {
    expect(proxy(post({ origin: "null" })).status).toBe(403);
    expect(proxy(post({ origin: "not a url" })).status).toBe(403);
    expect(proxy(post({ referer: "localhost:3000" })).status).toBe(403);
  });

  it("falls back to a same-origin Referer", () => {
    expect(proxy(post({ referer: "http://localhost:3000/import?x=1" })).status).toBe(200);
    expect(proxy(post({ referer: "http://localhost:5173/" })).status).toBe(403);
  });

  it("checks every mutating method", () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      expect(proxy(post({ method, origin: "http://localhost:5173" })).status, method).toBe(403);
      expect(proxy(post({ method, origin: "http://localhost:3000" })).status, method).toBe(200);
    }
  });

  it("does not check GET, even with a foreign Origin", () => {
    expect(proxy(request({ path: "/api/x", origin: "http://evil.example" })).status).toBe(200);
  });

  it("still applies the CSRF check to a percent-encoded /api/ path", () => {
    expect(proxy(post({ path: "/%61pi/x", origin: "http://localhost:5173" })).status).toBe(403);
    expect(proxy(post({ path: "/%61pi/x", origin: "http://localhost:3000" })).status).toBe(200);
  });

  it("still applies the CSRF check to a mixed-case /API/ path", () => {
    expect(proxy(post({ path: "/API/x", origin: "http://localhost:5173" })).status).toBe(403);
  });

  it("fails closed (treats as API) on an unparsable percent-escape", () => {
    expect(proxy(post({ path: "/%zz/x", origin: "http://localhost:5173" })).status).toBe(403);
  });
});

describe("proxy: Cache-Control", () => {
  it("sets no-store on API responses only, leaving non-API responses untouched", () => {
    const apiRes = proxy(request({ path: "/api/x" }));
    expect(apiRes.headers.get("Cache-Control")).toBe("no-store");

    const pageRes = proxy(request({ path: "/some-page" }));
    expect(pageRes.headers.get("Cache-Control")).toBeNull();
  });
});
