import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestServices, type TestServices } from "../support/testServices";

let testServices: TestServices;

// Hoisted by vitest above every import in this file, so the route modules
// below (which import `server/container`) all resolve to this fake.
vi.mock("../../src/server/container", () => ({
  getServices: async () => testServices,
}));

import * as meRoute from "../../src/app/v1/me/route";
import { withObservability } from "../../src/server/http/observe";

function jsonRequest(url: string, method: string, headers?: Record<string, string>): Request {
  return new Request(url, { method, headers });
}

describe("withObservability", () => {
  beforeAll(async () => {
    testServices = await createTestServices();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("a successful response carries x-request-id", async () => {
    const res = await withObservability("/v1/ok", async () => Response.json({ ok: true }))(
      jsonRequest("http://localhost/v1/ok", "GET")
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });

  it("honours a valid incoming x-request-id header", async () => {
    const incoming = "abcdefgh-1234-5678";
    const res = await withObservability("/v1/ok", async () => Response.json({ ok: true }))(
      jsonRequest("http://localhost/v1/ok", "GET", { "x-request-id": incoming })
    );
    expect(res.headers.get("x-request-id")).toBe(incoming);
  });

  it("rejects a malformed incoming x-request-id header and generates its own", async () => {
    const res = await withObservability("/v1/ok", async () => Response.json({ ok: true }))(
      jsonRequest("http://localhost/v1/ok", "GET", { "x-request-id": "bad id!" })
    );
    const generated = res.headers.get("x-request-id");
    expect(generated).not.toBe("bad id!");
    expect(generated).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });

  it("a 401 logs one warn JSON line with requestId/route/status/durationMs and no Authorization token", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const secretToken = "super-secret-bearer-token";
    const res = await meRoute.GET(
      new Request("http://localhost/v1/me", { headers: { authorization: `Bearer ${secretToken}` } })
    );
    expect(res.status).toBe(401);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(warnSpy.mock.calls[0]?.[0] as string);
    expect(line).toMatchObject({ level: "warn", route: "/v1/me", method: "GET", status: 401, userId: null });
    expect(typeof line.requestId).toBe("string");
    expect(typeof line.durationMs).toBe("number");

    const serialized = JSON.stringify(line);
    expect(serialized).not.toContain(secretToken);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("an unknown thrown error returns a generic 500 body and logs one error line", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const handler = withObservability("/v1/boom", async () => {
      throw new TypeError("kaboom");
    });
    const res = await handler(jsonRequest("http://localhost/v1/boom", "GET"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Internal server error" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(errorSpy.mock.calls[0]?.[0] as string);
    expect(line).toMatchObject({ level: "error", route: "/v1/boom", status: 500 });
    expect(line.error).toBe("TypeError: kaboom");
  });
});
