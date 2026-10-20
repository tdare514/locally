import crypto from "node:crypto";

/** Timing-safe compare of the request's bearer header against the expected `Bearer <secret>`. */
export function isValidCronBearer(header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
