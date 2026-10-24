import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpSyncApi, SyncConflictError, SyncRequestError, TooManyCollectionsError } from "../../src/server/sync/SyncApi";

const valid = path.resolve(__dirname, "../../../../spec/fixtures/collections/valid.json");
const unknown = path.resolve(__dirname, "../../../../spec/fixtures/collections/unknown-kind.json");

let fetchMock: ReturnType<typeof vi.fn>;
let calls: { url: string; init: RequestInit | undefined }[];

function reply(body: unknown, status = 200): void {
  fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
}

beforeEach(() => {
  calls = [];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const api = () => new HttpSyncApi("http://localhost:4000", "tok");

describe("HttpSyncApi collections", () => {
  it("lists a page as the wire sends it, keeping an unknown item untouched", async () => {
    const rec = JSON.parse(await fs.readFile(valid, "utf-8"));
    const odd = JSON.parse(await fs.readFile(unknown, "utf-8"));
    reply({
      collections: [
        { ...rec, version: 4, serverUpdatedAt: "2026-10-23T20:00:01Z" },
        { ...odd, id: "5b7d2a10-3c4e-4f68-9a21-8e6f1d0c2b34", version: 6, serverUpdatedAt: "2026-10-23T20:00:02Z" },
        { id: "garbage" },
      ],
      nextVersion: 6,
      hasMore: true,
    });
    const page = await api().listCollections(2, 200);
    expect(calls[0].url).toBe("http://localhost:4000/v1/collections?sinceVersion=2&limit=200");
    expect(page).toMatchObject({ nextVersion: 6, hasMore: true });
    expect(page.collections).toHaveLength(2);
    expect(page.collections[0]).toMatchObject({ id: rec.id, version: 4, name: "Late drives" });
    expect(page.collections[1].items).toEqual(odd.items);
  });

  it("PUTs the record to /v1/collections/:id and reads { version, pruned }", async () => {
    const rec = JSON.parse(await fs.readFile(valid, "utf-8"));
    reply({ version: 5, pruned: 2 });
    expect(await api().putCollection(rec)).toEqual({ version: 5, pruned: 2 });
    expect(calls[0].url).toBe(`http://localhost:4000/v1/collections/${rec.id}`);
    expect(calls[0].init?.method).toBe("PUT");
    expect(JSON.parse(calls[0].init?.body as string)).toEqual(rec);
  });

  it("a 409 is a conflict, and a 409 too_many_collections is its own error", async () => {
    const rec = JSON.parse(await fs.readFile(valid, "utf-8"));
    reply({ error: "stale" }, 409);
    await expect(api().putCollection(rec)).rejects.toBeInstanceOf(SyncConflictError);
    reply({ error: "too_many_collections" }, 409);
    await expect(api().putCollection(rec)).rejects.toBeInstanceOf(TooManyCollectionsError);
  });

  it("carries a 404 and a 429 with their status; DELETE returns { version }", async () => {
    reply({ error: "nope" }, 404);
    await expect(api().listCollections(0, 200)).rejects.toMatchObject({ status: 404 });
    reply({ error: "slow" }, 429);
    await expect(api().listCollections(0, 200)).rejects.toBeInstanceOf(SyncRequestError);
    reply({ version: 9 });
    expect(await api().deleteCollection("abc")).toEqual({ version: 9 });
    expect(calls.at(-1)?.init?.method).toBe("DELETE");
  });
});
