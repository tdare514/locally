import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestServices, type TestServices } from "../support/testServices";
import { makeReleaseRecord } from "../support/fixtures";
import { setAfterResponseRunner } from "../../src/server/http/afterResponse";
import { LocalFileStore } from "../../src/server/files/LocalFileStore";
import { storageKeyFor } from "../../src/server/files/ReleaseFilesService";

let testServices: TestServices;

vi.mock("../../src/server/container", () => ({
  getServices: async () => testServices,
}));

import * as authCodeRoute from "../../src/app/v1/auth/code/route";
import * as releaseRoute from "../../src/app/v1/releases/[id]/route";

function jsonRequest(url: string, method: string, body?: unknown, token?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function localStore(): LocalFileStore {
  expect(testServices.fileStore).toBeInstanceOf(LocalFileStore);
  return testServices.fileStore as LocalFileStore;
}

describe("deferred work off the request path (#31)", () => {
  beforeAll(async () => {
    testServices = await createTestServices();
  });

  afterEach(() => {
    setAfterResponseRunner(undefined);
  });

  it("POST /v1/auth/code returns before the email send completes", async () => {
    const email = "defer-code@example.com";
    let releaseSend!: () => void;
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    let sendFinished = false;

    const original = testServices.mailer.sendCode.bind(testServices.mailer);
    testServices.mailer.sendCode = async (to, code) => {
      await sendGate;
      await original(to, code);
      sendFinished = true;
    };

    const pending: Promise<void>[] = [];
    setAfterResponseRunner((task) => {
      pending.push(task());
    });

    try {
      const res = await authCodeRoute.POST(jsonRequest("http://localhost/v1/auth/code", "POST", { email }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(sendFinished).toBe(false);

      releaseSend();
      await Promise.all(pending);
      expect(sendFinished).toBe(true);
      expect(testServices.mailer.codeFor(email)).toMatch(/^\d{6}$/);
    } finally {
      testServices.mailer.sendCode = original;
    }
  });

  it("PUT /v1/releases/:id returns before prune finishes", async () => {
    const email = "defer-prune@example.com";
    const issued = await testServices.auth.issueCode(email);
    const { token, user } = await testServices.auth.verify({
      email,
      code: issued,
      deviceName: "Mac",
      platform: "mac",
    });

    const record = makeReleaseRecord({
      cover: null,
      tracks: [
        {
          id: crypto.randomUUID(),
          title: "Keep",
          trackNumber: 1,
          file: "keep.mp3",
          bytes: 10,
          durationSec: 1,
        },
        {
          id: crypto.randomUUID(),
          title: "Drop",
          trackNumber: 2,
          file: "drop.mp3",
          bytes: 10,
          durationSec: 1,
        },
      ],
    });

    await testServices.releases.upsert(user.id, record.id, record);
    await testServices.files.createUploads(user.id, record.id, [
      { name: "keep.mp3", bytes: 10, contentType: "audio/mpeg" },
      { name: "drop.mp3", bytes: 10, contentType: "audio/mpeg" },
    ]);
    const store = localStore();
    await store.writeFromRequest(
      storageKeyFor(user.id, record.id, "keep.mp3"),
      new Response(new Uint8Array(Buffer.from("keep"))).body,
      1000
    );
    await store.writeFromRequest(
      storageKeyFor(user.id, record.id, "drop.mp3"),
      new Response(new Uint8Array(Buffer.from("drop"))).body,
      1000
    );

    let releasePrune!: () => void;
    const pruneGate = new Promise<void>((resolve) => {
      releasePrune = resolve;
    });
    let pruneFinished = false;
    const originalPrune = testServices.files.pruneUnreferenced.bind(testServices.files);
    testServices.files.pruneUnreferenced = async (userId, releaseId, keepNames) => {
      await pruneGate;
      const result = await originalPrune(userId, releaseId, keepNames);
      pruneFinished = true;
      return result;
    };

    const pending: Promise<void>[] = [];
    setAfterResponseRunner((task) => {
      pending.push(task());
    });

    const updated = {
      ...record,
      tracks: [record.tracks[0]!],
      updatedAt: new Date(Date.parse(record.updatedAt) + 1000).toISOString(),
    };

    try {
      const res = await releaseRoute.PUT(
        jsonRequest(`http://localhost/v1/releases/${record.id}`, "PUT", updated, token),
        { params: Promise.resolve({ id: record.id }) }
      );
      expect(res.status).toBe(200);
      expect(pruneFinished).toBe(false);
      expect(await store.readFile(storageKeyFor(user.id, record.id, "drop.mp3"))).not.toBeNull();

      releasePrune();
      await Promise.all(pending);
      expect(pruneFinished).toBe(true);
      expect(await store.readFile(storageKeyFor(user.id, record.id, "drop.mp3"))).toBeNull();
      expect(await store.readFile(storageKeyFor(user.id, record.id, "keep.mp3"))).not.toBeNull();
    } finally {
      testServices.files.pruneUnreferenced = originalPrune;
    }
  });
});
