import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanupTestServices, createTestServices, type TestServices } from "../support/testServices";
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
import * as releaseRoute from "../../src/app/v1/releases/[id]/route";
import * as filesRoute from "../../src/app/v1/releases/[id]/files/route";
import * as localUploadRoute from "../../src/app/v1/internal/local-upload/[...key]/route";
import * as missingRoute from "../../src/app/v1/files/missing/route";
import * as resyncRoute from "../../src/app/v1/files/resync-request/route";

function jsonRequest(url: string, method: string, body?: unknown, token?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signIn(email: string): Promise<{ token: string; userId: string }> {
  const codeRes = await authCodeRoute.POST(jsonRequest("http://localhost/v1/auth/code", "POST", { email }));
  expect(codeRes.status).toBe(200);
  await new Promise<void>((r) => queueMicrotask(() => r()));

  const code = testServices.mailer.codeFor(email);
  const verifyRes = await authVerifyRoute.POST(
    jsonRequest("http://localhost/v1/auth/verify", "POST", { email, code, deviceName: "Device", platform: "mac" })
  );
  expect(verifyRes.status).toBe(200);
  const body = (await verifyRes.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

beforeAll(async () => {
  testServices = await createTestServices();
});

afterAll(async () => {
  await cleanupTestServices(testServices);
});

const getMissing = (token?: string) =>
  missingRoute.GET(
    new Request("http://localhost/v1/files/missing", { headers: token ? { authorization: `Bearer ${token}` } : {} })
  );

const postResync = (token?: string) =>
  resyncRoute.POST(
    new Request("http://localhost/v1/files/resync-request", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  );

const getMe = (token: string) =>
  meRoute.GET(new Request("http://localhost/v1/me", { headers: { authorization: `Bearer ${token}` } }));

describe("GET /v1/files/missing", () => {
  it("is 401 without a token", async () => {
    const res = await getMissing();
    expect(res.status).toBe(401);
  });

  it("returns an empty list and a checkedAt for an account with no releases", async () => {
    const { token } = await signIn("missing-empty@example.com");
    const res = await getMissing(token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { releases: unknown[]; checkedAt: string };
    expect(body.releases).toEqual([]);
    expect(new Date(body.checkedAt).toISOString()).toBe(body.checkedAt);
  });

  it("follows a file from no row, to a row with no blob, to stored", async () => {
    const { token } = await signIn("missing-flow@example.com");
    const record = makeReleaseRecord();
    const track = record.tracks[0]!;
    const params = { params: Promise.resolve({ id: record.id }) };

    const put = await releaseRoute.PUT(jsonRequest(`http://localhost/v1/releases/${record.id}`, "PUT", record, token), params);
    expect(put.status).toBe(200);

    // The record is on the server and no file is: no row.
    let body = await (await getMissing(token)).json();
    expect(body.releases).toEqual([{ id: record.id, missing: [track.file], recordUpdatedAt: record.updatedAt }]);

    // A ticket is issued, which writes the row, but nothing has been uploaded: still missing.
    const ticketRes = await filesRoute.POST(
      jsonRequest(
        `http://localhost/v1/releases/${record.id}/files`,
        "POST",
        { files: [{ name: track.file, bytes: track.bytes, contentType: "audio/mpeg" }] },
        token
      ),
      params
    );
    expect(ticketRes.status).toBe(200);
    body = await (await getMissing(token)).json();
    expect(body.releases).toHaveLength(1);

    // The bytes arrive: stored, so the release drops out.
    const { uploads } = (await ticketRes.json()) as { uploads: Array<{ url: string }> };
    const uploadUrl = uploads[0]!.url;
    const uploadKey = uploadUrl.split("/v1/internal/local-upload/")[1]!.split("?")[0]!;
    const uploaded = await localUploadRoute.PUT(
      new Request(uploadUrl, { method: "PUT", body: new Uint8Array(track.bytes), headers: { "content-type": "audio/mpeg" } }),
      { params: Promise.resolve({ key: uploadKey.split("/") }) }
    );
    expect(uploaded.status).toBe(200);
    body = await (await getMissing(token)).json();
    expect(body.releases).toEqual([]);
  });

  it("answers the 7th call within an hour with 429, and only for that account", async () => {
    const { token } = await signIn("missing-limit@example.com");
    for (let call = 1; call <= 6; call++) {
      expect((await getMissing(token)).status, `call ${call}`).toBe(200);
    }
    const limited = await getMissing(token);
    expect(limited.status).toBe(429);
    expect(typeof (await limited.json()).error).toBe("string");

    // Another account has its own allowance.
    const other = await signIn("missing-limit-other@example.com");
    expect((await getMissing(other.token)).status).toBe(200);
  });

  it("does not spend the resync-request allowance, or the other way round", async () => {
    const { token } = await signIn("missing-limit-split@example.com");
    for (let call = 1; call <= 6; call++) await getMissing(token);
    expect((await getMissing(token)).status).toBe(429);
    expect((await postResync(token)).status).toBe(200);
  });
});

describe("POST /v1/files/resync-request", () => {
  it("is 401 without a token", async () => {
    const res = await postResync();
    expect(res.status).toBe(401);
  });

  it("sets resyncRequestedAt, which GET /v1/me then returns (null before)", async () => {
    const { token } = await signIn("resync-me@example.com");
    expect((await (await getMe(token)).json()).resyncRequestedAt).toBeNull();

    const res = await postResync(token);
    expect(res.status).toBe(200);
    const { resyncRequestedAt } = (await res.json()) as { resyncRequestedAt: string };
    expect(new Date(resyncRequestedAt).toISOString()).toBe(resyncRequestedAt);

    expect((await (await getMe(token)).json()).resyncRequestedAt).toBe(resyncRequestedAt);
  });

  it("answers the 7th call within an hour with 429, and leaves the stored time at the last allowed call", async () => {
    const { token } = await signIn("resync-limit@example.com");
    let last = "";
    for (let call = 1; call <= 6; call++) {
      const res = await postResync(token);
      expect(res.status, `call ${call}`).toBe(200);
      last = ((await res.json()) as { resyncRequestedAt: string }).resyncRequestedAt;
    }
    expect((await postResync(token)).status).toBe(429);
    expect((await (await getMe(token)).json()).resyncRequestedAt).toBe(last);
  });
});
