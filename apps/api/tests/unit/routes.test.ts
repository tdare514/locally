import crypto from "node:crypto";
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

function jsonRequest(url: string, method: string, body?: unknown, token?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signIn(email: string, deviceName = "Toby's MacBook"): Promise<{ token: string; userId: string; deviceId: string }> {
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

describe("routes (through the exported handler functions, no server)", () => {
  beforeAll(async () => {
    testServices = await createTestServices();
  });

  it("POST /v1/auth/code rejects a malformed email with 400", async () => {
    const res = await authCodeRoute.POST(jsonRequest("http://localhost/v1/auth/code", "POST", { email: "nope" }));
    expect(res.status).toBe(400);
  });

  it("POST /v1/auth/verify rejects a wrong code with 401", async () => {
    await authCodeRoute.POST(jsonRequest("http://localhost/v1/auth/code", "POST", { email: "wrong-code@example.com" }));
    const res = await authVerifyRoute.POST(
      jsonRequest("http://localhost/v1/auth/verify", "POST", {
        email: "wrong-code@example.com",
        code: "000000",
        deviceName: "Mac",
        platform: "mac",
      })
    );
    expect(res.status).toBe(401);
  });

  it("signs in and calls GET /v1/me", async () => {
    const { token, deviceId } = await signIn("me-route@example.com");

    const res = await meRoute.GET(new Request("http://localhost/v1/me", { headers: { authorization: `Bearer ${token}` } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe("me-route@example.com");
    expect(body.device.id).toBe(deviceId);
    expect(body.quota).toEqual({ usedBytes: 0, limitBytes: 1024 * 1024 * 1024 });
    expect(body.devices).toHaveLength(1);
  });

  it("GET /v1/me without a token is 401", async () => {
    const res = await meRoute.GET(new Request("http://localhost/v1/me"));
    expect(res.status).toBe(401);
  });

  it("full release lifecycle: PUT (create), PUT (conflict), PUT (update), files, list, delete", async () => {
    const { token, userId } = await signIn("lifecycle@example.com");
    const record = makeReleaseRecord();

    // Create.
    const putRes = await releaseRoute.PUT(
      jsonRequest(`http://localhost/v1/releases/${record.id}`, "PUT", record, token),
      { params: Promise.resolve({ id: record.id }) }
    );
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({ version: 1 });

    // Same updatedAt again -> 409.
    const conflictRes = await releaseRoute.PUT(
      jsonRequest(`http://localhost/v1/releases/${record.id}`, "PUT", record, token),
      { params: Promise.resolve({ id: record.id }) }
    );
    expect(conflictRes.status).toBe(409);

    // Newer updatedAt -> version 2.
    const updated = { ...record, title: "Retitled", updatedAt: new Date(Date.parse(record.updatedAt) + 1000).toISOString() };
    const updateRes = await releaseRoute.PUT(
      jsonRequest(`http://localhost/v1/releases/${record.id}`, "PUT", updated, token),
      { params: Promise.resolve({ id: record.id }) }
    );
    expect(await updateRes.json()).toEqual({ version: 2 });

    // Body id must match the URL id.
    const mismatchRes = await releaseRoute.PUT(
      jsonRequest(`http://localhost/v1/releases/${record.id}`, "PUT", { ...record, id: crypto.randomUUID() }, token),
      { params: Promise.resolve({ id: record.id }) }
    );
    expect(mismatchRes.status).toBe(400);

    // Request upload URLs for its one track.
    const track = record.tracks[0]!;
    const uploadRes = await filesRoute.POST(
      jsonRequest(`http://localhost/v1/releases/${record.id}/files`, "POST", {
        files: [{ name: track.file, bytes: track.bytes, contentType: "audio/mpeg" }],
      }, token),
      { params: Promise.resolve({ id: record.id }) }
    );
    expect(uploadRes.status).toBe(200);
    const uploadBody = await uploadRes.json();
    expect(uploadBody.uploads).toHaveLength(1);
    expect(uploadBody.uploads[0].name).toBe(track.file);
    expect(uploadBody.uploads[0].url).toContain("/v1/internal/local-upload/");

    // A download URL exists once the file is registered (even before the
    // bytes are actually uploaded — see ReleaseFilesService's docstring).
    const downloadRes = await fileDownloadRoute.GET(
      new Request(`http://localhost/v1/releases/${record.id}/files/${encodeURIComponent(track.file)}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({ id: record.id, name: track.file }) }
    );
    expect(downloadRes.status).toBe(200);
    const downloadBody = await downloadRes.json();
    expect(downloadBody.url).toContain("/v1/internal/local-download/");

    // GET /v1/me now reports the file's bytes against quota.
    const meRes = await meRoute.GET(new Request("http://localhost/v1/me", { headers: { authorization: `Bearer ${token}` } }));
    expect((await meRes.json()).quota.usedBytes).toBe(track.bytes);

    // List since 0 sees the release at version 2.
    const listRes = await releasesListRoute.GET(
      new Request("http://localhost/v1/releases?sinceVersion=0", { headers: { authorization: `Bearer ${token}` } })
    );
    const listBody = await listRes.json();
    expect(listBody.nextVersion).toBe(2);
    expect(listBody.releases.find((r: { id: string }) => r.id === record.id)?.version).toBe(2);

    // Delete -> tombstone at version 3, visible in a subsequent list.
    const deleteRes = await releaseRoute.DELETE(
      new Request(`http://localhost/v1/releases/${record.id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } }),
      { params: Promise.resolve({ id: record.id }) }
    );
    expect(await deleteRes.json()).toEqual({ version: 3 });

    const afterDelete = await releasesListRoute.GET(
      new Request(`http://localhost/v1/releases?sinceVersion=2`, { headers: { authorization: `Bearer ${token}` } })
    );
    const afterDeleteBody = await afterDelete.json();
    expect(afterDeleteBody.releases).toHaveLength(1);
    expect(afterDeleteBody.releases[0].deleted).toBe(true);

    void userId;
  });

  it("a release id already owned by one user 404s for another user", async () => {
    const alice = await signIn("alice@example.com");
    const bob = await signIn("bob@example.com");
    const record = makeReleaseRecord();

    await releaseRoute.PUT(jsonRequest(`http://localhost/v1/releases/${record.id}`, "PUT", record, alice.token), {
      params: Promise.resolve({ id: record.id }),
    });

    const bobsAttempt = await releaseRoute.PUT(
      jsonRequest(`http://localhost/v1/releases/${record.id}`, "PUT", { ...record, artist: "Someone Else" }, bob.token),
      { params: Promise.resolve({ id: record.id }) }
    );
    expect(bobsAttempt.status).toBe(404);

    const bobsDelete = await releaseRoute.DELETE(
      new Request(`http://localhost/v1/releases/${record.id}`, { method: "DELETE", headers: { authorization: `Bearer ${bob.token}` } }),
      { params: Promise.resolve({ id: record.id }) }
    );
    expect(bobsDelete.status).toBe(404);
  });

  it("rejects uploading a file over quota with a non-2xx status", async () => {
    const { token } = await signIn("quota-route@example.com");
    const record = makeReleaseRecord();
    await releaseRoute.PUT(jsonRequest(`http://localhost/v1/releases/${record.id}`, "PUT", record, token), {
      params: Promise.resolve({ id: record.id }),
    });

    const res = await filesRoute.POST(
      jsonRequest(`http://localhost/v1/releases/${record.id}/files`, "POST", {
        files: [{ name: "huge.mp3", bytes: 2 * 1024 * 1024 * 1024, contentType: "audio/mpeg" }],
      }, token),
      { params: Promise.resolve({ id: record.id }) }
    );
    expect(res.status).toBe(400);
  });

  it("DELETE /v1/devices/:id revokes the token used to make future requests", async () => {
    const { token, deviceId } = await signIn("revoke-route@example.com");

    const revokeRes = await devicesRoute.DELETE(
      new Request(`http://localhost/v1/devices/${deviceId}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } }),
      { params: Promise.resolve({ id: deviceId }) }
    );
    expect(revokeRes.status).toBe(200);

    const meRes = await meRoute.GET(new Request("http://localhost/v1/me", { headers: { authorization: `Bearer ${token}` } }));
    expect(meRes.status).toBe(401);
  });
});
