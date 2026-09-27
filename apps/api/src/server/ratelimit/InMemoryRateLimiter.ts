import type { RateLimiter } from "./RateLimiter";

/**
 * Fixed-window-of-timestamps rate limiter: each key keeps the timestamps of
 * its recent attempts, drops any older than `windowMs`, and is allowed
 * through only if fewer than `limit` remain. Process-local (a `Map`), which
 * is all a single dev instance or a single Fluid Compute instance needs;
 * see `RateLimiter` for the production swap-out point.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now()
  ) {}

  async consume(key: string): Promise<boolean> {
    const now = this.now();
    const cutoff = now - this.windowMs;
    const existing = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

    if (existing.length >= this.limit) {
      this.hits.set(key, existing);
      return false;
    }

    existing.push(now);
    this.hits.set(key, existing);
    return true;
  }
}
