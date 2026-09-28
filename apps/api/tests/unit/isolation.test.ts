import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestServices, type TestServices } from "../support/testServices";
import { makeReleaseRecord } from "../support/fixtures";

let testServices: TestServices;

// Hoisted by vitest above every import in this file, so the route modules
// below (which import `server/container`) all resolve to this fake.
vi.mock("../../src/server/container", () => ({
  getServices: async () => testServices,
}));

import * as authCodeRoute from "../../src/app/v1/auth/code/route";
import * as authVerifyRoute from "../../src/app/v1/auth/verify/route";
import * as meRoute from "../../src/app/v1/me/route";
import * as devicesRoute from "../../src/app/v1/devices/[id]/route";
import * as releasesListRoute from "../../src/app/v1/releases/route";
import * as releaseRoute from "../../src/app/v1/releases/[id]/route";
import * as filesRoute from "../../src/app/v1/releases/[id]/files/route";
import * as fileDownloadRoute from "../../src/app/v1/releases/[id]/files/[name]/route";
import * as localUploadRoute from "../../src/app/v1/internal/local-upload/[...key]/route";

function jsonRequest(url: string, method: string, body?: unknown, token?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signIn(email: string, deviceName = "Device"): Promise<{ token: string; userId: string; deviceId: string }> {
  const codeRes = await authCodeRoute.POST(jsonRequest("http://localhost/v1/auth/code", "POST", { email }));
  expect(codeRes.status).toBe(200);

  const code = testServices.mailer.codeFor(email);
  const verifyRes = await authVerifyRoute.POST(
    jsonRequest("http://localhost/v1/auth/verify", "POST", { email, code, deviceName, platform: "mac" })
  );
  expect(verifyRes.status).toBe(200);
  const body = (await verifyRes.json()) as { token: string; user: { id: string }; device: { id: string } };
  return { token: body.token, userId: body.user.id, deviceId: body.device.id };
}

describe("cross-user isolation", () => {
  beforeAll(async () => {
    testServices = await createTestServices();
  });

  it("keeps every route scoped to the authenticated user's own data", async () => {
    const alice = await signIn("alice-iso@example.com", "Alice's Mac");
    const bob = await signIn("bob-iso@example.com", "Bob's iPhone");

    const record = makeReleaseRecord();
    const track = record.tracks[0]!;

    // Alice creates a release and actually uploads its track's bytes.
    const createRes = await releaseRoute.PUT(
      jsonRequest(`http://localhost/v1/releases/${record.id}`, "PUT", record, alice.token),
      { params: Promise.resolve({ id: record.id }) }
    );
    expect(createRes.status).toBe(200);
    expect(await createRes.json()).toEqual({ version: 1 });

    const aliceUploadsRes = await filesRoute.POST(
      jsonRequest(`http://localhost/v1/releases/${record.id}/files`, "POST", {
        files: [{ name: track.file, bytes: track.bytes, contentType: "audio/mpeg" }],
      }, alice.token),
      { params: Promise.resolve({ id: record.id }) }
    );
    expect(aliceUploadsRes.status).toBe(200);
    const aliceUploads = (await aliceUploadsRes.json()) as { uploads: Array<{ name: string; url: string }> };
    const uploadUrl = aliceUploads.uploads[0]!.url;
    // The signature covers the raw (unencoded) key string, so extract it by
    // splitting the URL text itself rather than round-tripping through
    // `new URL()`, which would percent-encode the spaces in the file name.
    const uploadKey = uploadUrl.split("/v1/internal/local-upload/")[1]!.split("?")[0]!;
    const uploadPut = await localUploadRoute.PUT(
      new Request(uploadUrl, { method: "PUT", body: new Uint8Array(track.bytes), headers: { "content-type": "audio/mpeg" } }),
      { params: Promise.resolve({ key: uploadKey.split("/") }) }
    );
    expect(uploadPut.status).toBe(200);

    // --- Bob attacks every route with Alice's release/device ids. ---

    const cases: Array<{ name: string; run: () => Promise<Response> }> = [
      {
        name: "PUT (write) release/:id",
        run: () =>
          releaseRoute.PUT(
            jsonRequest(`http://localhost/v1/releases/${record.id}`, "PUT", { ...record, artist: "Someone Else" }, bob.token),
            { params: Promise.resolve({ id: record.id }) }
          ),
      },
      {
        name: "DELETE release/:id",
        run: () =>
          releaseRoute.DELETE(
            new Request(`http://localhost/v1/releases/${record.id}`, { method: "DELETE", headers: { authorization: `Bearer ${bob.token}` } }),
            { params: Promise.resolve({ id: record.id }) }
          ),
      },
      {
        name: "POST release/:id/files (request upload URLs)",
        run: () =>
          filesRoute.POST(
            jsonRequest(`http://localhost/v1/releases/${record.id}/files`, "POST", {
              files: [{ name: track.file, bytes: track.bytes, contentType: "audio/mpeg" }],
            }, bob.token),
            { params: Promise.resolve({ id: record.id }) }
          ),
      },
      {
        name: "GET release/:id/files/:name (download URL)",
        run: () =>
          fileDownloadRoute.GET(
            new Request(`http://localhost/v1/releases/${record.id}/files/${encodeURIComponent(track.file)}`, {
              headers: { authorization: `Bearer ${bob.token}` },
            }),
            { params: Promise.resolve({ id: record.id, name: track.file }) }
          ),
      },
      {
        name: "DELETE devices/:id (Alice's device)",
        run: () =>
          devicesRoute.DELETE(
            new Request(`http://localhost/v1/devices/${alice.deviceId}`, { method: "DELETE", headers: { authorization: `Bearer ${bob.token}` } }),
            { params: Promise.resolve({ id: alice.deviceId }) }
          ),
      },
    ];

    for (const { name, run } of cases) {
      const res = await run();
      expect(res.status, `${name} should 404, not leak existence via another status`).toBe(404);
    }

    // GET /v1/releases (list) never includes Alice's release for Bob.
    const bobList = await releasesListRoute.GET(
      new Request("http://localhost/v1/releases?sinceVersion=0", { headers: { authorization: `Bearer ${bob.token}` } })
    );
    expect(bobList.status).toBe(200);
    const bobListBody = await bobList.json();
    expect(bobListBody.releases.find((r: { id: string }) => r.id === record.id)).toBeUndefined();

    // GET /v1/me for Bob never lists Alice's devices.
    const bobMe = await meRoute.GET(new Request("http://localhost/v1/me", { headers: { authorization: `Bearer ${bob.token}` } }));
    expect(bobMe.status).toBe(200);
    const bobMeBody = await bobMe.json();
    expect(bobMeBody.devices).toHaveLength(1);
    expect(bobMeBody.devices[0].id).not.toBe(alice.deviceId);

    // --- Alice's data and device are entirely unaffected by Bob's attempts. ---

    const aliceList = await releasesListRoute.GET(
      new Request("http://localhost/v1/releases?sinceVersion=0", { headers: { authorization: `Bearer ${alice.token}` } })
    );
    const aliceListBody = await aliceList.json();
    const aliceRelease = aliceListBody.releases.find((r: { id: string }) => r.id === record.id);
    expect(aliceRelease).toBeDefined();
    expect(aliceRelease.version).toBe(1);
    expect(aliceRelease.deleted).toBe(false);
    expect(aliceRelease.artist).toBe(record.artist);

    const aliceMe = await meRoute.GET(new Request("http://localhost/v1/me", { headers: { authorization: `Bearer ${alice.token}` } }));
    expect(aliceMe.status).toBe(200);

    const aliceDownload = await fileDownloadRoute.GET(
      new Request(`http://localhost/v1/releases/${record.id}/files/${encodeURIComponent(track.file)}`, {
        headers: { authorization: `Bearer ${alice.token}` },
      }),
      { params: Promise.resolve({ id: record.id, name: track.file }) }
    );
    expect(aliceDownload.status).toBe(200);
  });
});
