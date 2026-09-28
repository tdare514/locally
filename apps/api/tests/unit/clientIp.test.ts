import { describe, expect, it } from "vitest";
import { clientIp } from "../../src/server/http/clientIp";

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request("http://localhost/x", { headers });
}

describe("clientIp", () => {
  it("returns the first hop of a comma-separated x-forwarded-for list", () => {
    const request = requestWithHeaders({ "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" });
    expect(clientIp(request)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const request = requestWithHeaders({ "x-real-ip": "203.0.113.9" });
    expect(clientIp(request)).toBe("203.0.113.9");
  });

  it("returns \"unknown\" when neither header is present", () => {
    const request = requestWithHeaders({});
    expect(clientIp(request)).toBe("unknown");
  });
});
