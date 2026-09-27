/**
 * A sliding-window rate limiter keyed by an arbitrary string (an email or an
 * IP address). Kept behind an interface so the in-memory implementation —
 * fine for a single Vercel Fluid Compute instance during development, but
 * not shared across instances — can later be swapped for a KV-backed one
 * without touching the routes that call it.
 */
export interface RateLimiter {
  /**
   * Record one attempt for `key` and report whether it's allowed.
   * Returns `true` if this attempt is within the limit, `false` if `key` has
   * already used up its quota for the current window.
   */
  consume(key: string): Promise<boolean>;
}
