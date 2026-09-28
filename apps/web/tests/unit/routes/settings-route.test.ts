import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../../../src/shared/types";
import type { Services } from "../../../src/server/container";

let services: Services;

vi.mock("../../../src/server/container", () => ({
  getServices: () => services,
}));

import { GET, PUT } from "../../../src/app/api/settings/route";

let settingsValue: Settings;

class FakeSettingsStore {
  async get(): Promise<Settings> {
    return settingsValue;
  }
  async set(next: Settings): Promise<Settings> {
    settingsValue = next;
    return next;
  }
}

function putRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  settingsValue = { libraryDir: "/tmp/lib", sync: null };
  services = { settings: new FakeSettingsStore() } as unknown as Services;
});

describe("GET /api/settings", () => {
  it("never returns the device token, and defaults sync fields when unset", async () => {
    const res = await GET();
    const body = (await res.json()) as { libraryDir: string; sync: Record<string, unknown> };
    expect(body.libraryDir).toBe("/tmp/lib");
    expect(body.sync).toEqual({
      baseUrl: "http://localhost:4000",
      email: null,
      signedIn: false,
      lastVersion: 0,
    });
    expect(body.sync.deviceToken).toBeUndefined();
  });

  it("reports signedIn without leaking the token when one is set", async () => {
    settingsValue = {
      libraryDir: "/tmp/lib",
      sync: { baseUrl: "http://localhost:4000", deviceToken: "secret-token", email: "a@b.com", lastVersion: 3 },
    };
    const res = await GET();
    const body = (await res.json()) as { sync: { signedIn: boolean; lastVersion: number } };
    expect(body.sync.signedIn).toBe(true);
    expect(body.sync.lastVersion).toBe(3);
    expect(JSON.stringify(body)).not.toContain("secret-token");
  });
});

describe("PUT /api/settings", () => {
  it("updates libraryDir", async () => {
    const res = await PUT(putRequest({ libraryDir: "/tmp/new-lib" }));
    expect(res.status).toBe(200);
    expect(settingsValue.libraryDir).toBe("/tmp/new-lib");
  });

  it("rejects a relative libraryDir", async () => {
    const res = await PUT(putRequest({ libraryDir: "relative/path" }));
    expect(res.status).toBe(400);
  });

  it("updates sync.baseUrl without requiring libraryDir, preserving any existing token", async () => {
    settingsValue = {
      libraryDir: "/tmp/lib",
      sync: { baseUrl: "http://localhost:4000", deviceToken: "secret-token", email: "a@b.com", lastVersion: 3 },
    };

    const res = await PUT(putRequest({ sync: { baseUrl: "http://example.com:5000" } }));
    expect(res.status).toBe(200);

    expect(settingsValue.libraryDir).toBe("/tmp/lib");
    expect(settingsValue.sync?.baseUrl).toBe("http://example.com:5000");
    expect(settingsValue.sync?.deviceToken).toBe("secret-token");
    expect(settingsValue.sync?.lastVersion).toBe(3);

    const body = (await res.json()) as { sync: { baseUrl: string } };
    expect(body.sync.baseUrl).toBe("http://example.com:5000");
  });

  it("creates a sync settings object from just a baseUrl when none exists yet", async () => {
    const res = await PUT(putRequest({ sync: { baseUrl: "http://localhost:9999" } }));
    expect(res.status).toBe(200);
    expect(settingsValue.sync).toEqual({
      baseUrl: "http://localhost:9999",
      deviceToken: null,
      email: null,
      lastVersion: 0,
    });
  });

  it("rejects an invalid sync.baseUrl", async () => {
    const res = await PUT(putRequest({ sync: { baseUrl: "not a url" } }));
    expect(res.status).toBe(400);
  });

  it("rejects an empty body", async () => {
    const res = await PUT(putRequest({}));
    expect(res.status).toBe(400);
  });

  it("resets spotifySourceDismissed to false when libraryDir changes, but preserves it when only sync.baseUrl changes", async () => {
    settingsValue = { libraryDir: "/tmp/lib", sync: null, spotifySourceDismissed: true };

    const changedDir = await PUT(putRequest({ libraryDir: "/tmp/new-lib" }));
    expect(changedDir.status).toBe(200);
    expect(settingsValue.spotifySourceDismissed).toBe(false);

    settingsValue = { libraryDir: "/tmp/lib", sync: null, spotifySourceDismissed: true };

    const changedSync = await PUT(putRequest({ sync: { baseUrl: "http://localhost:9999" } }));
    expect(changedSync.status).toBe(200);
    expect(settingsValue.spotifySourceDismissed).toBe(true);
  });
});
