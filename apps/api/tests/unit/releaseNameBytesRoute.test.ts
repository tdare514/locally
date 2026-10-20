import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestServices, type TestServices } from "../support/testServices";
import { makeReleaseRecord } from "../support/fixtures";

let testServices: TestServices;

vi.mock("../../src/server/container", () => ({
  getServices: async () => testServices,
}));

import * as authCodeRoute from "../../src/app/v1/auth/code/route";
import * as authVerifyRoute from "../../src/app/v1/auth/verify/route";
import * as releaseRoute from "../../src/app/v1/releases/[id]/route";
import * as filesRoute from "../../src/app/v1/releases/[id]/files/route";
import * as fileDownloadRoute from "../../src/app/v1/releases/[id]/files/[name]/route";

function jsonRequest(url: string, method: string, body: unknown, token?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(url, { method, headers, body: JSON.stringify(body) });
}

async function signIn(email: string): Promise<{ token: string; userId: string }> {
  await authCodeRoute.POST(jsonRequest("http://localhost/v1/auth/code", "POST", { email }));
  await new Promise<void>((r) => queueMicrotask(() => r()));
  const code = testServices.mailer.codeFor(email);
  const res = await authVerifyRoute.POST(
    jsonRequest("http://localhost/v1/auth/verify", "POST", { email, code, deviceName: "Mac", platform: "mac" })
  );
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

/** `bytes` UTF-8 bytes of 3-byte characters plus ASCII, ending in `.mp3`. */
function nameOfBytes(bytes: number, tag = ""): string {
  const tail = `${tag}.mp3`;
  const rest = bytes - Buffer.byteLength(tail);
  const cjk = Math.floor(rest / 3);
  return "あ".repeat(cjk) + "a".repeat(rest - cjk * 3) + tail;
}

function put(token: string, record: ReturnType<typeof makeReleaseRecord>): Promise<Response> {
  return releaseRoute.PUT(jsonRequest(`http://localhost/v1/releases/${record.id}`, "PUT", record, token), {
    params: Promise.resolve({ id: record.id }),
  });
}

function withFile(file: string) {
  const base = makeReleaseRecord();
  return { ...base, tracks: [{ ...base.tracks[0]!, file }] };
}

describe("PUT /v1/releases/:id file-name byte limit (#87)", () => {
  beforeAll(async () => {
    testServices = await createTestServices();
  });

  it("accepts a 255-byte name and refuses a new 256-byte name with 400", async () => {
    const { token } = await signIn("bytes-new@example.com");
    expect(Buffer.byteLength(nameOfBytes(255))).toBe(255);
    expect((await put(token, withFile(nameOfBytes(255)))).status).toBe(200);
    const res = await put(token, withFile(nameOfBytes(256)));
    expect(res.status).toBe(400);
  });

  it("accepts a re-push of a stored 256-byte name, and refuses a different new 256-byte name on that release", async () => {
    const { token, userId } = await signIn("bytes-stored@example.com");
    const stored = withFile(nameOfBytes(256, "-old"));
    // Saved before the limit: written straight to the service, as an older API would have accepted it.
    await testServices.releases.upsert(userId, stored.id, stored);

    const repush = { ...stored, updatedAt: new Date(Date.now() + 1000).toISOString() };
    expect((await put(token, repush)).status).toBe(200);

    const other = { ...repush, tracks: [{ ...repush.tracks[0]!, file: nameOfBytes(256, "-new") }] };
    expect((await put(token, other)).status).toBe(400);
  });

  /** A release saved under the old rule: a 256-byte name and a 256-byte name with a path separator. */
  async function seedStored(email: string) {
    const { token, userId } = await signIn(email);
    const longName = nameOfBytes(256, "-old");
    const slashName = "/" + nameOfBytes(255, "-slash");
    const base = makeReleaseRecord();
    const record = {
      ...base,
      tracks: [
        { ...base.tracks[0]!, file: longName },
        { ...base.tracks[0]!, id: crypto.randomUUID(), trackNumber: 2, file: slashName },
      ],
    };
    await testServices.releases.upsert(userId, record.id, record);
    return { token, record, longName, slashName };
  }

  function upload(token: string, id: string, name: string): Promise<Response> {
    return filesRoute.POST(
      jsonRequest(`http://localhost/v1/releases/${id}/files`, "POST", { files: [{ name, bytes: 10, contentType: "audio/mpeg" }] }, token),
      { params: Promise.resolve({ id }) }
    );
  }

  function download(token: string, id: string, name: string): Promise<Response> {
    return fileDownloadRoute.GET(
      new Request(`http://localhost/v1/releases/${id}/files/x`, { headers: { authorization: `Bearer ${token}` } }),
      { params: Promise.resolve({ id, name }) }
    );
  }

  it("upload: a stored 256-byte name is accepted, an unstored one is a 400, a stored name with a separator is still a 400", async () => {
    const { token, record, longName, slashName } = await seedStored("bytes-upload@example.com");
    expect((await upload(token, record.id, longName)).status).toBe(200);
    expect((await upload(token, record.id, nameOfBytes(256, "-new"))).status).toBe(400);
    expect((await upload(token, record.id, slashName)).status).toBe(400);
  });

  it("download: a stored 256-byte name is accepted, an unstored one is a 400, a stored name with a separator is still a 400", async () => {
    const { token, record, longName, slashName } = await seedStored("bytes-download@example.com");
    expect((await upload(token, record.id, longName)).status).toBe(200); // registers the file row
    expect((await download(token, record.id, longName)).status).toBe(200);
    expect((await download(token, record.id, nameOfBytes(256, "-new"))).status).toBe(400);
    expect((await download(token, record.id, slashName)).status).toBe(400);
  });

  it("PUT: a stored name with a separator is still a 400 on re-push", async () => {
    const { token, record } = await seedStored("bytes-put-slash@example.com");
    const repush = { ...record, updatedAt: new Date(Date.now() + 1000).toISOString() };
    expect((await put(token, repush)).status).toBe(400);
  });
});
