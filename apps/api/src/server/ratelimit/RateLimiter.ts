/**
 * A rate limiter keyed by an arbitrary string (an email or an IP address).
 * Kept behind an interface so callers never depend on the storage strategy:
 * `DbRateLimiter`, backed by the app's own libSQL database, is the shared
 * implementation used in production (safe across Vercel instances);
 * `InMemoryRateLimiter` is process-local and used in tests and dev.
 */
export interface RateLimiter {
  /**
   * Record one attempt for `key` and report whether it's allowed.
   * Returns `true` if this attempt is within the limit, `false` if `key` has
   * already used up its quota for the current window.
   */
  consume(key: string): Promise<boolean>;
}
