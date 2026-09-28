import { beforeEach, describe, expect, it } from "vitest";
import { createDb, migrateDb, type Db } from "../../../src/db/client";
import { DbRateLimiter } from "../../../src/server/ratelimit/DbRateLimiter";

describe("DbRateLimiter", () => {
  let db: Db;

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateDb(db);
  });

  it("allows up to the limit within the window, then blocks", async () => {
    const limiter = new DbRateLimiter(db, 3, 1000, "test", () => 0);
    expect(await limiter.consume("a")).toBe(true);
    expect(await limiter.consume("a")).toBe(true);
    expect(await limiter.consume("a")).toBe(true);
    expect(await limiter.consume("a")).toBe(false);
  });

  it("allows attempts again once the window has passed", async () => {
    let now = 0;
    const limiter = new DbRateLimiter(db, 1, 1000, "test", () => now);
    expect(await limiter.consume("a")).toBe(true);
    expect(await limiter.consume("a")).toBe(false);

    now += 1001;
    expect(await limiter.consume("a")).toBe(true);
  });

  it("tracks keys and namespaces independently", async () => {
    const now = () => 0;
    const limiterA = new DbRateLimiter(db, 1, 1000, "ns-a", now);
    const limiterB = new DbRateLimiter(db, 1, 1000, "ns-b", now);

    expect(await limiterA.consume("shared-key")).toBe(true);
    // A different key within the same namespace is independent.
    expect(await limiterA.consume("other-key")).toBe(true);
    // The same key under a different namespace is also independent.
    expect(await limiterB.consume("shared-key")).toBe(true);
    // But the first namespace/key pair is now exhausted.
    expect(await limiterA.consume("shared-key")).toBe(false);
  });

  it("shares its count across separate instances backed by the same db", async () => {
    const now = 0;
    const limiter1 = new DbRateLimiter(db, 2, 1000, "shared", () => now);
    const limiter2 = new DbRateLimiter(db, 2, 1000, "shared", () => now);

    expect(await limiter1.consume("a")).toBe(true);
    expect(await limiter2.consume("a")).toBe(true);
    // The limit (2) has now been reached across both instances combined.
    expect(await limiter1.consume("a")).toBe(false);
    expect(await limiter2.consume("a")).toBe(false);
  });
});
