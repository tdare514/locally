import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../../../src/shared/types";
import type { Services } from "../../../src/server/container";
import type { SpotifySourceDetector } from "../../../src/server/spotify/SpotifySourceDetector";

let services: Services;

vi.mock("../../../src/server/container", () => ({
  getServices: () => services,
}));

import { GET as sourceGET } from "../../../src/app/api/spotify/source/route";
import { POST as dismissPOST } from "../../../src/app/api/spotify/source/dismiss/route";

let settingsValue: Settings;
let watchingValue: boolean;

class FakeSettingsStore {
  async get(): Promise<Settings> {
    return settingsValue;
  }
  async set(next: Settings): Promise<Settings> {
    settingsValue = next;
    return next;
  }
}

class FakeDetector implements SpotifySourceDetector {
  async isWatching(): Promise<boolean> {
    return watchingValue;
  }
}

beforeEach(() => {
  settingsValue = { libraryDir: "/tmp/lib", sync: null };
  watchingValue = false;
  services = {
    settings: new FakeSettingsStore(),
    spotify: new FakeDetector(),
  } as unknown as Services;
});

describe("GET /api/spotify/source", () => {
  it("returns libraryDir, watching, and dismissed", async () => {
    watchingValue = true;
    settingsValue = { libraryDir: "/tmp/lib", sync: null, spotifySourceDismissed: false };

    const res = await sourceGET();
    const body = (await res.json()) as { libraryDir: string; watching: boolean; dismissed: boolean };
    expect(body).toEqual({ libraryDir: "/tmp/lib", watching: true, dismissed: false });
  });

  it("defaults dismissed to false when unset", async () => {
    const res = await sourceGET();
    const body = (await res.json()) as { dismissed: boolean };
    expect(body.dismissed).toBe(false);
  });

  it("treats a detector error as watching: false rather than failing", async () => {
    services.spotify = {
      isWatching: async () => {
        throw new Error("boom");
      },
    } as unknown as SpotifySourceDetector;

    const res = await sourceGET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { watching: boolean };
    expect(body.watching).toBe(false);
  });
});

describe("POST /api/spotify/source/dismiss", () => {
  it("persists spotifySourceDismissed: true and returns dismissed: true", async () => {
    const res = await dismissPOST();
    expect(res.status).toBe(200);
    expect(settingsValue.spotifySourceDismissed).toBe(true);

    const body = (await res.json()) as { dismissed: boolean; libraryDir: string };
    expect(body.dismissed).toBe(true);
    expect(body.libraryDir).toBe("/tmp/lib");
  });

  it("preserves the rest of settings when dismissing", async () => {
    settingsValue = {
      libraryDir: "/tmp/lib",
      sync: { baseUrl: "http://localhost:4000", deviceToken: "tok", email: "a@b.com", lastVersion: 2 },
    };

    await dismissPOST();
    expect(settingsValue.sync).toEqual({
      baseUrl: "http://localhost:4000",
      deviceToken: "tok",
      email: "a@b.com",
      lastVersion: 2,
    });
  });
});
