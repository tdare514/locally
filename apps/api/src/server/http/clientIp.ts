/**
 * Best-effort client IP for rate limiting. On Vercel, the first hop of
 * `x-forwarded-for` is trustworthy: Vercel's edge overwrites this header
 * with the true client IP and drops whatever value a client sent, so it
 * can't be spoofed there. Behind any other proxy this must be revisited —
 * an unverified client-supplied header would let a single client claim a
 * fresh IP, and so a fresh rate-limit bucket, on every request.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  return real ?? "unknown";
}
