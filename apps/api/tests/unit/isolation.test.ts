import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { devices } from "../../src/db/schema";
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
import * as playsRoute from "../../src/app/v1/plays/route";
import * as playsSummaryRoute from "../../src/app/v1/plays/summary/route";
import * as releasePlaysRoute from "../../src/app/v1/releases/[id]/plays/route";
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
  await new Promise<void>((r) => queueMicrotask(() => r()));

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

    // Alice's device reports plays for her release.
    const alicePlays = await playsRoute.PUT(
      jsonRequest("http://localhost/v1/plays", "PUT", { counts: [{ releaseId: record.id, trackId: track.id, count: 5 }] }, alice.token)
    );
    expect(alicePlays.status).toBe(200);
    expect(await alicePlays.json()).toEqual({ accepted: 1, ignored: 0 });

    // ...and a day bucket for today, so the summary has something of Alice's to leak.
    const today = new Date().toISOString().slice(0, 10);
    const aliceDays = await playsRoute.PUT(
      jsonRequest("http://localhost/v1/plays", "PUT", {
        counts: [{ releaseId: record.id, trackId: track.id, count: 5, days: [{ day: today, count: 2 }] }],
      }, alice.token)
    );
    expect(aliceDays.status).toBe(200);
    const summaryUrl = `http://localhost/v1/plays/summary?from=${today}&to=${today}`;
    const summaryAs = (token: string) =>
      playsSummaryRoute.GET(new Request(summaryUrl, { headers: { authorization: `Bearer ${token}` } }));

    cases.push({
      name: "GET release/:id/plays",
      run: () =>
        releasePlaysRoute.GET(
          new Request(`http://localhost/v1/releases/${record.id}/plays`, { headers: { authorization: `Bearer ${bob.token}` } }),
          { params: Promise.resolve({ id: record.id }) }
        ),
    });

    // Bob's PUT for Alice's release is ignored and writes nothing.
    const bobPlays = await playsRoute.PUT(
      jsonRequest("http://localhost/v1/plays", "PUT", { counts: [{ releaseId: record.id, trackId: track.id, count: 99 }] }, bob.token)
    );
    expect(bobPlays.status).toBe(200);
    expect(await bobPlays.json()).toEqual({ accepted: 0, ignored: 1 });
    // A body naming a device is refused.
    const bodyDevice = await playsRoute.PUT(
      jsonRequest("http://localhost/v1/plays", "PUT", {
        deviceId: alice.deviceId,
        counts: [{ releaseId: record.id, trackId: track.id, count: 99 }],
      }, bob.token)
    );
    expect(bodyDevice.status).toBe(400);

    for (const { name, run } of cases) {
      const res = await run();
      expect(res.status, `${name} should 404, not leak existence via another status`).toBe(404);
    }

    // GET /v1/plays/summary: Bob sees none of Alice's tracks, Alice sees hers; no token is refused.
    const bobSummary = await summaryAs(bob.token);
    expect(bobSummary.status).toBe(200);
    expect(await bobSummary.json()).toEqual({ tracks: [], allTime: [], nextCursor: null });
    const aliceSummary = await summaryAs(alice.token);
    expect(aliceSummary.status).toBe(200);
    expect(await aliceSummary.json()).toEqual({
      tracks: [{ trackId: track.id, releaseId: record.id, plays: 2, lastPlayedDay: today }],
      allTime: [{ trackId: track.id, releaseId: record.id, plays: 5 }],
      nextCursor: null,
    });
    expect((await playsSummaryRoute.GET(new Request(summaryUrl))).status).toBe(401);

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

    const alicePlaysAfter = await releasePlaysRoute.GET(
      new Request(`http://localhost/v1/releases/${record.id}/plays`, { headers: { authorization: `Bearer ${alice.token}` } }),
      { params: Promise.resolve({ id: record.id }) }
    );
    expect(alicePlaysAfter.status).toBe(200);
    expect(await alicePlaysAfter.json()).toEqual({
      tracks: [
        {
          trackId: track.id,
          total: 5,
          devices: [{ deviceId: alice.deviceId, name: "Alice's Mac", platform: "mac", count: 5, current: true }],
        },
      ],
    });

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

  it("never revives another account's signed-out Mac when the device name matches (#175)", async () => {
    const alice = await signIn("alice-revive@example.com", "MacBook Pro");
    const signOut = await devicesRoute.DELETE(
      new Request(`http://localhost/v1/devices/${alice.deviceId}`, { method: "DELETE", headers: { authorization: `Bearer ${alice.token}` } }),
      { params: Promise.resolve({ id: alice.deviceId }) }
    );
    expect(signOut.status).toBe(200);

    // Bob signs in as a Mac with the very same name: he gets his own new device, not Alice's.
    const bob = await signIn("bob-revive@example.com", "MacBook Pro");
    expect(bob.userId).not.toBe(alice.userId);
    expect(bob.deviceId).not.toBe(alice.deviceId);

    // Alice's old token is still refused, and it never resolves to Bob's account.
    const aliceOld = await meRoute.GET(new Request("http://localhost/v1/me", { headers: { authorization: `Bearer ${alice.token}` } }));
    expect(aliceOld.status).toBe(401);
    const bobMe = await meRoute.GET(new Request("http://localhost/v1/me", { headers: { authorization: `Bearer ${bob.token}` } }));
    expect(bobMe.status).toBe(200);
    const bobMeBody = await bobMe.json();
    expect(bobMeBody.user.id).toBe(bob.userId);
    expect(bobMeBody.devices.map((d: { id: string }) => d.id)).toEqual([bob.deviceId]);

    // Alice's own device is still signed out; when she signs back in it is hers again.
    const [aliceRow] = await testServices.db.select().from(devices).where(eq(devices.id, alice.deviceId));
    expect(aliceRow!.userId).toBe(alice.userId);
    expect(aliceRow!.revokedAt).not.toBeNull();
    const aliceAgain = await signIn("alice-revive@example.com", "MacBook Pro");
    expect(aliceAgain.deviceId).toBe(alice.deviceId);
    expect(aliceAgain.userId).toBe(alice.userId);
  });
});
