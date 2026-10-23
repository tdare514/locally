import crypto from "node:crypto";
import { crc32 } from "node:zlib";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, migrateDb } from "../../src/db/client";
import { shareDownloads, shareLinks, shareRecipients, shares } from "../../src/db/schema";
import { storageKeyFor } from "../../src/server/files/ReleaseFilesService";
import { LocalFileStore } from "../../src/server/files/LocalFileStore";
import { hashLinkToken } from "../../src/server/shares/ShareService";
import { InMemoryRateLimiter } from "../../src/server/ratelimit/InMemoryRateLimiter";
import type { ReceivedShare, ReleaseRecord, SentShare } from "../../src/shared/types";
import { makeReleaseRecord } from "../support/fixtures";
import { createTestServices, type TestServices } from "../support/testServices";

let services: TestServices;

// Hoisted by vitest above every import in this file, so the route modules below resolve to this fake.
vi.mock("../../src/server/container", () => ({ getServices: async () => services }));

import * as sharesRoute from "../../src/app/v1/shares/route";
import * as shareRoute from "../../src/app/v1/shares/[id]/route";
import * as shareFileRoute from "../../src/app/v1/shares/[id]/files/[name]/route";
import * as claimRoute from "../../src/app/v1/shares/[id]/claim/route";
import * as hideRoute from "../../src/app/v1/shares/[id]/hide/route";
import * as reshareRoute from "../../src/app/v1/shares/[id]/reshare/route";
import * as linksClaimRoute from "../../src/app/v1/links/claim/route";
import * as meRoute from "../../src/app/v1/me/route";
import * as releaseRoute from "../../src/app/v1/releases/[id]/route";
import * as cleanupRoute from "../../src/app/v1/internal/cleanup/route";
import * as publicPageRoute from "../../src/app/s/[token]/route";
import * as publicFileRoute from "../../src/app/s/[token]/files/[name]/route";
import * as publicZipRoute from "../../src/app/s/[token]/zip/route";
import * as cssRoute from "../../src/app/share-assets/share.css/route";

interface Account {
  token: string;
  userId: string;
  email: string;
}

async function signIn(email: string): Promise<Account> {
  const code = await services.auth.issueCode(email);
  const res = await services.auth.verify({ email, code, deviceName: `${email} device`, platform: "mac" });
  return { token: res.token, userId: res.user.id, email };
}

