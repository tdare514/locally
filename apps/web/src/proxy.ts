import { NextRequest, NextResponse } from "next/server";

/**
 * Security boundary for a local-only server that writes to the user's disk.
 *
 * 1. Host must be loopback. Defends against DNS rebinding (the network defence,
 *    binding to 127.0.0.1, lives in package.json's `dev`/`start` scripts).
 * 2. Mutating API requests must carry an Origin/Referer that is exactly this
 *    server's own origin (scheme, host and port). A malicious website open in the
 *    user's browser cannot then drive our API - browsers always attach Origin on
 *    cross-site POST/PUT/PATCH/DELETE - and neither can a page on another loopback
 *    port such as a dev server on localhost:5173.
 * 3. Baseline hardening headers on every response.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** `new URL(value)`, or null when `value` is missing or not an absolute URL (including the literal "null" Origin). */
function parseUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function proxy(req: NextRequest) {
  // This server only speaks plain http, so the Host header is our whole origin.
  // Not `req.nextUrl.origin`: Next rewrites 127.0.0.1 and [::1] to "localhost"
  // there, which would break the exact compare below for a page loaded via the IP.
  const own = parseUrl(`http://${req.headers.get("host") ?? ""}`);
  if (!own || !LOOPBACK_HOSTS.has(own.hostname)) {
    return NextResponse.json({ error: "This app only accepts local connections" }, { status: 403 });
  }

  const isApi = req.nextUrl.pathname.startsWith("/api/");
  if (isApi && MUTATING.has(req.method)) {
    // Same-origin fetches from our own page always send Origin (Referer is the
    // fallback for the odd client that sends only that). A missing, unparsable or
    // "null" origin never equals ours, so it is rejected like a foreign one.
    const sender = parseUrl(req.headers.get("origin") ?? req.headers.get("referer"));
    if (!sender || sender.origin !== own.origin) {
      return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
    }
  }

  const res = NextResponse.next();
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Cache-Control", isApi ? "no-store" : res.headers.get("Cache-Control") ?? "");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
