import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const createDbMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/client")>();
  return { ...actual, createDb: createDbMock };
});

import { getServices } from "../../src/server/container";

const GLOBAL_KEY = Symbol.for("sync-api.services");

describe("getServices", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    delete (globalThis as Record<symbol, unknown>)[GLOBAL_KEY];
  });

  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[GLOBAL_KEY];
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    createDbMock.mockReset();
  });

  it("does not memoise a failed build", async () => {
    createDbMock.mockImplementationOnce(() => {
      throw new Error("database unavailable");
    });
    const actual = await vi.importActual<typeof import("../../src/db/client")>("../../src/db/client");
    createDbMock.mockImplementation(() => actual.createDb(":memory:"));

    await expect(getServices()).rejects.toThrow(/database unavailable/);
    const services = await getServices();
    expect(services.db).toBeDefined();
    expect(createDbMock).toHaveBeenCalledTimes(2);
    // A successful build is memoised.
    expect(await getServices()).toBe(services);
    expect(createDbMock).toHaveBeenCalledTimes(2);
  });

  it("wires the shared limiters for the missing-files routes at 6 an hour per user (#119)", async () => {
    const actual = await vi.importActual<typeof import("../../src/db/client")>("../../src/db/client");
    createDbMock.mockImplementation(() => actual.createDb(":memory:"));

    const { missingFilesByUser, resyncRequestByUser } = (await getServices()).rateLimiters;
    for (const limiter of [missingFilesByUser, resyncRequestByUser]) {
      for (let call = 1; call <= 6; call++) expect(await limiter.consume("user-a"), `call ${call}`).toBe(true);
      expect(await limiter.consume("user-a")).toBe(false);
      expect(await limiter.consume("user-b")).toBe(true);
    }
  });
});
