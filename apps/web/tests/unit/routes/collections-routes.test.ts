import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileCollectionStore } from "../../../src/server/collections/FileCollectionStore";
import type { Services } from "../../../src/server/container";

let services: Services;
let root: string;
let originalEnv: string | undefined;

vi.mock("../../../src/server/container", () => ({
  getServices: () => {
    if (process.env.LOCALLY_DEMO === "1") throw new Error("getServices must not be called in demo mode");
    return services;
  },
}));

import { GET, POST } from "../../../src/app/api/collections/route";
import { DELETE, PUT } from "../../../src/app/api/collections/[id]/route";

const REL = "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90";
const TRK = "c41e8b27-6d95-4a30-b1f2-9e7a3c5d8f04";
const json = (method: string, body?: unknown) =>
  new NextRequest("http://localhost/api/collections", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  originalEnv = process.env.LOCALLY_CONFIG_DIR;
  root = await fs.mkdtemp(path.join(os.tmpdir(), "sli-collections-route-"));
  process.env.LOCALLY_CONFIG_DIR = path.join(root, "config");
  services = { collections: new FileCollectionStore(), syncEngine: { collectionsSyncProblem: () => null } } as unknown as Services;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (originalEnv === undefined) delete process.env.LOCALLY_CONFIG_DIR;
  else process.env.LOCALLY_CONFIG_DIR = originalEnv;
  await fs.rm(root, { recursive: true, force: true });
});

describe("/api/collections", () => {
  it("creates, adds a release and a track, reorders, and deletes", async () => {
    const made = await POST(json("POST", { name: "  Late drives " }));
    expect(made.status).toBe(201);
    const { collection } = await made.json();
    expect(collection.name).toBe("Late drives");

    const items = [
      { kind: "release", releaseId: REL },
      { kind: "track", releaseId: REL, trackId: TRK },
    ];
    expect((await PUT(json("PUT", { items }), ctx(collection.id))).status).toBe(200);
    const reordered = await PUT(json("PUT", { items: [items[1], items[0]] }), ctx(collection.id));
    expect((await reordered.json()).collection.items).toEqual([items[1], items[0]]);

    const list = await (await GET()).json();
    expect(list.collections).toHaveLength(1);
    expect(list.collections[0].items[0]).toEqual(items[1]);

    expect((await DELETE(json("DELETE"), ctx(collection.id))).status).toBe(200);
    expect((await (await GET()).json()).collections).toEqual([]);
    expect((await DELETE(json("DELETE"), ctx(collection.id))).status).toBe(404);
  });

  it("refuses a bad name, a duplicate item, a malformed known item and a bad id", async () => {
    expect((await POST(json("POST", { name: "   " }))).status).toBe(400);
    expect((await POST(json("POST", { name: "x".repeat(101) }))).status).toBe(400);
    expect((await POST(json("POST", { name: "ok", extra: 1 }))).status).toBe(400);
    const dup = { kind: "release", releaseId: REL };
    expect((await POST(json("POST", { name: "ok", items: [dup, dup] }))).status).toBe(400);
    expect((await POST(json("POST", { name: "ok", items: [{ kind: "track", releaseId: REL }] }))).status).toBe(400);
    expect((await PUT(json("PUT", { name: "x" }), ctx("not-a-uuid"))).status).toBe(400);
  });

  it("keeps an item of an unknown kind as sent", async () => {
    const odd = { kind: "tape-side", releaseId: REL, side: "B" };
    const made = await POST(json("POST", { name: "ok", items: [odd] }));
    expect((await made.json()).collection.items).toEqual([odd]);
  });

  it("answers 404 for a collection that is not there", async () => {
    expect((await PUT(json("PUT", { name: "x" }), ctx("9c1e2f40-6b3a-4d7e-8a51-2f0c9d4b7e13"))).status).toBe(404);
  });

  it("the demo serves three collections and answers 403 to writes without touching services", async () => {
    vi.stubEnv("LOCALLY_DEMO", "1");
    const list = await (await GET()).json();
    expect(list.collections).toHaveLength(3);
    expect((await POST(json("POST", { name: "x" }))).status).toBe(403);
    expect((await PUT(json("PUT", { name: "x" }), ctx("9c1e2f40-6b3a-4d7e-8a51-2f0c9d4b7e13"))).status).toBe(403);
    expect((await DELETE(json("DELETE"), ctx("9c1e2f40-6b3a-4d7e-8a51-2f0c9d4b7e13"))).status).toBe(403);
  });
});
