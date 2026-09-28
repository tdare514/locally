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

const REQUEST_ID_HEADER = "x-request-id";

export function proxy(req: NextRequest) {
  const origin = req.headers.get("origin");
  const allowed = origin !== null && isOriginAllowed(origin, ALLOWED_ORIGINS);
  const requestId = crypto.randomUUID();

  // Preflight: answer directly, with CORS headers only if the origin is allowed.
  if (req.method === "OPTIONS") {
    const headers = allowed && origin ? corsHeaders(origin) : {};
    return new NextResponse(null, { status: 204, headers: { ...headers, [REQUEST_ID_HEADER]: requestId } });
  }

  // Overwrite any client-supplied x-request-id before it reaches the route
  // handler, which trusts this header (see server/http/observe.ts).
  const forwardedHeaders = new Headers(req.headers);
  forwardedHeaders.set(REQUEST_ID_HEADER, requestId);

  const res = NextResponse.next({ request: { headers: forwardedHeaders } });
  res.headers.set(REQUEST_ID_HEADER, requestId);
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
