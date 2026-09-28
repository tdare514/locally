import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestServices, type TestServices } from "../support/testServices";

let testServices: TestServices;

// Hoisted by vitest above every import in this file, so the route module
// below (which imports `server/container`) resolves to this fake.
vi.mock("../../src/server/container", () => ({
  getServices: async () => testServices,
}));

import * as cleanupRoute from "../../src/app/v1/internal/cleanup/route";

describe("GET /v1/internal/cleanup", () => {
  beforeAll(async () => {
    testServices = await createTestServices();
  });

  afterEach(() => {
    testServices.cronSecret = undefined;
  });

  it("200s with the correct bearer secret", async () => {
    testServices.cronSecret = "test-cron-secret";
    const res = await cleanupRoute.GET(
      new Request("http://localhost/v1/internal/cleanup", { headers: { authorization: "Bearer test-cron-secret" } })
    );
    expect(res.status).toBe(200);
  });

  it("401s with the wrong bearer secret", async () => {
    testServices.cronSecret = "test-cron-secret";
    const res = await cleanupRoute.GET(
      new Request("http://localhost/v1/internal/cleanup", { headers: { authorization: "Bearer wrong-secret" } })
    );
    expect(res.status).toBe(401);
  });

  it("401s with no authorization header", async () => {
    testServices.cronSecret = "test-cron-secret";
    const res = await cleanupRoute.GET(new Request("http://localhost/v1/internal/cleanup"));
    expect(res.status).toBe(401);
  });

  it("200s with no header when cronSecret is undefined", async () => {
    testServices.cronSecret = undefined;
    const res = await cleanupRoute.GET(new Request("http://localhost/v1/internal/cleanup"));
    expect(res.status).toBe(200);
  });

  function parseJsonLines(calls: unknown[][]): Record<string, unknown>[] {
    return calls.flatMap((c) => {
      try {
        return [JSON.parse(c[0] as string)];
      } catch {
        return []; // ignore plain-text warnings unrelated to structured logging (e.g. the unset-CRON_SECRET notice)
      }
    });
  }

  it("logs a storage_total line at info when under the alert threshold", async () => {
    testServices.cronSecret = "test-cron-secret";
    testServices.storageAlertBytes = 1024;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await cleanupRoute.GET(
      new Request("http://localhost/v1/internal/cleanup", { headers: { authorization: "Bearer test-cron-secret" } })
    );

    const storageLine = parseJsonLines(logSpy.mock.calls).find((l) => l.event === "storage_total");
    expect(storageLine).toMatchObject({ level: "info", event: "storage_total", alertBytes: 1024 });
    expect(parseJsonLines(warnSpy.mock.calls).find((l) => l.event === "storage_total")).toBeUndefined();

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("logs a storage_total line at warn when at or over the alert threshold", async () => {
    testServices.cronSecret = "test-cron-secret";
    testServices.storageAlertBytes = 0;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await cleanupRoute.GET(
      new Request("http://localhost/v1/internal/cleanup", { headers: { authorization: "Bearer test-cron-secret" } })
    );

    const storageLine = parseJsonLines(warnSpy.mock.calls).find((l) => l.event === "storage_total");
    expect(storageLine).toMatchObject({ level: "warn", event: "storage_total", alertBytes: 0 });

    warnSpy.mockRestore();
  });
});
