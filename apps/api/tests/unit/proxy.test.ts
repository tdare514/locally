import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "../../src/proxy";

describe("proxy", () => {
  it("sets x-request-id on an OPTIONS preflight response", () => {
    const req = new NextRequest("http://localhost/v1/me", {
      method: "OPTIONS",
      headers: { origin: "http://localhost:3000" },
    });
    const res = proxy(req);
    expect(res.status).toBe(204);
    expect(res.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });

  it("sets x-request-id on the response and replaces a client-supplied value on the forwarded request", () => {
    const req = new NextRequest("http://localhost/v1/me", {
      method: "GET",
      headers: { origin: "http://localhost:3000", "x-request-id": "client-supplied-value" },
    });
    const res = proxy(req);
    const responseId = res.headers.get("x-request-id");
    expect(responseId).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(responseId).not.toBe("client-supplied-value");

    const forwardedId = res.headers.get("x-middleware-request-x-request-id");
    expect(forwardedId).toBe(responseId);
    expect(forwardedId).not.toBe("client-supplied-value");
  });
});
