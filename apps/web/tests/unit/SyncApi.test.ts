import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HttpSyncApi, SyncAuthError, SyncConflictError, SyncRequestError, SyncUnavailableError } from "../../src/server/sync/SyncApi";
import { SyncRecordRejectedError } from "../../src/server/sync/SyncRecord";
import { PublicError } from "../../src/shared/errors";

interface FakeCall {
  url: string;
  init: RequestInit | undefined;
}

let calls: FakeCall[];
let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const validWireRecord = {
  syncVersion: 1,
  id: "good",
  kind: "single",
  title: "T",
  artist: "A",
  year: null,
  genre: null,
  cover: null,
  tracks: [{ id: "t1", title: "T", trackNumber: 1, file: "01 - T.mp3", bytes: 1, durationSec: null }],
  origin: "ios",
  originDevice: "iPhone",
  createdAt: "2026-09-27T20:00:00Z",
  updatedAt: "2026-09-27T20:00:00Z",
  deleted: false,
  version: 3,
};

beforeEach(() => {
  calls = [];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockNextResponse(res: Response): void {
  fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return res;
  });
}

describe("HttpSyncApi request shape", () => {
  it("requestCode POSTs to /v1/auth/code with a JSON content-type header and no auth header", async () => {
    mockNextResponse(jsonResponse({}));
    const api = new HttpSyncApi("http://localhost:4000", null);

    await api.requestCode("a@b.com");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:4000/v1/auth/code");
    expect(calls[0].init?.method).toBe("POST");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Authorization"]).toBeUndefined();
    expect(calls[0].init?.body).toBe(JSON.stringify({ email: "a@b.com" }));
  });

  it("sends a bearer Authorization header when a token is set", async () => {
    mockNextResponse(jsonResponse({ user: { id: "u1", email: "a@b.com" }, device: { id: "d1", name: "Mac" }, quota: { usedBytes: 0, limitBytes: 1 }, devices: [] }));
    const api = new HttpSyncApi("http://localhost:4000", "tok-abc");

    await api.me();

    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tok-abc");
  });

  it("me() issues a GET with no body", async () => {
    mockNextResponse(jsonResponse({ user: { id: "u1", email: "a@b.com" }, device: { id: "d1", name: "Mac" }, quota: { usedBytes: 0, limitBytes: 1 }, devices: [] }));
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    await api.me();

    expect(calls[0].url).toBe("http://localhost:4000/v1/me");
    expect(calls[0].init?.method).toBeUndefined();
    expect(calls[0].init?.body).toBeUndefined();
  });

  it("me() parses a device list with a platform this build has never heard of (#185)", async () => {
    mockNextResponse(
      jsonResponse({
        user: { id: "u1", email: "a@b.com" },
        device: { id: "d1", name: "Mac" },
        quota: { usedBytes: 0, limitBytes: 1 },
        devices: [
          { id: "d1", name: "Mac", platform: "mac" },
          { id: "d2", name: "Browser", platform: "web" },
          { id: "d3", name: "Gadget", platform: "future-thing" },
        ],
      })
    );
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    const me = await api.me();

    expect(me.devices.map((d) => d.name)).toEqual(["Mac", "Browser", "Gadget"]);
  });

  it("putRelease PUTs JSON to /v1/releases/:id with the record as the body", async () => {
    mockNextResponse(jsonResponse({ version: 5 }));
    const api = new HttpSyncApi("http://localhost:4000", "tok");
    const record = { id: "rel 1/weird" } as never;

    await api.putRelease(record);

    expect(calls[0].url).toBe("http://localhost:4000/v1/releases/rel%201%2Fweird");
    expect(calls[0].init?.method).toBe("PUT");
    expect(calls[0].init?.body).toBe(JSON.stringify(record));
  });

  it("playsSummary GETs /v1/plays/summary with from, to and the cursor, with the bearer token (#202)", async () => {
    mockNextResponse(jsonResponse({ tracks: [], allTime: [], nextCursor: null }));
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    const page = await api.playsSummary("2026-10-01", "2026-10-15", "abc");

    expect(page).toEqual({ tracks: [], allTime: [], nextCursor: null });
    expect(calls[0].url).toBe("http://localhost:4000/v1/plays/summary?from=2026-10-01&to=2026-10-15&cursor=abc");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("playsSummary throws SyncRequestError with the status on a 429", async () => {
    mockNextResponse(jsonResponse({ error: "slow" }, 429));
    const api = new HttpSyncApi("http://localhost:4000", "tok");
    await expect(api.playsSummary("2026-10-01", "2026-10-15")).rejects.toMatchObject({ status: 429 });
  });

  it("deleteRelease issues a DELETE to /v1/releases/:id", async () => {
    mockNextResponse(jsonResponse({ version: 6 }));
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    await api.deleteRelease("rel-1");

    expect(calls[0].url).toBe("http://localhost:4000/v1/releases/rel-1");
    expect(calls[0].init?.method).toBe("DELETE");
  });

  it("listReleases encodes sinceVersion and limit as query params and returns parsed releases plus nextVersion/hasMore", async () => {
    mockNextResponse(jsonResponse({ releases: [], nextVersion: 42, hasMore: true }));
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    const result = await api.listReleases(7, 200);

    expect(calls[0].url).toBe("http://localhost:4000/v1/releases?sinceVersion=7&limit=200");
    expect(result.nextVersion).toBe(42);
    expect(result.releases).toEqual([]);
    expect(result.hasMore).toBe(true);
  });

  it("listReleases treats a missing hasMore as false (an old server, or the last page)", async () => {
    mockNextResponse(jsonResponse({ releases: [], nextVersion: 42 }));
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    const result = await api.listReleases(7, 200);

    expect(result.hasMore).toBe(false);
  });

  it("listReleases keeps a record from the web or an unknown origin: the page does not fail (#185)", async () => {
    const web = { ...validWireRecord, id: "from-web", origin: "web", version: 4 };
    const future = { ...validWireRecord, id: "from-future", origin: "future-thing", version: 5 };
    mockNextResponse(jsonResponse({ releases: [validWireRecord, web, future], nextVersion: 5, hasMore: false }));
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    const result = await api.listReleases(0, 200);

    expect(result.releases.map((r) => [r.id, r.origin])).toEqual([
      ["good", "ios"],
      ["from-web", "web"],
      ["from-future", "future-thing"],
    ]);
    expect(result.nextVersion).toBe(5);
  });

  it("listReleases skips a record with a refused extension, keeps the others, and still returns nextVersion/hasMore", async () => {
    const good = validWireRecord;
    const bad = { ...good, id: "bad", tracks: [{ ...good.tracks[0], file: "01 - T.wav" }], version: 4 };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockNextResponse(jsonResponse({ releases: [good, bad], nextVersion: 5, hasMore: true }));
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    const result = await api.listReleases(0, 200);

    expect(result.releases.map((r) => r.id)).toEqual(["good"]);
    expect(result.releases[0].version).toBe(3);
    expect(result.nextVersion).toBe(5);
    expect(result.hasMore).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("bad");
    warn.mockRestore();
  });

  it("deleteAccount DELETEs /v1/me with the email as the JSON body", async () => {
    mockNextResponse(jsonResponse({}));
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    await api.deleteAccount("a@b.com");

    expect(calls[0].url).toBe("http://localhost:4000/v1/me");
    expect(calls[0].init?.method).toBe("DELETE");
    expect(calls[0].init?.body).toBe(JSON.stringify({ email: "a@b.com" }));
  });

  it("createUploads POSTs the file list to /v1/releases/:id/files", async () => {
    mockNextResponse(jsonResponse({ uploads: [] }));
    const api = new HttpSyncApi("http://localhost:4000", "tok");
    const files = [{ name: "01.mp3", bytes: 10, contentType: "audio/mpeg" }];

    await api.createUploads("rel-1", files);

    expect(calls[0].url).toBe("http://localhost:4000/v1/releases/rel-1/files");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBe(JSON.stringify({ files }));
  });

  it("downloadUrl GETs /v1/releases/:id/files/:name with both segments encoded", async () => {
    mockNextResponse(jsonResponse({ url: "https://example.com/x", expiresAt: "2026-01-01T00:00:00.000Z" }));
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    await api.downloadUrl("rel 1", "cover art.png");

    expect(calls[0].url).toBe("http://localhost:4000/v1/releases/rel%201/files/cover%20art.png");
  });

  it("revokeDevice DELETEs /v1/devices/:id", async () => {
    mockNextResponse(jsonResponse({}));
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    await api.revokeDevice("dev 1");

    expect(calls[0].url).toBe("http://localhost:4000/v1/devices/dev%201");
    expect(calls[0].init?.method).toBe("DELETE");
  });
});

describe("HttpSyncApi.verifyCode install ID (#210)", () => {
  it("sends installId in the verify body when given, and leaves it out when not", async () => {
    const result = { token: "t", user: { id: "u", email: "a@b.com" }, device: { id: "d", name: "Mac" } };
    const api = new HttpSyncApi("http://localhost:4000", null);

    mockNextResponse(jsonResponse(result));
    await api.verifyCode("a@b.com", "123456", "Mac", "mac", "55555555-5555-4555-8555-555555555555");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      email: "a@b.com",
      code: "123456",
      deviceName: "Mac",
      platform: "mac",
      installId: "55555555-5555-4555-8555-555555555555",
    });

    mockNextResponse(jsonResponse(result));
    await api.verifyCode("a@b.com", "123456", "Mac", "mac");
    expect(JSON.parse(String(calls[1]!.init?.body))).not.toHaveProperty("installId");
  });
});