function req(url: string, method: string, who?: Account | null, body?: unknown, headers: Record<string, string> = {}): Request {
  const h: Record<string, string> = { ...headers };
  if (who) h.authorization = `Bearer ${who.token}`;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`http://localhost${url}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}

/** The reply of a create that made a share (the tests that expect `share: null` compare the whole body). */
interface CreateBody {
  share: SentShare;
  notOnLocally: string[];
  link: string | null;
}

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

/** A release with real stored bytes for every track and the cover. */
async function seedRelease(owner: Account, overrides: Partial<ReleaseRecord> = {}, trackCount = 2) {
  const tracks = Array.from({ length: trackCount }, (_, i) => ({
    id: crypto.randomUUID(),
    title: `Track ${i + 1}`,
    trackNumber: i + 1,
    file: `0${i + 1} - Track ${i + 1}.mp3`,
    bytes: 2000 + i * 500,
    durationSec: 60 + i,
  }));
  const record = makeReleaseRecord({ kind: "album", coverHash: "a".repeat(64), tracks, ...overrides });
  await services.releases.upsert(owner.userId, record.id, record);
  const names = [...record.tracks.map((t) => ({ name: t.file, bytes: t.bytes })), ...(record.cover ? [{ name: record.cover, bytes: 700 }] : [])];
  const store = services.fileStore as LocalFileStore;
  const contents = new Map<string, Buffer>();
  for (const { name, bytes } of names) {
    await services.files.createUploads(owner.userId, record.id, [
      { name, bytes, contentType: name.endsWith(".jpg") ? "image/jpeg" : "audio/mpeg" },
    ]);
    const data = crypto.randomBytes(bytes);
    contents.set(name, data);
    await store.writeFromRequest(storageKeyFor(owner.userId, record.id, name), new Blob([new Uint8Array(data)]).stream(), bytes);
  }
  return { record, contents };
}

async function createShare(who: Account, body: Record<string, unknown>) {
  const res = await sharesRoute.POST(req("/v1/shares", "POST", who, { recipients: [], visibility: "private", allowReshare: false, expiresInDays: null, ...body }));
  return { res, body: (await res.json()) as CreateBody };
}

const tokenOf = (link: string) => link.split("/s/")[1]!;

describe("POST /v1/shares", () => {
  let alice: Account;
  let bob: Account;

  beforeEach(async () => {
    services = await createTestServices();
    alice = await signIn("alice@example.com");
    bob = await signIn("bob@example.com");
  });

  it("creates a private share for existing accounts and reports unknown emails", async () => {
    const { record } = await seedRelease(alice, { releaseDate: "2024-05-17" });
    const { res, body } = await createShare(alice, {
      releaseId: record.id,
      recipients: ["  BOB@example.com ", "bob@example.com", "alice@example.com", "nobody@example.com"],
      allowReshare: true,
      expiresInDays: 7,
    });
    expect(res.status).toBe(201);
    expect(body.notOnLocally).toEqual(["nobody@example.com"]);
    expect(body.link).toBeNull();
    const share = body.share;
    expect(share).toMatchObject({
      releaseId: record.id,
      trackIds: null,
      visibility: "private",
      allowReshare: true,
      revokedAt: null,
      recipients: [{ email: "bob@example.com", claimedAt: null }],
      hasLink: false,
      parentShareId: null,
      downloads: 0,
    });
    expect(new Date(share.expiresAt!).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect(share.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(share.snapshot).toEqual({
      kind: "album",
      title: record.title,
      artist: record.artist,
      year: "2024",
      releaseDate: "2024-05-17",
      genre: null,
      cover: "cover.jpg",
      coverHash: "a".repeat(64),
      tracks: record.tracks.map((t) => ({ id: t.id, title: t.title, trackNumber: t.trackNumber, file: t.file, bytes: t.bytes, durationSec: t.durationSec })),
    });
  });

  it("shares only the chosen tracks and refuses ids that are not the release's", async () => {
    const { record } = await seedRelease(alice);
    const one = record.tracks[1]!.id;
    const { res, body } = await createShare(alice, { releaseId: record.id, trackIds: [one, one], recipients: ["bob@example.com"] });
    expect(res.status).toBe(201);
    expect(body.share.trackIds).toEqual([one]);
    expect(body.share.snapshot.tracks.map((t: { id: string }) => t.id)).toEqual([one]);

    const bad = await createShare(alice, { releaseId: record.id, trackIds: [crypto.randomUUID()], recipients: ["bob@example.com"] });
    expect(bad.res.status).toBe(400);
    expect((await createShare(alice, { releaseId: record.id, trackIds: [], recipients: ["bob@example.com"] })).res.status).toBe(400);
  });

  it("does not create a private share when nobody resolves", async () => {
    const { record } = await seedRelease(alice);
    const { res, body } = await createShare(alice, { releaseId: record.id, recipients: ["ghost@example.com", "alice@example.com"] });
    expect(res.status).toBe(200);
    expect(body).toEqual({ share: null, notOnLocally: ["ghost@example.com"], link: null });
    expect(await services.db.select().from(shares)).toHaveLength(0);
  });

  it("answers 404, 409 adopted, 403 and 400 as specified", async () => {
    const { record } = await seedRelease(alice);
    // Another user's release, an unknown one, a tombstoned one.
    expect((await createShare(bob, { releaseId: record.id, recipients: ["alice@example.com"] })).res.status).toBe(404);
    expect((await createShare(alice, { releaseId: crypto.randomUUID(), recipients: ["bob@example.com"] })).res.status).toBe(404);
    const gone = await seedRelease(alice);
    await services.releases.tombstone(alice.userId, gone.record.id);
    expect((await createShare(alice, { releaseId: gone.record.id, recipients: ["bob@example.com"] })).res.status).toBe(404);

    const adopted = makeReleaseRecord({ source: "adopted", coverHash: null, cover: null });
    await services.releases.upsert(alice.userId, adopted.id, adopted);
    const adoptedRes = await createShare(alice, { releaseId: adopted.id, recipients: ["bob@example.com"] });
    expect(adoptedRes.res.status).toBe(409);
    expect(adoptedRes.body).toEqual({ error: "adopted" });

    // Malformed.
    for (const bad of [{ releaseId: "nope" }, { recipients: ["not an email"] }, { visibility: "world" }, { expiresInDays: 3 }, { allowReshare: "yes" }]) {
      expect((await createShare(alice, { releaseId: record.id, recipients: ["bob@example.com"], ...bad })).res.status, JSON.stringify(bad)).toBe(400);
    }
    const tooMany = Array.from({ length: 51 }, (_, i) => `u${i}@example.com`);
    expect((await createShare(alice, { releaseId: record.id, recipients: tooMany })).res.status).toBe(400);
    expect((await sharesRoute.POST(req("/v1/shares", "POST", null, {}))).status).toBe(401);
  });

  it("refuses public shares with 403 public_links_disabled while the switch is off", async () => {
    const { record } = await seedRelease(alice);
    const off = new (services.shares.constructor as new (...a: unknown[]) => typeof services.shares)(services.db, services.fileStore, { publicSharesEnabled: false });
    services.shares = off;
    const { res, body } = await createShare(alice, { releaseId: record.id, visibility: "public" });
    expect(res.status).toBe(403);
    expect(body).toEqual({ error: "public_links_disabled" });
    const me = await meRoute.GET(req("/v1/me", "GET", alice));
    expect((await me.json()).publicSharesEnabled).toBe(false);
  });

  it("returns the link once for a public share and stores only the hash", async () => {
    const { record } = await seedRelease(alice);
    const { res, body } = await createShare(alice, { releaseId: record.id, visibility: "public" });
    expect(res.status).toBe(201);
    expect(body.link).toMatch(/^http:\/\/localhost\/s\/[A-Za-z0-9_-]{43}$/);
    expect(body.share.hasLink).toBe(true);
    expect(body.share.recipients).toEqual([]);
    const token = tokenOf(body.link!);
    const [row] = await services.db.select().from(shareLinks);
    expect(row!.tokenHash).toBe(hashLinkToken(token));
    expect(JSON.stringify(await services.db.select().from(shareLinks))).not.toContain(token);
    // The sent list never repeats it.
    const list = await sharesRoute.GET(req("/v1/shares?role=sent", "GET", alice));
    expect(JSON.stringify(await list.json())).not.toContain(token);
    const me = await meRoute.GET(req("/v1/me", "GET", alice));
    expect((await me.json()).publicSharesEnabled).toBe(true);
  });
});

describe("listing, claim, hide, files", () => {
  let alice: Account;
  let bob: Account;
  let carol: Account;
  let record: ReleaseRecord;
  let contents: Map<string, Buffer>;
  let shareId: string;

  beforeEach(async () => {
    services = await createTestServices();
    alice = await signIn("alice@example.com");
    bob = await signIn("bob@example.com");
    carol = await signIn("carol@example.com");
    ({ record, contents } = await seedRelease(alice));
    const { body } = await createShare(alice, { releaseId: record.id, recipients: ["bob@example.com"] });
    shareId = body.share.id;
  });

  const list = async (who: Account, qs: string) => {
    const res = await sharesRoute.GET(req(`/v1/shares?${qs}`, "GET", who));
    return { res, body: (await res.json()) as { shares: Array<SentShare & ReceivedShare>; nextCursor: string | null } };
  };

  it("lists sent and received shares, newest first, with cursors", async () => {
    const second = await createShare(alice, { releaseId: record.id, recipients: ["bob@example.com"] });
    const third = await createShare(alice, { releaseId: record.id, recipients: ["bob@example.com", "carol@example.com"] });
    const all = await list(alice, "role=sent");
    expect(new Set(all.body.shares.map((s) => s.id))).toEqual(new Set([third.body.share.id, second.body.share.id, shareId]));
    const times = all.body.shares.map((s) => s.createdAt as string);
    expect(times).toEqual([...times].sort().reverse());
    expect(all.body.nextCursor).toBeNull();

    const page1 = await list(bob, "role=received&limit=2");
    expect(page1.body.shares).toHaveLength(2);
    expect(page1.body.nextCursor).not.toBeNull();
    const page2 = await list(bob, `role=received&limit=2&cursor=${page1.body.nextCursor}`);
    expect(page2.body.shares).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();
    const ids = [...page1.body.shares, ...page2.body.shares].map((s) => s.id);
    expect(new Set(ids).size).toBe(3);
    expect(page1.body.shares[0]).toMatchObject({ from: { email: "alice@example.com" }, trackIds: null, allowReshare: false, canReshare: false, claimedAt: null });
    expect(Object.keys(page1.body.shares[0]!).sort()).toEqual(
      ["allowReshare", "canReshare", "claimedAt", "createdAt", "expiresAt", "from", "id", "snapshot", "trackIds"].sort()
    );

    expect((await list(carol, "role=received")).body.shares).toHaveLength(1);
    expect((await list(carol, "role=sent")).body.shares).toHaveLength(0);
    for (const bad of ["", "role=other", "role=sent&limit=0", "role=sent&limit=101", "role=sent&cursor=!!"]) {
      expect((await list(alice, bad)).res.status, bad).toBe(400);
    }
    expect((await sharesRoute.GET(req("/v1/shares?role=sent", "GET", null))).status).toBe(401);
  });

  it("claim is idempotent and the claimed share still lists with claimedAt; hide removes it from the tray", async () => {
    const first = await claimRoute.POST(req(`/v1/shares/${shareId}/claim`, "POST", bob), idParams(shareId));
    expect(first.status).toBe(200);
    const { claimedAt } = await first.json();
    expect(claimedAt).toMatch(/Z$/);
    await new Promise((r) => setTimeout(r, 5));
    const again = await claimRoute.POST(req(`/v1/shares/${shareId}/claim`, "POST", bob), idParams(shareId));
    expect((await again.json()).claimedAt).toBe(claimedAt);
    expect((await list(bob, "role=received")).body.shares[0]!.claimedAt).toBe(claimedAt);
    expect((await list(alice, "role=sent")).body.shares[0]!.recipients).toEqual([{ email: "bob@example.com", claimedAt }]);

    const hidden = await hideRoute.POST(req(`/v1/shares/${shareId}/hide`, "POST", bob), idParams(shareId));
    expect(await hidden.json()).toEqual({ ok: true });
    expect((await list(bob, "role=received")).body.shares).toHaveLength(0);
    // Still downloadable after hiding (the client hides after it has imported, but may retry a file).
    const file = await shareFileRoute.GET(req("/x", "GET", bob), { params: Promise.resolve({ id: shareId, name: record.tracks[0]!.file }) });
    expect(file.status).toBe(200);
  });

  it("serves signed URLs only for the snapshot's cover and tracks, and records the download", async () => {
    const name = record.tracks[0]!.file;
    const res = await shareFileRoute.GET(req("/x", "GET", bob), { params: Promise.resolve({ id: shareId, name }) });
    expect(res.status).toBe(200);
    const ticket = await res.json();
    expect(ticket.url).toContain("/v1/internal/local-download/");
    expect(new Date(ticket.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);
    const cover = await shareFileRoute.GET(req("/x", "GET", bob), { params: Promise.resolve({ id: shareId, name: "cover.jpg" }) });
    expect(cover.status).toBe(200);
    for (const bad of ["other.mp3", "../x.mp3", "cover.png"]) {
      const r = await shareFileRoute.GET(req("/x", "GET", bob), { params: Promise.resolve({ id: shareId, name: bad }) });
      expect(r.status, bad).toBe(404);
    }
    const rows = await services.db.select().from(shareDownloads);
    expect(rows.map((r) => [r.shareId, r.name, r.via, r.bytes])).toEqual([
      [shareId, name, "recipient", contents.get(name)!.length],
      [shareId, "cover.jpg", "recipient", 700],
    ]);
    expect((await list(alice, "role=sent")).body.shares[0]!.downloads).toBe(2);
  });

  it("revoke and expiry hide the share everywhere", async () => {
    const del = await shareRoute.DELETE(req(`/v1/shares/${shareId}`, "DELETE", alice), idParams(shareId));
    expect(await del.json()).toEqual({ ok: true });
    expect((await list(bob, "role=received")).body.shares).toHaveLength(0);
    const sent = (await list(alice, "role=sent")).body.shares;
    expect(sent).toHaveLength(1);
    expect(sent[0]!.revokedAt).toMatch(/Z$/);
    const name = record.tracks[0]!.file;
    expect((await shareFileRoute.GET(req("/x", "GET", bob), { params: Promise.resolve({ id: shareId, name }) })).status).toBe(404);
    expect((await claimRoute.POST(req("/x", "POST", bob), idParams(shareId))).status).toBe(404);
    expect((await hideRoute.POST(req("/x", "POST", bob), idParams(shareId))).status).toBe(404);
    const body = { recipients: ["carol@example.com"], visibility: "private", allowReshare: false, expiresInDays: null };
    expect((await reshareRoute.POST(req("/x", "POST", bob, body), idParams(shareId))).status).toBe(404);

    const other = await createShare(alice, { releaseId: record.id, recipients: ["bob@example.com"] });
    await services.db.update(shares).set({ expiresAt: Date.now() - 1000 }).where(eq(shares.id, other.body.share.id));
    expect((await list(bob, "role=received")).body.shares).toHaveLength(0);
    expect((await claimRoute.POST(req("/x", "POST", bob), idParams(other.body.share.id))).status).toBe(404);
    expect((await list(alice, "role=sent")).body.shares).toHaveLength(2);
  });

  it("answers 404 to everyone who is not the right party, and 401 without a token", async () => {
    const name = record.tracks[0]!.file;
    const body = { recipients: ["bob@example.com"], visibility: "private", allowReshare: false, expiresInDays: null };
    const cases: Array<[string, () => Promise<Response>]> = [
      ["DELETE by a recipient", () => shareRoute.DELETE(req("/x", "DELETE", bob), idParams(shareId))],
      ["DELETE by a stranger", () => shareRoute.DELETE(req("/x", "DELETE", carol), idParams(shareId))],
      ["files by a stranger", () => shareFileRoute.GET(req("/x", "GET", carol), { params: Promise.resolve({ id: shareId, name }) })],
      ["files by the owner", () => shareFileRoute.GET(req("/x", "GET", alice), { params: Promise.resolve({ id: shareId, name }) })],
      ["claim by a stranger", () => claimRoute.POST(req("/x", "POST", carol), idParams(shareId))],
      ["claim by the owner", () => claimRoute.POST(req("/x", "POST", alice), idParams(shareId))],
      ["hide by a stranger", () => hideRoute.POST(req("/x", "POST", carol), idParams(shareId))],
      ["reshare by a stranger", () => reshareRoute.POST(req("/x", "POST", carol, body), idParams(shareId))],
      ["reshare by the owner", () => reshareRoute.POST(req("/x", "POST", alice, body), idParams(shareId))],
      ["unknown id", () => shareRoute.DELETE(req("/x", "DELETE", alice), idParams(crypto.randomUUID()))],
    ];
    for (const [label, run] of cases) expect((await run()).status, label).toBe(404);
    const unauth: Array<[string, () => Promise<Response>]> = [
      ["DELETE", () => shareRoute.DELETE(req("/x", "DELETE"), idParams(shareId))],
      ["files", () => shareFileRoute.GET(req("/x", "GET"), { params: Promise.resolve({ id: shareId, name }) })],
      ["claim", () => claimRoute.POST(req("/x", "POST"), idParams(shareId))],
      ["hide", () => hideRoute.POST(req("/x", "POST"), idParams(shareId))],
      ["reshare", () => reshareRoute.POST(req("/x", "POST", null, body), idParams(shareId))],
      ["links/claim", () => linksClaimRoute.POST(req("/x", "POST", null, { token: "t" }))],
    ];
    for (const [label, run] of unauth) expect((await run()).status, label).toBe(401);
    // Nothing changed for the real parties.
    expect((await list(bob, "role=received")).body.shares).toHaveLength(1);
    expect((await list(alice, "role=sent")).body.shares[0]!.revokedAt).toBeNull();
    expect((await shareRoute.DELETE(req("/x", "DELETE", alice), idParams("not-a-uuid"))).status).toBe(400);
  });
});

describe("reshare", () => {
  let alice: Account;
  let bob: Account;
  let carol: Account;
  let dave: Account;
  let erin: Account;
  let record: ReleaseRecord;

  beforeEach(async () => {
    services = await createTestServices();
    alice = await signIn("alice@example.com");
    bob = await signIn("bob@example.com");
    carol = await signIn("carol@example.com");
    dave = await signIn("dave@example.com");
    erin = await signIn("erin@example.com");
    ({ record } = await seedRelease(alice));
  });

  const reshare = async (from: Account, id: string, body: Record<string, unknown>) => {
    const res = await reshareRoute.POST(
      req("/x", "POST", from, { recipients: [], visibility: "private", allowReshare: false, expiresInDays: null, ...body }),
      idParams(id)
    );
    return { res, body: (await res.json()) as CreateBody };
  };

  it("needs allowReshare, points at the same files, and revoking the parent revokes the children", async () => {
    const closed = await createShare(alice, { releaseId: record.id, recipients: ["bob@example.com"], allowReshare: false });
    const refused = await reshare(bob, closed.body.share.id, { recipients: ["carol@example.com"] });
    expect(refused.res.status).toBe(403);
    expect(refused.body).toEqual({ error: "reshare_not_allowed" });
    const received = await sharesRoute.GET(req("/v1/shares?role=received", "GET", bob));
    expect((await received.json()).shares[0].canReshare).toBe(false);

    const open = await createShare(alice, { releaseId: record.id, trackIds: [record.tracks[0]!.id], recipients: ["bob@example.com"], allowReshare: true });
    const child = await reshare(bob, open.body.share.id, { recipients: ["carol@example.com", "x@example.com"], allowReshare: true });
    expect(child.res.status).toBe(201);
    expect(child.body.notOnLocally).toEqual(["x@example.com"]);
    expect(child.body.share).toMatchObject({ releaseId: record.id, parentShareId: open.body.share.id, trackIds: [record.tracks[0]!.id] });
    expect(child.body.share.snapshot).toEqual(open.body.share.snapshot);
    const [row] = await services.db.select().from(shares).where(eq(shares.id, child.body.share.id));
    expect(row).toMatchObject({ ownerUserId: bob.userId, fileOwnerUserId: alice.userId, depth: 1 });

    // Carol can download Alice's files through the child.
    const file = await shareFileRoute.GET(req("/x", "GET", carol), { params: Promise.resolve({ id: child.body.share.id, name: record.tracks[0]!.file }) });
    expect(file.status).toBe(200);
    const carolList = await (await sharesRoute.GET(req("/v1/shares?role=received", "GET", carol))).json();
    expect(carolList.shares[0]).toMatchObject({ from: { email: "bob@example.com" }, canReshare: true });
    // Bob sees his child under "sent".
    expect((await (await sharesRoute.GET(req("/v1/shares?role=sent", "GET", bob))).json()).shares[0].id).toBe(child.body.share.id);

    await shareRoute.DELETE(req("/x", "DELETE", alice), idParams(open.body.share.id));
    const after = await shareFileRoute.GET(req("/x", "GET", carol), { params: Promise.resolve({ id: child.body.share.id, name: record.tracks[0]!.file }) });
    expect(after.status).toBe(404);
    expect((await (await sharesRoute.GET(req("/v1/shares?role=received", "GET", carol))).json()).shares).toHaveLength(0);
    expect((await (await sharesRoute.GET(req("/v1/shares?role=sent", "GET", bob))).json()).shares[0].revokedAt).not.toBeNull();
  });

  it("stops at depth 3, and checks revoked and expired ancestors even if a child row was left unrevoked", async () => {
    const root = await createShare(alice, { releaseId: record.id, recipients: ["bob@example.com"], allowReshare: true });
    const c1 = await reshare(bob, root.body.share.id, { recipients: ["carol@example.com"], allowReshare: true });
    const c2 = await reshare(carol, c1.body.share.id, { recipients: ["dave@example.com"], allowReshare: true });
    const c3 = await reshare(dave, c2.body.share.id, { recipients: ["erin@example.com"], allowReshare: true });
    expect(c3.res.status).toBe(201);
    expect(c3.body.share.parentShareId).toBe(c2.body.share.id);
    const deep = await (await sharesRoute.GET(req("/v1/shares?role=received", "GET", erin))).json();
    expect(deep.shares[0].canReshare).toBe(false);
    expect((await reshare(erin, c3.body.share.id, { recipients: ["alice@example.com"] })).res.status).toBe(403);
    const dave2 = await (await sharesRoute.GET(req("/v1/shares?role=received", "GET", dave))).json();
    expect(dave2.shares[0].canReshare).toBe(true);

    // Revoke only a middle row directly (as if the cascade had not run): descendants are still hidden.
    await services.db.update(shares).set({ revokedAt: Date.now() }).where(eq(shares.id, c1.body.share.id));
    for (const [who, id] of [[carol, c1.body.share.id], [dave, c2.body.share.id], [erin, c3.body.share.id]] as const) {
      const r = await sharesRoute.GET(req("/v1/shares?role=received", "GET", who));
      expect((await r.json()).shares, who.email).toHaveLength(0);
      expect((await claimRoute.POST(req("/x", "POST", who), idParams(id))).status).toBe(404);
    }
    // Expired ancestor, same.
    await services.db.update(shares).set({ revokedAt: null }).where(eq(shares.id, c1.body.share.id));
    await services.db.update(shares).set({ expiresAt: Date.now() - 1000 }).where(eq(shares.id, c2.body.share.id));
    expect((await (await sharesRoute.GET(req("/v1/shares?role=received", "GET", erin))).json()).shares).toHaveLength(0);
    expect((await claimRoute.POST(req("/x", "POST", erin), idParams(c3.body.share.id))).status).toBe(404);
    expect((await (await sharesRoute.GET(req("/v1/shares?role=received", "GET", carol))).json()).shares).toHaveLength(1);
  });

  it("never lets a child outlive its parent", async () => {
    const root = await createShare(alice, { releaseId: record.id, recipients: ["bob@example.com"], allowReshare: true, expiresInDays: 7 });
    const longer = await reshare(bob, root.body.share.id, { recipients: ["carol@example.com"], expiresInDays: 30 });
    expect(longer.body.share.expiresAt).toBe(root.body.share.expiresAt);
    const never = await reshare(bob, root.body.share.id, { recipients: ["carol@example.com"], expiresInDays: null });
    expect(never.body.share.expiresAt).toBe(root.body.share.expiresAt);
    const unlimited = await createShare(alice, { releaseId: record.id, recipients: ["bob@example.com"], allowReshare: true });
    const shorter = await reshare(bob, unlimited.body.share.id, { recipients: ["carol@example.com"], expiresInDays: 7 });
    expect(new Date(shorter.body.share.expiresAt!).getTime()).toBeLessThan(Date.now() + 8 * 86_400_000);
  });

  it("refuses a public reshare while the switch is off and an unresolvable private one makes nothing", async () => {
    const root = await createShare(alice, { releaseId: record.id, recipients: ["bob@example.com"], allowReshare: true });
    const none = await reshare(bob, root.body.share.id, { recipients: ["ghost@example.com"] });
    expect(none.res.status).toBe(200);
    expect(none.body).toEqual({ share: null, notOnLocally: ["ghost@example.com"], link: null });
    const pub = await reshare(bob, root.body.share.id, { visibility: "public" });
    expect(pub.res.status).toBe(201);
    expect(pub.body.link).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);
    expect(pub.body.share.parentShareId).toBe(root.body.share.id);
  });
});

describe("tombstone and account deletion", () => {
  let alice: Account;
  let bob: Account;

  beforeEach(async () => {
    services = await createTestServices();
    alice = await signIn("alice@example.com");
    bob = await signIn("bob@example.com");
  });

  const received = async (who: Account) => (await (await sharesRoute.GET(req("/v1/shares?role=received", "GET", who))).json()).shares as unknown[];

  it("DELETE /v1/releases/:id revokes the release's shares and reshares", async () => {
    const { record } = await seedRelease(alice);
    const other = await seedRelease(alice);
    const root = await createShare(alice, { releaseId: record.id, recipients: ["bob@example.com"], allowReshare: true });
    const keep = await createShare(alice, { releaseId: other.record.id, recipients: ["bob@example.com"] });
    const carol = await signIn("carol@example.com");
    await reshareRoute.POST(req("/x", "POST", bob, { recipients: ["carol@example.com"], visibility: "private", allowReshare: false, expiresInDays: null }), idParams(root.body.share.id));
    expect(await received(carol)).toHaveLength(1);

    const del = await releaseRoute.DELETE(req("/x", "DELETE", alice), idParams(record.id));
    expect(del.status).toBe(200);
    expect(await received(carol)).toHaveLength(0);
    expect((await received(bob)).map((s) => (s as { id: string }).id)).toEqual([keep.body.share.id]);
    const rows = await services.db.select().from(shares);
    expect(rows.filter((r) => r.releaseId === record.id).every((r) => r.revokedAt !== null)).toBe(true);
    expect(rows.find((r) => r.id === keep.body.share.id)!.revokedAt).toBeNull();
  });

  it("PUT with deleted: true revokes too; an older PUT that loses the race revokes nothing", async () => {
    const { record } = await seedRelease(alice);
    await createShare(alice, { releaseId: record.id, recipients: ["bob@example.com"] });
    const stale = { ...record, deleted: true, updatedAt: new Date(Date.now() - 86_400_000).toISOString() };
    const lost = await releaseRoute.PUT(req("/x", "PUT", alice, stale), idParams(record.id));
    expect(lost.status).toBe(409);
    expect(await received(bob)).toHaveLength(1);

    const win = await releaseRoute.PUT(req("/x", "PUT", alice, { ...record, deleted: true, updatedAt: new Date(Date.now() + 1000).toISOString() }), idParams(record.id));
    expect(win.status).toBe(200);
    expect(await received(bob)).toHaveLength(0);
  });

  it("deleting the owner's account removes their shares, reshares below them, and recipient rows; deleting a recipient removes theirs", async () => {
    const carol = await signIn("carol@example.com");
    const { record } = await seedRelease(alice);
    const root = await createShare(alice, { releaseId: record.id, recipients: ["bob@example.com", "carol@example.com"], allowReshare: true, visibility: "public" });
    const child = await reshareRoute.POST(
      req("/x", "POST", bob, { recipients: ["carol@example.com"], visibility: "private", allowReshare: false, expiresInDays: null }),
      idParams(root.body.share.id)
    );
    expect(child.status).toBe(201);
    await shareFileRoute.GET(req("/x", "GET", bob), { params: Promise.resolve({ id: root.body.share.id, name: record.tracks[0]!.file }) });

    // Carol leaves: her recipient rows go, the shares stay.
    await services.account.deleteAccount(carol.userId, carol.email);
    expect((await services.db.select().from(shareRecipients).where(eq(shareRecipients.userId, carol.userId)))).toHaveLength(0);
    expect(await services.db.select().from(shares)).toHaveLength(2);

    await services.account.deleteAccount(alice.userId, alice.email);
    expect(await services.db.select().from(shares)).toHaveLength(0);
    expect(await services.db.select().from(shareRecipients)).toHaveLength(0);
    expect(await services.db.select().from(shareLinks)).toHaveLength(0);
    expect(await services.db.select().from(shareDownloads)).toHaveLength(0);
    expect(await received(bob)).toHaveLength(0);
  });
});

describe("links/claim and the public routes", () => {
  let alice: Account;
  let bob: Account;
  let record: ReleaseRecord;
  let contents: Map<string, Buffer>;
  let token: string;
  let shareId: string;

  beforeEach(async () => {
    services = await createTestServices();
    alice = await signIn("alice@example.com");
    bob = await signIn("bob@example.com");
    ({ record, contents } = await seedRelease(alice, { title: `Evil <script>alert(1)</script> & "co"`, artist: "A' onerror=x" }, 3));
    const { body } = await createShare(alice, { releaseId: record.id, visibility: "public" });
    token = tokenOf(body.link!);
    shareId = body.share.id;
  });

  const page = (t: string, ip = "198.51.100.7") =>
    publicPageRoute.GET(req(`/s/${t}`, "GET", null, undefined, { "x-forwarded-for": ip }), { params: Promise.resolve({ token: t }) });
  const fileOf = (t: string, name: string) =>
    publicFileRoute.GET(req(`/s/${t}/files/x`, "GET"), { params: Promise.resolve({ token: t, name }) });
  const zipOf = (t: string) => publicZipRoute.GET(req(`/s/${t}/zip`, "GET"), { params: Promise.resolve({ token: t }) });

  it("renders an escaped, locked-down page", async () => {
    const res = await page(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("img-src 'self' http://localhost:4000");
    expect(csp).not.toMatch(/unsafe-inline|script-src/);
    const html = await res.text();
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toMatch(/<script|style=|og:|<audio/i);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Evil &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;co&quot;");
    expect(html).toContain("A&#39; onerror=x");
    expect(html).toContain("Have Locally? Copy this page's link and paste it into From your friends.");
    expect(html).toContain("Locally is invite-only right now.");
    expect(html).toContain("<h1>");
    expect(html).toContain('<ol class="tracks">');
    expect(html).toContain(`href="/s/${token}/zip"`);
    expect(html).toContain(`src="/s/${token}/files/cover.jpg"`);

    const css = cssRoute.GET();
    expect(css.headers.get("content-type")).toContain("text/css");
    expect(await css.text()).not.toMatch(/url\(|@import/);
  });

  it("answers an identical 404 page for unknown, revoked, expired and disabled links", async () => {
    const good = await page(token);
    expect(good.status).toBe(200);
    const unknown = await page(crypto.randomBytes(32).toString("base64url"));
    expect(unknown.status).toBe(404);
    const reference = await unknown.text();
    const check = async (label: string, run: () => Promise<Response>) => {
      const r = await run();
      expect(r.status, label).toBe(404);
      expect(await r.text(), label).toBe(reference);
      expect(r.headers.get("content-security-policy"), label).toContain("default-src 'none'");
      expect(r.headers.get("x-robots-tag"), label).toBe("noindex");
    };
    await check("bad file name", () => fileOf(token, "nope.mp3"));
    await check("unknown file", () => fileOf("x".repeat(43), "cover.jpg"));
    await check("unknown zip", () => zipOf("x".repeat(43)));

    await services.db.update(shares).set({ expiresAt: Date.now() - 1000 }).where(eq(shares.id, shareId));
    await check("expired page", () => page(token));
    await check("expired file", () => fileOf(token, "cover.jpg"));
    await check("expired zip", () => zipOf(token));
    await services.db.update(shares).set({ expiresAt: null }).where(eq(shares.id, shareId));
    expect((await page(token)).status).toBe(200);

    await shareRoute.DELETE(req("/x", "DELETE", alice), idParams(shareId));
    await check("revoked page", () => page(token));
    await check("revoked file", () => fileOf(token, "cover.jpg"));
    await check("revoked zip", () => zipOf(token));

    await services.db.update(shares).set({ revokedAt: null }).where(eq(shares.id, shareId));
    expect((await page(token)).status).toBe(200);
    const enabled = services.shares;
    services.shares = new (enabled.constructor as new (...a: unknown[]) => typeof enabled)(services.db, services.fileStore, { publicSharesEnabled: false });
    await check("disabled page", () => page(token));
    await check("disabled file", () => fileOf(token, "cover.jpg"));
    await check("disabled zip", () => zipOf(token));
    const claim = await linksClaimRoute.POST(req("/x", "POST", bob, { token }));
    expect(claim.status).toBe(404);
    expect(await claim.json()).toEqual({ error: "Link not found" });
    services.shares = enabled;
  });

  it("a private share has no page", async () => {
    const priv = await createShare(alice, { releaseId: record.id, recipients: ["bob@example.com"] });
    expect(priv.body.link).toBeNull();
    expect((await page(crypto.randomBytes(32).toString("base64url"))).status).toBe(404);
  });

  it("302s to a signed URL for the cover and tracks and records link downloads", async () => {
    const res = await fileOf(token, record.tracks[0]!.file);
    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    expect(location).toContain("/v1/internal/local-download/");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect((await fileOf(token, "cover.jpg")).status).toBe(302);
    const rows = await services.db.select().from(shareDownloads);
    expect(rows.map((r) => r.via)).toEqual(["link", "link"]);
  });

  it("streams one store-only zip of the track files that unzips to the stored bytes", async () => {
    const res = await zipOf(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="/);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    const zip = Buffer.from(await res.arrayBuffer());
    const entries = readStoreOnlyZip(zip);
    expect(entries.map((e) => e.name)).toEqual(record.tracks.map((t) => t.file));
    for (const entry of entries) expect(entry.data.equals(contents.get(entry.name)!), entry.name).toBe(true);
    expect(entries.map((e) => e.name)).not.toContain("cover.jpg");
    const rows = await services.db.select().from(shareDownloads);
    expect(rows).toHaveLength(3);
    expect(rows.reduce((n, r) => n + r.bytes, 0)).toBe(record.tracks.reduce((n, t) => n + t.bytes, 0));
  });

  it("links/claim adds the caller as a recipient (not the sender) and is idempotent", async () => {
    const res = await linksClaimRoute.POST(req("/x", "POST", bob, { token }));
    expect(res.status).toBe(200);
    const { share } = await res.json();
    expect(share).toMatchObject({ id: shareId, from: { email: "alice@example.com" }, claimedAt: null, allowReshare: false, canReshare: false });
    const again = await linksClaimRoute.POST(req("/x", "POST", bob, { token }));
    expect((await again.json()).share.id).toBe(shareId);
    expect(await services.db.select().from(shareRecipients).where(eq(shareRecipients.userId, bob.userId))).toHaveLength(1);
    const tray = await (await sharesRoute.GET(req("/v1/shares?role=received", "GET", bob))).json();
    expect(tray.shares.map((s: { id: string }) => s.id)).toEqual([shareId]);
    // Bob can now fetch via the recipient route.
    expect((await shareFileRoute.GET(req("/x", "GET", bob), { params: Promise.resolve({ id: shareId, name: "cover.jpg" }) })).status).toBe(200);

    expect((await linksClaimRoute.POST(req("/x", "POST", alice, { token }))).status).toBe(404);
    expect((await linksClaimRoute.POST(req("/x", "POST", bob, { token: "unknown" }))).status).toBe(404);
    expect((await linksClaimRoute.POST(req("/x", "POST", bob, {}))).status).toBe(400);
  });

  it("never logs a token", async () => {
    const lines: string[] = [];
    for (const level of ["log", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" ")));
    }
    try {
      const unknown = crypto.randomBytes(32).toString("base64url");
      await page(token);
      await page(unknown);
      await fileOf(token, "nope.mp3");
      await fileOf(unknown, "cover.jpg");
      await zipOf(unknown);
      await linksClaimRoute.POST(req("/x", "POST", bob, { token: unknown }));
      services.rateLimiters.publicShareByLink = new InMemoryRateLimiter(1, 60_000);
      await page(token);
      await page(token); // 429
      await services.shares.egressReport();
    } finally {
      vi.restoreAllMocks();
    }
    const logged = lines.join("\n");
    expect(logged).toContain('"route":"/s/[token]"');
    expect(logged).toContain('"route":"/s/[token]/files/[name]"');
    expect(logged).toContain('"route":"/s/[token]/zip"');
    expect(logged).toContain('"status":404');
    expect(logged).toContain('"status":429');
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(hashLinkToken(token));
    expect(logged).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });

  it("rate limits /s/* per IP and per link, and links/claim and create per user", async () => {
    services.rateLimiters.publicShareByIp = new InMemoryRateLimiter(3, 60_000);
    expect([(await page(token, "1.1.1.1")).status, (await page(token, "1.1.1.1")).status, (await page(token, "1.1.1.1")).status]).toEqual([200, 200, 200]);
    expect((await page(token, "1.1.1.1")).status).toBe(429);
    expect((await page(token, "2.2.2.2")).status).toBe(200);
    services.rateLimiters.publicShareByIp = new InMemoryRateLimiter(1000, 60_000);
    services.rateLimiters.publicShareByLink = new InMemoryRateLimiter(2, 60_000);
    expect((await page(token)).status).toBe(200);
    expect((await fileOf(token, "cover.jpg")).status).toBe(302);
    expect((await zipOf(token)).status).toBe(429);
    // An unknown token is charged to its own hash and gets the same limit.
    const unknown = crypto.randomBytes(32).toString("base64url");
    expect([(await page(unknown)).status, (await page(unknown)).status, (await page(unknown)).status]).toEqual([404, 404, 429]);

    services.rateLimiters.linkClaim = new InMemoryRateLimiter(2, 60_000);
    expect((await linksClaimRoute.POST(req("/x", "POST", bob, { token }))).status).toBe(200);
    expect((await linksClaimRoute.POST(req("/x", "POST", bob, { token }))).status).toBe(200);
    expect((await linksClaimRoute.POST(req("/x", "POST", bob, { token }))).status).toBe(429);

    services.rateLimiters.shareCreate = new InMemoryRateLimiter(2, 60_000);
    const body = { releaseId: record.id, recipients: ["bob@example.com"] };
    expect((await createShare(alice, body)).res.status).toBe(201);
    expect((await createShare(alice, body)).res.status).toBe(201);
    expect((await createShare(alice, body)).res.status).toBe(429);
    const open = await createShare(bob, { releaseId: crypto.randomUUID(), recipients: [] });
    expect(open.res.status).toBe(404); // another user is unaffected by Alice's limit
  });
});

describe("daily cron share egress", () => {
  it("logs one JSON line with 24 h totals and the top 10 shares, warning past the threshold", async () => {
    services = await createTestServices();
    const alice = await signIn("alice@example.com");
    const bob = await signIn("bob@example.com");
    const { record } = await seedRelease(alice);
    const a = await createShare(alice, { releaseId: record.id, recipients: ["bob@example.com"] });
    const b = await createShare(alice, { releaseId: record.id, recipients: ["bob@example.com"] });
    const name = record.tracks[0]!.file;
    for (const id of [a.body.share.id, a.body.share.id, b.body.share.id]) {
      await shareFileRoute.GET(req("/x", "GET", bob), { params: Promise.resolve({ id, name }) });
    }
    // An old row is outside the window.
    await services.db.insert(shareDownloads).values({ shareId: b.body.share.id, name, at: Date.now() - 2 * 86_400_000, via: "link", bytes: 999_999 });

    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(String(args[0])));
    const warn = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => void lines.push(String(args[0])));
    try {
      expect((await cleanupRoute.GET(req("/v1/internal/cleanup", "GET"))).status).toBe(200);
      const info = JSON.parse(lines.find((l) => l.includes('"share_egress"'))!);
      expect(info).toMatchObject({ level: "info", event: "share_egress", totalBytes: 3 * record.tracks[0]!.bytes, totalDownloads: 3, windowHours: 24 });
      expect(info.topByDownloads[0]).toEqual({ shareId: a.body.share.id, downloads: 2, bytes: 2 * record.tracks[0]!.bytes });
      expect(info.topByBytes).toHaveLength(2);

      lines.length = 0;
      services.shareEgressAlertBytes = 1;
      await cleanupRoute.GET(req("/v1/internal/cleanup", "GET"));
      expect(JSON.parse(lines.find((l) => l.includes('"share_egress"'))!).level).toBe("warn");
      expect(warn).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("migration", () => {
  it("applies on a fresh database and creates the share tables additively", async () => {
    const db = createDb(":memory:");
    await migrateDb(db);
    const tables = (await db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(["shares", "share_recipients", "share_links", "share_downloads", "users", "releases"]));
    const cols = (await db.all<{ name: string }>(sql`select name from pragma_table_info('shares')`)).map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining(["id", "owner_user_id", "release_id", "file_owner_user_id", "parent_share_id", "depth", "track_ids_json", "visibility", "allow_reshare", "expires_at", "revoked_at", "created_at", "snapshot_json"])
    );
    const dl = (await db.all<{ name: string }>(sql`select name from pragma_table_info('share_downloads')`)).map((c) => c.name);
    expect(dl).toEqual(expect.arrayContaining(["share_id", "name", "at", "via", "bytes"]));
    await migrateDb(db); // idempotent
  });
});

/** A tiny reader for the archives `createZipStream` writes: walks the central directory and checks each CRC. */
function readStoreOnlyZip(zip: Buffer): Array<{ name: string; data: Buffer }> {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  expect(eocd).toBeGreaterThanOrEqual(0);
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out: Array<{ name: string; data: Buffer }> = [];
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    expect(zip.readUInt16LE(p + 10)).toBe(0); // stored
    const crc = zip.readUInt32LE(p + 16);
    const size = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const offset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    expect(zip.readUInt32LE(offset)).toBe(0x04034b50);
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    const data = zip.subarray(start, start + size);
    expect(zip.readUInt32LE(start + size)).toBe(0x08074b50);
    expect(zip.readUInt32LE(start + size + 4)).toBe(crc);
    expect(crc32(data)).toBe(crc);
    out.push({ name, data });
    p += 46 + nameLen;
  }
  return out;
}

