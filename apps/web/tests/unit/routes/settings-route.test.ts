import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../../../src/shared/types";
import type { Services } from "../../../src/server/container";
import { emptySyncState, type SyncState, type SyncStateStore } from "../../../src/server/sync/SyncState";
import type { SyncRecord } from "../../../src/server/sync/SyncRecord";
import { FakePlayCountStore } from "../FakePlayCountStore";

let services: Services;
let forgetFriends = vi.fn();

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
  async update(mutator: (current: Settings) => Settings | null): Promise<Settings> {
    const next = mutator(settingsValue);
    if (next) settingsValue = next;
    return settingsValue;
  }
}

/** In-memory `SyncStateStore` fake, following `tests/unit/SyncEngine.test.ts`. */
class FakeSyncStateStore implements SyncStateStore {
  private state: SyncState = emptySyncState();
  async get(): Promise<SyncState> {
    return {
      pushedUpdatedAt: { ...this.state.pushedUpdatedAt },
      uploadedFiles: Object.fromEntries(Object.entries(this.state.uploadedFiles).map(([k, v]) => [k, [...v]])),
      coverHash: { ...this.state.coverHash },
      pendingFromPhone: { ...this.state.pendingFromPhone },
      missingFiles: { ...this.state.missingFiles },
      hiddenFromTray: { ...this.state.hiddenFromTray },
    };
  }
  async set(state: SyncState): Promise<SyncState> {
    this.state = { ...state, hiddenFromTray: this.state.hiddenFromTray };
    return state;
  }
  async update(mutator: (current: SyncState) => SyncState | null): Promise<SyncState> {
    const next = mutator(await this.get());
    if (next) this.state = next;
    return this.state;
  }
}

function putRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

let syncState: FakeSyncStateStore;
let playTracker: { setEnabled: ReturnType<typeof vi.fn> };
let playStore: FakePlayCountStore;
let playEvents: { resetPushed: ReturnType<typeof vi.fn> };

beforeEach(() => {
  settingsValue = { libraryDir: "/tmp/lib", sync: null };
  syncState = new FakeSyncStateStore();
  playTracker = { setEnabled: vi.fn() };
  playStore = new FakePlayCountStore();
  playEvents = { resetPushed: vi.fn().mockResolvedValue(undefined) };
  forgetFriends = vi.fn().mockResolvedValue(undefined);
  services = {
    settings: new FakeSettingsStore(),
    syncState,
    playTracker,
    playStore,
    playEvents,
    syncEngine: { forgetFriends },
  } as unknown as Services;
});