describe("HttpSyncApi error mapping", () => {
  it("maps a 401 to SyncAuthError", async () => {
    mockNextResponse(new Response(JSON.stringify({ error: "expired" }), { status: 401 }));
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    await expect(api.me()).rejects.toBeInstanceOf(SyncAuthError);
  });

  it("maps a 409 to SyncConflictError", async () => {
    mockNextResponse(new Response(JSON.stringify({ error: "conflict" }), { status: 409 }));
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    await expect(api.putRelease({ id: "r1" } as never)).rejects.toBeInstanceOf(SyncConflictError);
  });

  it("maps a 404 to a generic PublicError carrying the server's message", async () => {
    mockNextResponse(new Response(JSON.stringify({ error: "Release not found" }), { status: 404 }));
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    const call = api.deleteRelease("missing");
    await expect(call).rejects.toBeInstanceOf(PublicError);
    await expect(call).rejects.toThrow("Release not found");
  });

  it("maps a 5xx to PublicError with a generic message when the body isn't JSON", async () => {
    mockNextResponse(new Response("<html>oops</html>", { status: 502 }));
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    const call = api.me();
    await expect(call).rejects.toBeInstanceOf(PublicError);
    await expect(call).rejects.toThrow("Sync request failed (502)");
  });

  it("treats a 204 response as success with no body", async () => {
    mockNextResponse(new Response(null, { status: 204 }));
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    await expect(api.revokeDevice("dev-1")).resolves.toBeUndefined();
  });

  it("listReleases rejects the whole page when a record is structurally broken (missing updatedAt)", async () => {
    mockNextResponse(
      jsonResponse({ releases: [validWireRecord, { ...validWireRecord, id: "broken", updatedAt: undefined }], nextVersion: 1 })
    );
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    const call = api.listReleases(0, 200);
    await expect(call).rejects.toBeTruthy();
    await expect(call).rejects.not.toBeInstanceOf(SyncRecordRejectedError);
  });
});

