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
import * as missingRoute from "../../src/app/v1/files/missing/route";
import * as resyncRoute from "../../src/app/v1/files/resync-request/route";
import * as sharesRoute from "../../src/app/v1/shares/route";
import * as shareRoute from "../../src/app/v1/shares/[id]/route";
import * as shareFileRoute from "../../src/app/v1/shares/[id]/files/[name]/route";
import * as shareClaimRoute from "../../src/app/v1/shares/[id]/claim/route";
import * as shareHideRoute from "../../src/app/v1/shares/[id]/hide/route";
import * as shareReshareRoute from "../../src/app/v1/shares/[id]/reshare/route";

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

    // Alice shares the release with nobody (a public share with no recipients): Bob is a stranger to it (#181).
    const aliceShare = await sharesRoute.POST(
      jsonRequest("http://localhost/v1/shares", "POST", {
        releaseId: record.id,
        recipients: [],
        visibility: "public",
        allowReshare: true,
        expiresInDays: null,
      }, alice.token)
    );
    expect(aliceShare.status).toBe(201);
    const shareId = ((await aliceShare.json()) as { share: { id: string } }).share.id;
    const shareParams = { params: Promise.resolve({ id: shareId }) };
    const bobReq = (method: string, body?: unknown) => jsonRequest(`http://localhost/v1/shares/${shareId}`, method, body, bob.token);
    cases.push(
      {
        name: "POST shares (Alice's release)",
        run: () =>
          sharesRoute.POST(
            jsonRequest("http://localhost/v1/shares", "POST", {
              releaseId: record.id,
              recipients: ["alice-iso@example.com"],
              visibility: "private",
              allowReshare: false,
              expiresInDays: null,
            }, bob.token)
          ),
      },
      { name: "DELETE shares/:id", run: () => shareRoute.DELETE(bobReq("DELETE"), shareParams) },
      {
        name: "GET shares/:id/files/:name",
        run: () => shareFileRoute.GET(bobReq("GET"), { params: Promise.resolve({ id: shareId, name: track.file }) }),
      },
      { name: "POST shares/:id/claim", run: () => shareClaimRoute.POST(bobReq("POST"), shareParams) },
      { name: "POST shares/:id/hide", run: () => shareHideRoute.POST(bobReq("POST"), shareParams) },
      {
        name: "POST shares/:id/reshare",
        run: () =>
          shareReshareRoute.POST(
            bobReq("POST", { recipients: [], visibility: "private", allowReshare: false, expiresInDays: null }),
            shareParams
          ),
      }
    );

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
      tracks: [{ trackId: track.id, releaseId: record.id, plays: 2, devicePlays: 2, lastPlayedDay: today, bySource: { spotify: 2, locally: 0 } }],
      allTime: [{ trackId: track.id, releaseId: record.id, plays: 5, devicePlays: 5, bySource: { spotify: 5, locally: 0 } }],
      nextCursor: null,
    });
    expect((await playsSummaryRoute.GET(new Request(summaryUrl))).status).toBe(401);

    // GET /v1/shares: Bob sees nothing of Alice's share in either list; Alice's own share is unrevoked.
    for (const role of ["sent", "received"]) {
      const bobShares = await sharesRoute.GET(
        new Request(`http://localhost/v1/shares?role=${role}`, { headers: { authorization: `Bearer ${bob.token}` } })
      );
      expect(bobShares.status).toBe(200);
      expect(await bobShares.json()).toEqual({ shares: [], nextCursor: null });
    }
    const aliceSent = await sharesRoute.GET(
      new Request("http://localhost/v1/shares?role=sent", { headers: { authorization: `Bearer ${alice.token}` } })
    );
    const aliceSentBody = await aliceSent.json();
    expect(aliceSentBody.shares).toHaveLength(1);
    expect(aliceSentBody.shares[0].revokedAt).toBeNull();

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

    // GET /v1/files/missing (#119): Alice has a second release whose file never arrived, so her
    // own report is not empty; Bob's is, with nothing of Alice's in it.
    const stuck = makeReleaseRecord();
    const stuckRes = await releaseRoute.PUT(
      jsonRequest(`http://localhost/v1/releases/${stuck.id}`, "PUT", stuck, alice.token),
      { params: Promise.resolve({ id: stuck.id }) }
    );
    expect(stuckRes.status).toBe(200);
    const aliceMissing = await missingRoute.GET(
      new Request("http://localhost/v1/files/missing", { headers: { authorization: `Bearer ${alice.token}` } })
    );
    expect(aliceMissing.status).toBe(200);
    expect((await aliceMissing.json()).releases).toEqual([
      { id: stuck.id, missing: [stuck.tracks[0]!.file], recordUpdatedAt: stuck.updatedAt },
    ]);
    const bobMissing = await missingRoute.GET(
      new Request("http://localhost/v1/files/missing", { headers: { authorization: `Bearer ${bob.token}` } })
    );
    expect(bobMissing.status).toBe(200);
    const bobMissingBody = await bobMissing.json();
    expect(bobMissingBody.releases).toEqual([]);

    // POST /v1/files/resync-request (#119): Bob's request is Bob's alone.
    const bobResync = await resyncRoute.POST(
      new Request("http://localhost/v1/files/resync-request", { method: "POST", headers: { authorization: `Bearer ${bob.token}` } })
    );
    expect(bobResync.status).toBe(200);
    const bobMeAfterResync = await meRoute.GET(
      new Request("http://localhost/v1/me", { headers: { authorization: `Bearer ${bob.token}` } })
    );
    expect((await bobMeAfterResync.json()).resyncRequestedAt).toBe((await bobResync.json()).resyncRequestedAt);

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
    expect((await aliceMe.json()).resyncRequestedAt).toBeNull();

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
