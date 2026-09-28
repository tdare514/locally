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
});
