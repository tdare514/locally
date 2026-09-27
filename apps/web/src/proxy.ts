import { NextRequest, NextResponse } from "next/server";

/**
 * Security boundary for a local-only server that writes to the user's disk.
 *
 * 1. Host must be loopback. Prevents DNS-rebinding and accidental LAN exposure.
 * 2. Mutating API requests must carry an Origin/Referer from this same loopback host.
 *    A malicious website open in the user's browser cannot then drive our API
 *    (browsers always attach Origin on cross-site POST/PUT/PATCH/DELETE).
 * 3. Baseline hardening headers on every response.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function hostnameOf(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return null;
  }
}

function isLoopback(hostname: string | null): boolean {
  return hostname !== null && LOOPBACK_HOSTS.has(hostname);
}

export function proxy(req: NextRequest) {
  const host = hostnameOf(req.headers.get("host"));
  if (!isLoopback(host)) {
    return NextResponse.json({ error: "This app only accepts local connections" }, { status: 403 });
  }

  const isApi = req.nextUrl.pathname.startsWith("/api/");
  if (isApi && MUTATING.has(req.method)) {
    const origin = req.headers.get("origin") ?? req.headers.get("referer");
    let originHost: string | null = null;
    if (origin) {
      try {
        originHost = new URL(origin).hostname;
      } catch {
        originHost = null;
      }
    }
    // Same-origin fetches from our own page always send Origin. Reject anything else.
    if (!isLoopback(originHost)) {
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
