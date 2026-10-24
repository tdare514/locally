import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { collections } from "../../src/db/schema";
import { createTestServices, type TestServices } from "../support/testServices";
import { makeReleaseRecord } from "../support/fixtures";

let testServices: TestServices;

vi.mock("../../src/server/container", () => ({
  getServices: async () => testServices,
}));

import * as authCodeRoute from "../../src/app/v1/auth/code/route";
import * as authVerifyRoute from "../../src/app/v1/auth/verify/route";
import * as listRoute from "../../src/app/v1/collections/route";
import * as itemRoute from "../../src/app/v1/collections/[id]/route";
import * as releaseRoute from "../../src/app/v1/releases/[id]/route";
import * as meRoute from "../../src/app/v1/me/route";

const fixturesDir = fileURLToPath(new URL("../../../../spec/fixtures/collections/", import.meta.url));
const fixture = (name: string) => JSON.parse(readFileSync(`${fixturesDir}${name}`, "utf8")) as Record<string, unknown> & { items: Record<string, unknown>[] };

type Item = Record<string, unknown>;

function req(url: string, method: string, token: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signIn(email: string): Promise<{ token: string; userId: string }> {
  await authCodeRoute.POST(new Request("http://localhost/v1/auth/code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }));
  await new Promise<void>((r) => queueMicrotask(() => r()));
  const code = testServices.mailer.codeFor(email);
  const res = await authVerifyRoute.POST(
    new Request("http://localhost/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code, deviceName: "Mac", platform: "mac" }),
    })
  );
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

function makeCollection(items: Item[] = [], overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    syncVersion: 1,
    id: crypto.randomUUID(),
    name: "Late drives",
    items,
    origin: "mac",
    originDevice: "Toby's MacBook",
    createdAt: now,
    updatedAt: now,
    deleted: false,
    ...overrides,
  } as Record<string, unknown> & { id: string; items: Item[] };
}

const releaseItem = (releaseId: string): Item => ({ kind: "release", releaseId });
const trackItem = (releaseId: string, trackId: string): Item => ({ kind: "track", releaseId, trackId });

const put = (token: string, c: Record<string, unknown>, body: unknown = c) =>
  itemRoute.PUT(req(`http://localhost/v1/collections/${c.id as string}`, "PUT", token, body), { params: Promise.resolve({ id: c.id as string }) });
const del = (token: string, id: string) =>
  itemRoute.DELETE(req(`http://localhost/v1/collections/${id}`, "DELETE", token), { params: Promise.resolve({ id }) });
const list = async (token: string, query = "") => {
  const res = await listRoute.GET(req(`http://localhost/v1/collections${query}`, "GET", token));
  return { status: res.status, body: await res.json() };
};
async function pushRelease(token: string) {
  const r = makeReleaseRecord();
  const res = await releaseRoute.PUT(req(`http://localhost/v1/releases/${r.id}`, "PUT", token, r), { params: Promise.resolve({ id: r.id }) });
  expect(res.status).toBe(200);
  return r;
}
const deleteRelease = (token: string, id: string) =>
  releaseRoute.DELETE(req(`http://localhost/v1/releases/${id}`, "DELETE", token), { params: Promise.resolve({ id }) });
const itemsOf = async (token: string, id: string) =>
  ((await list(token)).body.collections as { id: string; items: Item[] }[]).find((c) => c.id === id)!.items;

let n = 0;
const newUser = () => signIn(`coll-${n++}-${crypto.randomUUID().slice(0, 6)}@example.com`);

describe("collections API", () => {
  beforeAll(async () => {
    testServices = await createTestServices();
  });

  it("puts, pulls and deletes", async () => {
    const u = await newUser();
    const c = makeCollection([releaseItem(crypto.randomUUID())]);
    const res = await put(u.token, c);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 1, pruned: 0 });

    const pulled = await list(u.token);
    expect(pulled.body.collections).toHaveLength(1);
    expect(pulled.body.collections[0]).toMatchObject({ id: c.id, name: "Late drives", version: 1, deleted: false });
    expect(pulled.body.nextVersion).toBe(1);

    const d = await del(u.token, c.id);
    expect(await d.json()).toEqual({ version: 2 });
    const after = await list(u.token, "?sinceVersion=1");
    expect(after.body.collections[0]).toMatchObject({ id: c.id, deleted: true, version: 2 });
  });

  it("pages like releases and bounds the limit", async () => {
    const u = await newUser();
    for (let i = 0; i < 3; i++) await put(u.token, makeCollection());
    const page1 = await list(u.token, "?limit=2");
    expect(page1.body.collections).toHaveLength(2);
    expect(page1.body.hasMore).toBe(true);
    expect(page1.body.nextVersion).toBe(2);
    const page2 = await list(u.token, `?sinceVersion=${page1.body.nextVersion}&limit=2`);
    expect(page2.body.collections).toHaveLength(1);
    expect(page2.body.hasMore).toBe(false);
    expect(page2.body.nextVersion).toBe(3);
    expect((await list(u.token, "?limit=0")).status).toBe(400);
    expect((await list(u.token, "?limit=abc")).status).toBe(400);
    expect((await list(u.token, "?limit=9999")).body.collections).toHaveLength(3);
  });

  it("last writer wins: a newer stored record gives 409, an equal one is accepted", async () => {
    const u = await newUser();
    const c = makeCollection([], { updatedAt: "2026-10-23T20:00:10Z" });
    expect((await put(u.token, c)).status).toBe(200);
    expect((await put(u.token, c)).status).toBe(200);
    const older = { ...c, updatedAt: "2026-10-23T20:00:00Z", name: "Old" };
    const res = await put(u.token, older);
    expect(res.status).toBe(409);
    expect((await list(u.token)).body.collections[0].name).toBe("Late drives");
  });

  it("refuses bad shapes with 400", async () => {
    const u = await newUser();
    const rid = crypto.randomUUID();
    const cases: [string, Record<string, unknown>][] = [
      ["empty name", { name: "   " }],
      ["long name", { name: "x".repeat(101) }],
      ["control character", { name: "bad\u0007name" }],
      ["too many items", { items: Array.from({ length: 1001 }, () => releaseItem(crypto.randomUUID())) }],
      ["duplicate release item", { items: [releaseItem(rid), releaseItem(rid)] }],
      ["duplicate track item", { items: [trackItem(rid, rid), trackItem(rid, rid)] }],
      ["track without trackId", { items: [{ kind: "track", releaseId: rid }] }],
      ["release with an extra key", { items: [{ kind: "release", releaseId: rid, x: 1 }] }],
      ["bad kind shape", { items: [{ kind: "Tape Side" }] }],
      ["no kind", { items: [{ releaseId: rid }] }],
      ["oversized unknown item", { items: [{ kind: "tape-side", note: "x".repeat(1100) }] }],
    ];
    for (const [label, over] of cases) {
      const res = await put(u.token, makeCollection([], over));
      expect(res.status, label).toBe(400);
    }
    const mismatch = makeCollection();
    const res = await itemRoute.PUT(req(`http://localhost/v1/collections/${crypto.randomUUID()}`, "PUT", u.token, mismatch), {
      params: Promise.resolve({ id: crypto.randomUUID() }),
    });
    expect(res.status).toBe(400);
  });

  it("allows a track item next to its release item, and trims the name", async () => {
    const u = await newUser();
    const rid = crypto.randomUUID();
    const c = makeCollection([releaseItem(rid), trackItem(rid, crypto.randomUUID())], { name: "  Mix  " });
    expect((await put(u.token, c)).status).toBe(200);
    expect((await list(u.token)).body.collections[0].name).toBe("Mix");
  });

  it("matches the shared fixtures", async () => {
    const u = await newUser();
    for (const name of ["valid.json", "missing-track.json"]) {
      expect((await put(u.token, fixture(name))).status, name).toBe(200);
    }
    const unknown = { ...fixture("unknown-kind.json"), id: crypto.randomUUID() };
    expect((await put(u.token, unknown)).status).toBe(200);
    expect(await itemsOf(u.token, unknown.id as string)).toEqual(unknown.items);
    const bad = fixture("invalid-known-item.json");
    expect((await put(u.token, bad)).status).toBe(400);
  });

  it("round-trips an unknown kind unchanged", async () => {
    const u = await newUser();
    const odd = { kind: "tape-side", side: "B", nested: { a: [1, 2, { b: null }] } };
    const c = makeCollection([releaseItem(crypto.randomUUID()), odd]);
    expect((await put(u.token, c)).status).toBe(200);
    expect(await itemsOf(u.token, c.id)).toEqual(c.items);
  });

  it("caps live collections per user at 1,000 and frees a slot on delete", async () => {
    const u = await newUser();
    const now = Date.now();
    await testServices.db.insert(collections).values(
      Array.from({ length: 1000 }, (_, i) => {
        const id = crypto.randomUUID();
        const record = makeCollection([], { id }) as never;
        return { id, userId: u.userId, version: i + 1, record, updatedAt: now, deleted: false, serverUpdatedAt: now };
      })
    );
    const extra = makeCollection();
    const res = await put(u.token, extra);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "too_many_collections" });
    const [first] = await testServices.db.select().from(collections).where(eq(collections.userId, u.userId)).limit(1);
    expect((await del(u.token, first!.id)).status).toBe(200);
    expect((await put(u.token, extra)).status).toBe(200);
    // Updating an existing live one at the cap is fine.
    const [second] = await testServices.db.select().from(collections).where(eq(collections.userId, u.userId)).limit(2);
    expect((await put(u.token, { ...(second!.record as Record<string, unknown>), name: "Renamed", updatedAt: new Date(now + 1000).toISOString() })).status).toBe(200);
  });

  it("a release DELETE drops its items from every live collection naming it", async () => {
    const u = await newUser();
    const r1 = await pushRelease(u.token);
    const r2 = await pushRelease(u.token);
    const a = makeCollection([releaseItem(r1.id), trackItem(r1.id, r1.tracks[0]!.id), releaseItem(r2.id)]);
    const b = makeCollection([trackItem(r1.id, r1.tracks[0]!.id), { kind: "tape-side", releaseId: r1.id }]);
    const c = makeCollection([releaseItem(r2.id)]);
    for (const x of [a, b, c]) expect((await put(u.token, x)).status).toBe(200);
    const before = (await list(u.token)).body;

    expect((await deleteRelease(u.token, r1.id)).status).toBe(200);

    const after = (await list(u.token)).body.collections as { id: string; items: Item[]; version: number; updatedAt: string; serverUpdatedAt: string }[];
    const get = (id: string) => after.find((x) => x.id === id)!;
    expect(get(a.id).items).toEqual([releaseItem(r2.id)]);
    expect(get(b.id).items).toEqual([{ kind: "tape-side", releaseId: r1.id }]);
    expect(get(c.id).items).toEqual([releaseItem(r2.id)]);
    expect(get(c.id).version).toBeLessThan(get(a.id).version);
    const versions = after.map((x) => x.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect(get(a.id).version).toBeGreaterThan(before.nextVersion);
    expect(Date.parse(get(a.id).updatedAt)).toBeGreaterThan(Date.parse(a.updatedAt as string) - 1);
    expect(get(a.id).serverUpdatedAt).toBeTruthy();
    // The untouched collection keeps its version.
    expect(get(c.id).version).toBe(5);
  });

  it("a release PUT with deleted:true prunes too, and a lost PUT prunes nothing", async () => {
    const u = await newUser();
    const r = await pushRelease(u.token);
    const c = makeCollection([releaseItem(r.id)]);
    await put(u.token, c);
    const stale = { ...r, deleted: true, updatedAt: new Date(Date.parse(r.updatedAt) - 60_000).toISOString() };
    expect((await releaseRoute.PUT(req(`http://localhost/v1/releases/${r.id}`, "PUT", u.token, stale), { params: Promise.resolve({ id: r.id }) })).status).toBe(409);
    expect(await itemsOf(u.token, c.id)).toHaveLength(1);

    const win = { ...r, deleted: true, updatedAt: new Date(Date.parse(r.updatedAt) + 60_000).toISOString() };
    expect((await releaseRoute.PUT(req(`http://localhost/v1/releases/${r.id}`, "PUT", u.token, win), { params: Promise.resolve({ id: r.id }) })).status).toBe(200);
    expect(await itemsOf(u.token, c.id)).toEqual([]);
  });

  it("a tombstoned collection is left alone by the release prune", async () => {
    const u = await newUser();
    const r = await pushRelease(u.token);
    const c = makeCollection([releaseItem(r.id)]);
    await put(u.token, c);
    await del(u.token, c.id);
    await deleteRelease(u.token, r.id);
    expect(await itemsOf(u.token, c.id)).toEqual([releaseItem(r.id)]);
  });

  it("a collection PUT drops items of tombstoned releases, keeps unknown ones, and reports pruned", async () => {
    const u = await newUser();
    const dead = await pushRelease(u.token);
    const live = await pushRelease(u.token);
    await deleteRelease(u.token, dead.id);
    const unknownRelease = crypto.randomUUID();
    const c = makeCollection([releaseItem(dead.id), trackItem(dead.id, crypto.randomUUID()), releaseItem(live.id), releaseItem(unknownRelease)]);
    const res = await put(u.token, c);
    expect(await res.json()).toMatchObject({ pruned: 2 });
    expect(await itemsOf(u.token, c.id)).toEqual([releaseItem(live.id), releaseItem(unknownRelease)]);
  });

  it("a release deleted at the same moment as a collection PUT never leaves the item stored", async () => {
    const u = await newUser();
    const r = await pushRelease(u.token);
    const c = makeCollection([releaseItem(r.id)]);
    const [putRes, delRes] = await Promise.all([put(u.token, c), deleteRelease(u.token, r.id)]);
    expect(delRes.status).toBe(200);
    expect(putRes.status).toBe(200);
    const body = (await putRes.json()) as { pruned: number };
    expect(await itemsOf(u.token, c.id)).toEqual([]);
    // Either the PUT pruned it itself, or the release delete rewrote the stored collection afterwards.
    expect([0, 1]).toContain(body.pruned);
  });

  it("answers 404 for another user's id on every route, and hides it from lists", async () => {
    const alice = await newUser();
    const bob = await newUser();
    const c = makeCollection([releaseItem(crypto.randomUUID())]);
    await put(alice.token, c);
    expect((await put(bob.token, { ...c, name: "Mine now" })).status).toBe(404);
    expect((await del(bob.token, c.id)).status).toBe(404);
    expect((await list(bob.token)).body.collections).toEqual([]);
    expect((await list(alice.token)).body.collections[0].name).toBe("Late drives");
  });

  it("removes collections with the account", async () => {
    const u = await newUser();
    await put(u.token, makeCollection());
    const me = await (await meRoute.GET(req("http://localhost/v1/me", "GET", u.token))).json();
    const res = await testServices.account.deleteAccount(u.userId, me.user.email);
    expect(res.deletedDevices).toBe(1);
    expect(await testServices.db.select().from(collections).where(eq(collections.userId, u.userId))).toEqual([]);
  });
});
