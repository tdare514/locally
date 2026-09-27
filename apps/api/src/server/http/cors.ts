/**
 * CORS for the Mac web app talking to this API from a browser. The iOS app
 * is not a browser and sends no `Origin` header, so it is unaffected either
 * way. Auth here is a bearer token the client attaches explicitly (never an
 * ambient credential like a cookie), so there is no CSRF surface to guard
 * beyond the usual "don't tell disallowed origins they're allowed".
 */

/** `pattern` is either a literal origin or one ending in `:*` to match any port. */
function originMatches(origin: string, pattern: string): boolean {
  if (pattern.endsWith(":*")) {
    const prefix = pattern.slice(0, -1); // keep the trailing ":"
    if (!origin.startsWith(prefix)) return false;
    const rest = origin.slice(prefix.length);
    return /^\d+$/.test(rest);
  }
  return origin === pattern;
}

export function isOriginAllowed(origin: string, allowedOrigins: readonly string[]): boolean {
  return allowedOrigins.some((pattern) => originMatches(origin, pattern));
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