describe("GET /api/settings", () => {
  it("never returns the device token, and defaults sync fields when unset", async () => {
    const res = await GET();
    const body = (await res.json()) as { libraryDir: string; sync: Record<string, unknown> };
    expect(body.libraryDir).toBe("/tmp/lib");
    expect(body.sync).toEqual({
      baseUrl: "https://locally-sync-api.vercel.app",
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

describe("trackPlays setting", () => {
  it("is exposed by GET, false by default", async () => {
    const body = (await (await GET()).json()) as { trackPlays: boolean };
    expect(body.trackPlays).toBe(false);
  });

  it("PUT updates it and tells the tracker", async () => {
    const res = await PUT(putRequest({ trackPlays: true }));
    expect(res.status).toBe(200);
    expect(settingsValue.trackPlays).toBe(true);
    expect(((await res.json()) as { trackPlays: boolean }).trackPlays).toBe(true);
    expect(playTracker.setEnabled).toHaveBeenCalledWith(true);
  });

  it("PUT rejects a non-boolean", async () => {
    const res = await PUT(putRequest({ trackPlays: "yes" }));
    expect(res.status).toBe(400);
    expect(playTracker.setEnabled).not.toHaveBeenCalled();
  });
});

describe("countOtherDevices setting (#228)", () => {
  it("is exposed by GET, false by default", async () => {
    const body = (await (await GET()).json()) as { countOtherDevices: boolean };
    expect(body.countOtherDevices).toBe(false);
  });

  it("PUT round-trips it", async () => {
    const res = await PUT(putRequest({ countOtherDevices: true }));
    expect(res.status).toBe(200);
    expect(settingsValue.countOtherDevices).toBe(true);
    expect(((await res.json()) as { countOtherDevices: boolean }).countOtherDevices).toBe(true);
    expect(((await (await GET()).json()) as { countOtherDevices: boolean }).countOtherDevices).toBe(true);
  });

  it("PUT rejects a non-boolean", async () => {
    const res = await PUT(putRequest({ countOtherDevices: "yes" }));
    expect(res.status).toBe(400);
  });
});

describe("playsPromptAnswered setting", () => {
  it("is exposed by GET, false by default", async () => {
    const body = (await (await GET()).json()) as { playsPromptAnswered: boolean };
    expect(body.playsPromptAnswered).toBe(false);
  });

  it("Not now: PUT saves it without turning counting on", async () => {
    const res = await PUT(putRequest({ playsPromptAnswered: true }));
    expect(res.status).toBe(200);
    expect(settingsValue.playsPromptAnswered).toBe(true);
    expect(settingsValue.trackPlays).toBe(false);
    expect(await res.json()).toMatchObject({ playsPromptAnswered: true, trackPlays: false });
    expect(playTracker.setEnabled).toHaveBeenCalledWith(false);
    expect(((await (await GET()).json()) as { playsPromptAnswered: boolean }).playsPromptAnswered).toBe(true);
  });

  it("Turn on: PUT saves both and starts the tracker", async () => {
    const res = await PUT(putRequest({ trackPlays: true, playsPromptAnswered: true }));
    expect(res.status).toBe(200);
    expect(settingsValue).toMatchObject({ trackPlays: true, playsPromptAnswered: true });
    expect(playTracker.setEnabled).toHaveBeenCalledWith(true);
  });

  it("PUT rejects a non-boolean", async () => {
    const res = await PUT(putRequest({ playsPromptAnswered: "yes" }));
    expect(res.status).toBe(400);
    expect(settingsValue.playsPromptAnswered).toBeUndefined();
  });
});

describe("PUT /api/settings", () => {
  it("updates libraryDir", async () => {
    const res = await PUT(putRequest({ libraryDir: "/tmp/new-lib" }));
    expect(res.status).toBe(200);
    expect(settingsValue.libraryDir).toBe("/tmp/new-lib");
  });

  it("keeps the friends list on an unrelated save, and forgets it only when the sync state resets", async () => {
    settingsValue = {
      libraryDir: "/tmp/lib",
      sync: { baseUrl: "http://localhost:4000", deviceToken: "t", email: "a@b.com", lastVersion: 1 },
    };
    await PUT(putRequest({ libraryDir: "/tmp/other-lib" }));
    await PUT(putRequest({ trackPlays: true }));
    expect(forgetFriends).not.toHaveBeenCalled();
    await PUT(putRequest({ sync: { baseUrl: "http://localhost:5000" } }));
    expect(forgetFriends).toHaveBeenCalledTimes(1);
  });

  it("rejects a relative libraryDir", async () => {
    const res = await PUT(putRequest({ libraryDir: "relative/path" }));
    expect(res.status).toBe(400);
  });

  it("changing sync.baseUrl to a new host without requiring libraryDir, signs the Mac out", async () => {
    settingsValue = {
      libraryDir: "/tmp/lib",
      sync: { baseUrl: "http://localhost:4000", deviceToken: "secret-token", email: "a@b.com", lastVersion: 3 },
    };

    const res = await PUT(putRequest({ sync: { baseUrl: "https://sync.example.com" } }));
    expect(res.status).toBe(200);

    expect(settingsValue.libraryDir).toBe("/tmp/lib");
    expect(settingsValue.sync).toEqual({
      baseUrl: "https://sync.example.com",
      deviceToken: null,
      email: null,
      lastVersion: 0,
    });

    const body = (await res.json()) as { sync: { baseUrl: string; signedIn: boolean } };
    expect(body.sync.baseUrl).toBe("https://sync.example.com");
    expect(body.sync.signedIn).toBe(false);
  });

  it("keeps the install ID across a sync host change and never returns it (#210)", async () => {
    const installId = "33333333-3333-4333-8333-333333333333";
    settingsValue = {
      libraryDir: "/tmp/lib",
      installId,
      sync: { baseUrl: "http://localhost:4000", deviceToken: "secret-token", email: "a@b.com", lastVersion: 3 },
    };

    const put = await PUT(putRequest({ sync: { baseUrl: "https://sync.example.com" } }));
    expect(put.status).toBe(200);
    expect(settingsValue.installId).toBe(installId);
    expect(JSON.stringify(await put.json())).not.toContain(installId);

    const get = await GET();
    expect(JSON.stringify(await get.json())).not.toContain(installId);
  });

  it("changing sync.baseUrl to a different https host clears pre-seeded local sync state", async () => {
    settingsValue = {
      libraryDir: "/tmp/lib",
      sync: { baseUrl: "http://localhost:4000", deviceToken: "secret-token", email: "a@b.com", lastVersion: 3 },
    };
    await syncState.set({
      pushedUpdatedAt: { "rel-1": "2026-01-01T00:00:00.000Z" },
      uploadedFiles: {},
      coverHash: {},
      pendingFromPhone: { "rel-2": {} as SyncRecord },
      missingFiles: {},
    });

    const res = await PUT(putRequest({ sync: { baseUrl: "https://sync.example.com" } }));
    expect(res.status).toBe(200);

    const state = await syncState.get();
    expect(state.pushedUpdatedAt).toEqual({});
    expect(state.pendingFromPhone).toEqual({});
  });

  it("changing sync.baseUrl clears the pushed play markers and keeps the counts (#107)", async () => {
    settingsValue = {
      libraryDir: "/tmp/lib",
      sync: { baseUrl: "http://localhost:4000", deviceToken: "secret-token", email: "a@b.com", lastVersion: 3 },
    };
    playStore.seed("t1", "r1", 5, 5);

    const res = await PUT(putRequest({ sync: { baseUrl: "https://sync.example.com" } }));
    expect(res.status).toBe(200);

    expect((await playStore.get()).tracks).toEqual({ t1: { releaseId: "r1", count: 5, pushed: 0 } });
  });

  it("clears the pushed play markers after the new settings are saved, as sign-out does (#107)", async () => {
    settingsValue = {
      libraryDir: "/tmp/lib",
      sync: { baseUrl: "http://localhost:4000", deviceToken: "secret-token", email: "a@b.com", lastVersion: 3 },
    };
    const saved = vi.spyOn(services.settings, "update");
    const reset = vi.spyOn(playStore, "resetPushed");

    const res = await PUT(putRequest({ sync: { baseUrl: "https://sync.example.com" } }));
    expect(res.status).toBe(200);

    expect(saved).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(playEvents.resetPushed).toHaveBeenCalledTimes(1); // the play events' pushed marks go too (#398)
    expect(saved.mock.invocationCallOrder[0]).toBeLessThan(reset.mock.invocationCallOrder[0]);
  });

  it("re-saving the same sync.baseUrl leaves the pushed play markers alone (#107)", async () => {
    settingsValue = {
      libraryDir: "/tmp/lib",
      sync: { baseUrl: "http://localhost:4000", deviceToken: "secret-token", email: "a@b.com", lastVersion: 3 },
    };
    playStore.seed("t1", "r1", 5, 5);

    const res = await PUT(putRequest({ sync: { baseUrl: "http://localhost:4000" } }));
    expect(res.status).toBe(200);

    expect((await playStore.get()).tracks.t1.pushed).toBe(5);
  });

  it("re-saving the same sync.baseUrl leaves pre-seeded local sync state untouched", async () => {
    settingsValue = {
      libraryDir: "/tmp/lib",
      sync: { baseUrl: "http://localhost:4000", deviceToken: "secret-token", email: "a@b.com", lastVersion: 3 },
    };
    await syncState.set({
      pushedUpdatedAt: { "rel-1": "2026-01-01T00:00:00.000Z" },
      uploadedFiles: {},
      coverHash: {},
      pendingFromPhone: { "rel-2": {} as SyncRecord },
      missingFiles: {},
    });

    const res = await PUT(putRequest({ sync: { baseUrl: "http://localhost:4000" } }));
    expect(res.status).toBe(200);

    const state = await syncState.get();
    expect(state.pushedUpdatedAt).toEqual({ "rel-1": "2026-01-01T00:00:00.000Z" });
    expect(state.pendingFromPhone).toEqual({ "rel-2": {} as SyncRecord });
  });

  it("re-sending the current sync.baseUrl preserves the token, email, and lastVersion", async () => {
    settingsValue = {
      libraryDir: "/tmp/lib",
      sync: { baseUrl: "http://localhost:4000", deviceToken: "secret-token", email: "a@b.com", lastVersion: 3 },
    };

    const res = await PUT(putRequest({ sync: { baseUrl: "http://localhost:4000" } }));
    expect(res.status).toBe(200);

    expect(settingsValue.sync).toEqual({
      baseUrl: "http://localhost:4000",
      deviceToken: "secret-token",
      email: "a@b.com",
      lastVersion: 3,
    });

    const body = (await res.json()) as { sync: { baseUrl: string; signedIn: boolean } };
    expect(body.sync.baseUrl).toBe("http://localhost:4000");
    expect(body.sync.signedIn).toBe(true);
  });

  it("rejects a non-loopback http sync.baseUrl", async () => {
    const res = await PUT(putRequest({ sync: { baseUrl: "http://example.com:5000" } }));
    expect(res.status).toBe(400);
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
