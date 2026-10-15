import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Services } from "../../../src/server/container";
import type { PlaysStatus } from "../../../src/shared/types";

let services: Services;
let status: PlaysStatus;

vi.mock("../../../src/server/container", () => ({
  getServices: () => services,
}));

import { GET } from "../../../src/app/api/plays/status/route";

beforeEach(() => {
  status = "off";
  services = { playTracker: { status: () => status } } as unknown as Services;
});

describe("GET /api/plays/status", () => {
  it("returns the tracker status", async () => {
    for (const s of ["off", "on", "spotify-not-running", "permission-denied"] as const) {
      status = s;
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: s });
    }
  });
});