describe("HttpSyncApi.uploadFile / downloadFile", () => {
  it("uploadFile PUTs the file contents with a Content-Length header and rejects on a non-ok response", async () => {
    // Not exercised here: covered by higher-level SyncEngine tests that use
    // real temp files. This test only asserts the error path when the
    // upload target rejects the request.
    const fsPromises = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sli-syncapi-upload-"));
    const filePath = path.join(dir, "file.mp3");
    await fsPromises.writeFile(filePath, "bytes");

    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response("nope", { status: 500 });
    });

    const api = new HttpSyncApi("http://localhost:4000", "tok");
    await expect(
      api.uploadFile({ name: "file.mp3", url: "http://localhost:4000/upload", method: "PUT", headers: {} }, filePath)
    ).rejects.toBeInstanceOf(PublicError);

    await fsPromises.rm(dir, { recursive: true, force: true });
  });

  it("downloadFile rejects with PublicError on a non-ok response and does not write a file", async () => {
    const fsPromises = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sli-syncapi-download-"));
    const destPath = path.join(dir, "out.mp3");

    fetchMock.mockImplementationOnce(async () => new Response("nope", { status: 404 }));

    const api = new HttpSyncApi("http://localhost:4000", "tok");
    await expect(api.downloadFile("http://localhost:4000/dl", destPath)).rejects.toBeInstanceOf(PublicError);
    await expect(fsPromises.access(destPath)).rejects.toThrow();

    await fsPromises.rm(dir, { recursive: true, force: true });
  });
});

