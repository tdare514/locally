import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings, Release, SyncStatus } from "../../../src/shared/types";
import type { Services } from "../../../src/server/container";
import { SyncAuthError, type MeResult, type SyncApi, type VerifyCodeResult } from "../../../src/server/sync/SyncApi";
import { NotFoundError } from "../../../src/shared/errors";
import { emptySyncState, type SyncState, type SyncStateStore } from "../../../src/server/sync/SyncState";
import type { SyncRecord } from "../../../src/server/sync/SyncRecord";

// `vi.mock` factories are hoisted above these imports by Vitest; `services`
// below is read lazily (only when a route handler actually calls
// `getServices()`), so the temporal-dead-zone concern doesn't apply.
let services: Services;

vi.mock("../../../src/server/container", () => ({
  getServices: () => services,
}));

// Imported after the mock so every route resolves `../../../../server/container`
// (their own relative path) to the mocked module above - Vitest matches by
// resolved absolute file, not by the literal specifier string.
import { POST as codePOST } from "../../../src/app/api/sync/code/route";
import { POST as verifyPOST } from "../../../src/app/api/sync/verify/route";
import { POST as signoutPOST } from "../../../src/app/api/sync/signout/route";
import { DELETE as deleteAccountDELETE } from "../../../src/app/api/sync/account/route";
import { GET as statusGET } from "../../../src/app/api/sync/status/route";
import { POST as reconcilePOST } from "../../../src/app/api/sync/reconcile/route";
import { POST as acceptPOST } from "../../../src/app/api/sync/accept/[id]/route";

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

let requestCodeCalls: string[];
let verifyCodeCalls: { email: string; code: string }[];
let revokeDeviceCalls: string[];
let deleteAccountCalls: string[];
let deleteAccountBehavior: "ok" | "authError" | "networkError";

class FakeSyncApi implements Partial<SyncApi> {
  async requestCode(email: string): Promise<void> {
    requestCodeCalls.push(email);
  }
  async verifyCode(email: string, code: string): Promise<VerifyCodeResult> {
    verifyCodeCalls.push({ email, code });
    return { token: "tok-123", user: { id: "u1", email }, device: { id: "dev-1", name: "Toby's MacBook" } };
  }
  async me(): Promise<MeResult> {
    return {
      user: { id: "u1", email: "a@b.com" },
      device: { id: "dev-1", name: "Toby's MacBook" },
      quota: { usedBytes: 10, limitBytes: 1_000_000_000 },
      devices: [],
    };
  }
  async revokeDevice(deviceId: string): Promise<void> {
    revokeDeviceCalls.push(deviceId);
  }
  async deleteAccount(email: string): Promise<void> {
    deleteAccountCalls.push(email);
    if (deleteAccountBehavior === "authError") {
      throw new SyncAuthError("Sync sign-in has expired; please sign in again");
    }
    if (deleteAccountBehavior === "networkError") {
      throw new Error("network unreachable");
    }
  }
}

const fakeSyncApi = new FakeSyncApi() as unknown as SyncApi;

/** In-memory `SyncStateStore` fake, following `tests/unit/SyncEngine.test.ts`. */
class FakeSyncStateStore implements SyncStateStore {
  private state: SyncState = emptySyncState();
  async get(): Promise<SyncState> {
    return {
      pushedUpdatedAt: { ...this.state.pushedUpdatedAt },
      uploadedFiles: Object.fromEntries(Object.entries(this.state.uploadedFiles).map(([k, v]) => [k, [...v]])),
      coverHash: { ...this.state.coverHash },
      pendingFromPhone: { ...this.state.pendingFromPhone },
    };
  }
  async set(state: SyncState): Promise<SyncState> {
    this.state = state;
    return state;
  }
}

const fixedStatus: SyncStatus = {
  signedIn: true,
  email: "a@b.com",
  baseUrl: "http://localhost:4000",
  deviceName: "Toby's MacBook",
  lastRunAt: null,
  lastError: null,
  pendingFromPhone: [],
  quota: null,
};

let syncEngine: { status: ReturnType<typeof vi.fn>; reconcile: ReturnType<typeof vi.fn>; acceptFromPhone: ReturnType<typeof vi.fn> };
let syncState: FakeSyncStateStore;

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  settingsValue = { libraryDir: "/tmp/lib", sync: null };
  requestCodeCalls = [];
  verifyCodeCalls = [];
  revokeDeviceCalls = [];
  deleteAccountCalls = [];
  deleteAccountBehavior = "ok";
  syncEngine = {
    status: vi.fn().mockResolvedValue(fixedStatus),
    reconcile: vi.fn().mockResolvedValue(undefined),
    acceptFromPhone: vi.fn(),
  };
  syncState = new FakeSyncStateStore();
  services = {
    settings: new FakeSettingsStore(),
    syncApiFactory: () => fakeSyncApi,
    syncEngine,
    syncState,
  } as unknown as Services;
});

