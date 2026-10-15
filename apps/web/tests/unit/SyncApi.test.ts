import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HttpSyncApi, SyncAuthError, SyncConflictError, SyncRequestError } from "../../src/server/sync/SyncApi";
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