describe("HttpSyncApi play counts", () => {
  const entry = {
    releaseId: "3f2a6c1e-8b7d-4e5a-9c1d-2a4b6c8d0e1f",
    trackId: "a1b2c3d4-0001-4a5b-8c9d-0123456789ab",
    count: 12,
  };

  it("pushPlays PUTs { counts } to /v1/plays with the device token and returns accepted/ignored", async () => {
    mockNextResponse(jsonResponse({ accepted: 1, ignored: 0 }));
    const api = new HttpSyncApi("http://localhost:4000", "tok-123");

    await expect(api.pushPlays([entry])).resolves.toEqual({ accepted: 1, ignored: 0 });

    expect(calls[0].url).toBe("http://localhost:4000/v1/plays");
    expect(calls[0].init?.method).toBe("PUT");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tok-123");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ counts: [entry] });
  });

  it("pushPlays gives up after a timeout instead of waiting forever", async () => {
    mockNextResponse(jsonResponse({ accepted: 1, ignored: 0 }));
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    await api.pushPlays([entry]);

    const signal = calls[0].init?.signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it("pushPlays throws a SyncRequestError carrying the status on a failed response", async () => {
    const api = new HttpSyncApi("http://localhost:4000", "tok");
    for (const status of [400, 404, 422, 429, 500, 503]) {
      mockNextResponse(jsonResponse({ error: "no" }, status));
      const err = await api.pushPlays([entry]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SyncRequestError);
      expect(err).toBeInstanceOf(PublicError);
      expect((err as SyncRequestError).status).toBe(status);
    }
  });

  it("pushPlays throws SyncAuthError on 401 and PublicError on 5xx or an odd reply", async () => {
    const api = new HttpSyncApi("http://localhost:4000", "tok");
    mockNextResponse(jsonResponse({ error: "no" }, 401));
    await expect(api.pushPlays([entry])).rejects.toBeInstanceOf(SyncAuthError);
    mockNextResponse(jsonResponse({ error: "boom" }, 503));
    await expect(api.pushPlays([entry])).rejects.toBeInstanceOf(PublicError);
    mockNextResponse(jsonResponse({ accepted: "many" }));
    await expect(api.pushPlays([entry])).rejects.toBeInstanceOf(PublicError);
  });

  it("releasePlays GETs /v1/releases/:id/plays with the token and a timeout, and parses the reply", async () => {
    const body = {
      tracks: [
        {
          trackId: entry.trackId,
          total: 19,
          devices: [
            { deviceId: "d1", name: "Mac", platform: "mac", count: 12, current: true },
            { deviceId: "d2", name: "iPhone 14", platform: "ios", count: 7, current: false },
          ],
        },
      ],
    };
    mockNextResponse(jsonResponse(body));
    const api = new HttpSyncApi("http://localhost:4000", "tok-123");

    await expect(api.releasePlays(entry.releaseId)).resolves.toEqual(body);

    expect(calls[0].url).toBe(`http://localhost:4000/v1/releases/${entry.releaseId}/plays`);
    expect(calls[0].init?.method).toBeUndefined();
    expect((calls[0].init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-123");
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("releasePlays parses a device with a platform this build has never heard of (#185)", async () => {
    const body = {
      tracks: [
        {
          trackId: entry.trackId,
          total: 5,
          devices: [
            { deviceId: "d2", name: "Browser", platform: "web", count: 3, current: false },
            { deviceId: "d3", name: "Gadget", platform: "future-thing", count: 2, current: false },
          ],
        },
      ],
    };
    mockNextResponse(jsonResponse(body));
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    await expect(api.releasePlays(entry.releaseId)).resolves.toEqual(body);
  });

  it("releasePlays encodes the id and rejects a 404 and a reply of the wrong shape", async () => {
    const api = new HttpSyncApi("http://localhost:4000", "tok");
    mockNextResponse(jsonResponse({ tracks: [] }));
    await api.releasePlays("a/b");
    expect(calls[0].url).toBe("http://localhost:4000/v1/releases/a%2Fb/plays");

    mockNextResponse(jsonResponse({ error: "Not found" }, 404));
    await expect(api.releasePlays("x")).rejects.toBeInstanceOf(PublicError);
    mockNextResponse(jsonResponse({ tracks: [{ trackId: "t" }] }));
    await expect(api.releasePlays("x")).rejects.toBeInstanceOf(PublicError);
  });
});

describe("HttpSyncApi missing files (#172)", () => {
  const listed = {
    releases: [{ id: "rel-1", missing: ["01 - Intro.mp3", "cover.jpg"], recordUpdatedAt: "2026-10-15T09:00:00.000Z" }],
    checkedAt: "2026-10-15T10:00:00.000Z",
  };

  it("missingFiles GETs /v1/files/missing with the token and a timeout, and parses the list", async () => {
    mockNextResponse(jsonResponse(listed));
    const api = new HttpSyncApi("http://localhost:4000", "tok-123");

    await expect(api.missingFiles()).resolves.toEqual(listed);

    expect(calls[0].url).toBe("http://localhost:4000/v1/files/missing");
    expect(calls[0].init?.method).toBeUndefined();
    expect((calls[0].init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-123");
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("missingFiles ignores a truncated flag on the reply", async () => {
    mockNextResponse(jsonResponse({ ...listed, truncated: true }));
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    await expect(api.missingFiles()).resolves.toEqual(listed);
  });

  it("missingFiles reads a healthy account's empty list", async () => {
    mockNextResponse(jsonResponse({ releases: [], checkedAt: "2026-10-15T10:00:00.000Z" }));
    const api = new HttpSyncApi("http://localhost:4000", "tok");

    await expect(api.missingFiles()).resolves.toEqual({ releases: [], checkedAt: "2026-10-15T10:00:00.000Z" });
  });

  it("a 404 from either route means an API from before #170: null, not an error", async () => {
    const api = new HttpSyncApi("http://localhost:4000", "tok");
    mockNextResponse(new Response("<html>Not found</html>", { status: 404 }));
    await expect(api.missingFiles()).resolves.toBeNull();
    mockNextResponse(jsonResponse({ error: "Not found" }, 404));
    await expect(api.requestResync()).resolves.toBeNull();
  });

  it("a 429 on either route is a SyncRequestError carrying the status, so callers can wait", async () => {
    const api = new HttpSyncApi("http://localhost:4000", "tok");
    mockNextResponse(jsonResponse({ error: "Too many requests" }, 429));
    const missingErr = await api.missingFiles().catch((e: unknown) => e);
    expect(missingErr).toBeInstanceOf(SyncRequestError);
    expect((missingErr as SyncRequestError).status).toBe(429);

    mockNextResponse(jsonResponse({ error: "Too many requests" }, 429));
    const resyncErr = await api.requestResync().catch((e: unknown) => e);
    expect(resyncErr).toBeInstanceOf(SyncRequestError);
    expect((resyncErr as SyncRequestError).status).toBe(429);
  });

  it("missingFiles throws SyncAuthError on 401 and PublicError on an odd reply", async () => {
    const api = new HttpSyncApi("http://localhost:4000", "tok");
    mockNextResponse(jsonResponse({ error: "no" }, 401));
    await expect(api.missingFiles()).rejects.toBeInstanceOf(SyncAuthError);
    mockNextResponse(jsonResponse({ releases: "none" }));
    await expect(api.missingFiles()).rejects.toBeInstanceOf(PublicError);
  });

  it("requestResync POSTs /v1/files/resync-request with the token and no body", async () => {
    mockNextResponse(jsonResponse({ resyncRequestedAt: "2026-10-15T10:01:00.000Z" }));
    const api = new HttpSyncApi("http://localhost:4000", "tok-123");

    await expect(api.requestResync()).resolves.toEqual({ resyncRequestedAt: "2026-10-15T10:01:00.000Z" });

    expect(calls[0].url).toBe("http://localhost:4000/v1/files/resync-request");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBeUndefined();
    expect((calls[0].init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-123");
  });
});

describe("Spotify link calls (#307)", () => {
  it("POST /v1/spotify/link sends the time zone with the token and returns the address", async () => {
    mockNextResponse(jsonResponse({ authorizeUrl: "https://accounts.spotify.com/authorize?state=x" }));
    const api = new HttpSyncApi("https://sync.example", "tok");
    await expect(api.spotifyLinkStart("Europe/London")).resolves.toEqual({
      authorizeUrl: "https://accounts.spotify.com/authorize?state=x",
    });
    expect(calls[0].url).toBe("https://sync.example/v1/spotify/link");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ timeZone: "Europe/London" });
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("GET /v1/spotify/link reads each state, and maps an unknown problem to reconnect", async () => {
    const api = new HttpSyncApi("https://sync.example", "tok");
    mockNextResponse(jsonResponse({ linked: false }));
    await expect(api.spotifyLinkStatus()).resolves.toEqual({ linked: false });
    mockNextResponse(jsonResponse({ linked: true, since: "s", lastSampleAt: "l", problem: null }));
    await expect(api.spotifyLinkStatus()).resolves.toEqual({ linked: true, since: "s", lastSampleAt: "l", problem: null });
    mockNextResponse(jsonResponse({ linked: true, since: "s", lastSampleAt: null, problem: "rateLimited" }));
    await expect(api.spotifyLinkStatus()).resolves.toMatchObject({ problem: "rateLimited" });
    mockNextResponse(jsonResponse({ linked: true, since: "s", lastSampleAt: null, problem: "somethingNew" }));
    await expect(api.spotifyLinkStatus()).resolves.toMatchObject({ problem: "reconnect" });
  });

  it("DELETE /v1/spotify/link accepts a 204", async () => {
    mockNextResponse(new Response(null, { status: 204 }));
    await expect(new HttpSyncApi("https://sync.example", "tok").spotifyUnlink()).resolves.toBeUndefined();
    expect(calls[0].init?.method).toBe("DELETE");
  });

  it("answers a 404 with a typed unavailable on all three calls", async () => {
    const api = new HttpSyncApi("https://sync.example", "tok");
    for (const call of [() => api.spotifyLinkStart("UTC"), () => api.spotifyLinkStatus(), () => api.spotifyUnlink()]) {
      mockNextResponse(jsonResponse({ error: "Not found" }, 404));
      await expect(call()).rejects.toBeInstanceOf(SyncUnavailableError);
    }
  });

  it("keeps the usual errors: 401 is a sign-in error, 429 carries its status", async () => {
    const api = new HttpSyncApi("https://sync.example", "tok");
    mockNextResponse(jsonResponse({ error: "no" }, 401));
    await expect(api.spotifyLinkStatus()).rejects.toBeInstanceOf(SyncAuthError);
    mockNextResponse(jsonResponse({ error: "slow down" }, 429));
    await expect(api.spotifyLinkStart("UTC")).rejects.toMatchObject({ status: 429 });
  });
});