describe("POST /api/sync/code", () => {
  it("requests a code for a valid email", async () => {
    const res = await codePOST(jsonRequest("http://localhost/api/sync/code", { email: "a@b.com" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(requestCodeCalls).toEqual(["a@b.com"]);
  });

  it("rejects a missing/invalid email", async () => {
    const res = await codePOST(jsonRequest("http://localhost/api/sync/code", { email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(requestCodeCalls).toEqual([]);
  });
});

describe("POST /api/sync/verify", () => {
  it("stores the device token and returns the public settings shape (no token)", async () => {
    const res = await verifyPOST(
      jsonRequest("http://localhost/api/sync/verify", { email: "a@b.com", code: "123456" })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sync: { signedIn: boolean; email: string | null } };
    expect(body.sync.signedIn).toBe(true);
    expect(body.sync.email).toBe("a@b.com");
    expect((body as Record<string, unknown>).deviceToken).toBeUndefined();

    expect(verifyCodeCalls).toEqual([{ email: "a@b.com", code: "123456" }]);
    expect(settingsValue.sync?.deviceToken).toBe("tok-123");
    expect(syncEngine.reconcile).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing code", async () => {
    const res = await verifyPOST(jsonRequest("http://localhost/api/sync/verify", { email: "a@b.com" }));
    expect(res.status).toBe(400);
    expect(verifyCodeCalls).toEqual([]);
  });
});

describe("POST /api/sync/signout", () => {
  it("revokes the device remotely and clears the local token", async () => {
    settingsValue = {
      libraryDir: "/tmp/lib",
      sync: { baseUrl: "http://localhost:4000", deviceToken: "tok-123", email: "a@b.com", lastVersion: 5 },
    };

    const res = await signoutPOST();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });

    expect(revokeDeviceCalls).toEqual(["dev-1"]);
    expect(settingsValue.sync?.deviceToken).toBeNull();
    expect(settingsValue.sync?.email).toBeNull();
  });

  it("is a no-op when already signed out", async () => {
    const res = await signoutPOST();
    expect(res.status).toBe(200);
    expect(revokeDeviceCalls).toEqual([]);
  });

  it("clears pre-seeded local sync state", async () => {
    settingsValue = {
      libraryDir: "/tmp/lib",
      sync: { baseUrl: "http://localhost:4000", deviceToken: "tok-123", email: "a@b.com", lastVersion: 5 },
    };
    await syncState.set({
      pushedUpdatedAt: { "rel-1": "2026-01-01T00:00:00.000Z" },
      uploadedFiles: {},
      coverHash: {},
      pendingFromPhone: { "rel-2": {} as SyncRecord },
    });

    const res = await signoutPOST();
    expect(res.status).toBe(200);

    const state = await syncState.get();
    expect(state.pushedUpdatedAt).toEqual({});
    expect(state.pendingFromPhone).toEqual({});
  });
});

describe("DELETE /api/sync/account", () => {
  beforeEach(() => {
    settingsValue = {
      libraryDir: "/tmp/lib",
      sync: { baseUrl: "http://localhost:4000", deviceToken: "tok-123", email: "a@b.com", lastVersion: 5 },
    };
  });

  it("deletes the account and clears local state on success", async () => {
    await syncState.set({
      pushedUpdatedAt: { "rel-1": "2026-01-01T00:00:00.000Z" },
      uploadedFiles: {},
      coverHash: {},
      pendingFromPhone: { "rel-2": {} as SyncRecord },
    });

    const res = await deleteAccountDELETE();
    expect(res.status).toBe(200);

    const body = (await res.json()) as { sync: { signedIn: boolean; email: string | null }; ok: boolean };
    expect(body.sync.signedIn).toBe(false);
    expect(body.sync.email).toBeNull();
    expect((body as Record<string, unknown>).deviceToken).toBeUndefined();
    expect(body.ok).toBe(true);

    expect(deleteAccountCalls).toEqual(["a@b.com"]);
    expect(settingsValue.sync?.deviceToken).toBeNull();
    expect(settingsValue.sync?.email).toBeNull();
    expect(settingsValue.sync?.lastVersion).toBe(0);

    const state = await syncState.get();
    expect(state.pushedUpdatedAt).toEqual({});
    expect(state.pendingFromPhone).toEqual({});
  });

  it("is 400 when not signed in", async () => {
    settingsValue = { libraryDir: "/tmp/lib", sync: null };
    const res = await deleteAccountDELETE();
    expect(res.status).toBe(400);
    expect(deleteAccountCalls).toEqual([]);
  });

  it("changes nothing and returns an error on a network failure", async () => {
    deleteAccountBehavior = "networkError";
    const res = await deleteAccountDELETE();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(settingsValue.sync?.deviceToken).toBe("tok-123");
    expect(settingsValue.sync?.email).toBe("a@b.com");
  });

  it("clears local state and flags alreadySignedOut when the token is already invalid", async () => {
    deleteAccountBehavior = "authError";
    const res = await deleteAccountDELETE();
    expect(res.status).toBe(200);

    const body = (await res.json()) as { alreadySignedOut?: boolean };
    expect(body.alreadySignedOut).toBe(true);

    expect(settingsValue.sync?.deviceToken).toBeNull();
    expect(settingsValue.sync?.email).toBeNull();
  });
});

describe("GET /api/sync/status", () => {
  it("returns the engine's status", async () => {
    const res = await statusGET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(fixedStatus);
    expect(syncEngine.status).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/sync/reconcile", () => {
  it("runs a reconcile pass and returns the fresh status", async () => {
    const res = await reconcilePOST();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(fixedStatus);
    expect(syncEngine.reconcile).toHaveBeenCalledTimes(1);
    expect(syncEngine.status).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/sync/accept/[id]", () => {
  it("imports the pending release and returns it", async () => {
    const release = { id: "rel-1" } as Release;
    syncEngine.acceptFromPhone.mockResolvedValue(release);

    const res = await acceptPOST(new NextRequest("http://localhost/api/sync/accept/rel-1", { method: "POST" }), {
      params: Promise.resolve({ id: "rel-1" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, release });
    expect(syncEngine.acceptFromPhone).toHaveBeenCalledWith("rel-1");
  });

  it("returns 404 when there is nothing pending for that id", async () => {
    syncEngine.acceptFromPhone.mockRejectedValue(new NotFoundError("No pending release rel-404 from your phone"));

    const res = await acceptPOST(new NextRequest("http://localhost/api/sync/accept/rel-404", { method: "POST" }), {
      params: Promise.resolve({ id: "rel-404" }),
    });

    expect(res.status).toBe(404);
  });
});
