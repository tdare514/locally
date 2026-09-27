import { NextRequest, NextResponse } from "next/server";
import { corsHeaders, isOriginAllowed } from "./server/http/cors";

/**
 * CORS for the Mac web app. Duplicated as a tiny parse here (rather than
 * importing `server/config/env.ts`) because Proxy is meant to run standalone
 * ahead of the rest of the app — see the "Good to know" note in Next's own
 * `proxy.js` docs about not relying on shared modules/globals here.
 */
function parseAllowedOrigins(raw: string | undefined): string[] {
  const value = raw && raw.trim().length > 0 ? raw : "http://localhost:*,http://127.0.0.1:*";
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

export function proxy(req: NextRequest) {
  const origin = req.headers.get("origin");
  const allowed = origin !== null && isOriginAllowed(origin, ALLOWED_ORIGINS);

  // Preflight: answer directly, with CORS headers only if the origin is allowed.
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: allowed && origin ? corsHeaders(origin) : {} });
  }

  const res = NextResponse.next();
  if (allowed && origin) {
    for (const [key, value] of Object.entries(corsHeaders(origin))) {
      res.headers.set(key, value);
    }
  }
  return res;
}

export const config = {
  matcher: ["/v1/:path*"],
};
