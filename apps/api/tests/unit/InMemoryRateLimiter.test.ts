import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "../../src/server/ratelimit/InMemoryRateLimiter";

describe("InMemoryRateLimiter", () => {
  it("allows up to the limit within the window, then blocks", async () => {
    const limiter = new InMemoryRateLimiter(3, 1000, () => 0);
    expect(await limiter.consume("a")).toBe(true);
    expect(await limiter.consume("a")).toBe(true);
    expect(await limiter.consume("a")).toBe(true);
    expect(await limiter.consume("a")).toBe(false);
  });

  it("tracks each key independently", async () => {
    const limiter = new InMemoryRateLimiter(1, 1000, () => 0);
    expect(await limiter.consume("a")).toBe(true);
    expect(await limiter.consume("b")).toBe(true);
    expect(await limiter.consume("a")).toBe(false);
  });

  it("allows attempts again once the window has passed", async () => {
    let now = 0;
    const limiter = new InMemoryRateLimiter(1, 1000, () => now);
    expect(await limiter.consume("a")).toBe(true);
    expect(await limiter.consume("a")).toBe(false);

    now += 1001;
    expect(await limiter.consume("a")).toBe(true);
  });
});
