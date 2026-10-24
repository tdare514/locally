import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectionsFilePath } from "../../src/server/config/paths";
import { FileCollectionStore } from "../../src/server/collections/FileCollectionStore";
import { parseCollectionRecord, type CollectionRecord } from "../../src/shared/collections";

const FIXTURES = path.resolve(__dirname, "../../../../spec/fixtures/collections");
const fixture = async (name: string) => JSON.parse(await fs.readFile(path.join(FIXTURES, name), "utf-8"));

let root: string;
let originalEnv: string | undefined;
let clock: number;
const store = () => new FileCollectionStore(() => new Date(clock));

beforeEach(async () => {
  originalEnv = process.env.LOCALLY_CONFIG_DIR;
  root = await fs.mkdtemp(path.join(os.tmpdir(), "sli-collections-store-"));
  process.env.LOCALLY_CONFIG_DIR = path.join(root, "config");
  clock = Date.UTC(2026, 9, 23, 20);
});

afterEach(async () => {
  if (originalEnv === undefined) delete process.env.LOCALLY_CONFIG_DIR;
  else process.env.LOCALLY_CONFIG_DIR = originalEnv;
  await fs.rm(root, { recursive: true, force: true });
});

describe("FileCollectionStore", () => {
  it("reads empty when there is no file", async () => {
    expect(await store().list()).toEqual([]);
  });

  it("writes atomically (no temp files left) with mode 0600", async () => {
    const s = store();
    await s.create({ name: "Late drives", items: [], originDevice: "Test Mac" });
    const dir = path.dirname(collectionsFilePath());
    expect(await fs.readdir(dir)).toEqual(["collections.json"]);
    const mode = (await fs.stat(collectionsFilePath())).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("creates, updates (a newer stamp each time), and tombstones", async () => {
    const s = store();
    const made = await s.create({ name: "A", items: [], originDevice: "Mac" });
    expect(made).toMatchObject({ syncVersion: 1, origin: "mac", deleted: false, name: "A" });
    const renamed = await s.update(made.id, { name: "B" });
    expect(renamed?.name).toBe("B");
    expect(renamed!.updatedAt > made.updatedAt).toBe(true);
    expect(await s.update("nope", { name: "x" })).toBeNull();
    expect(await s.remove(made.id)).toBe(true);
    expect(await s.list()).toEqual([]);
    expect((await s.entries())[0].record.deleted).toBe(true);
    expect(await s.update(made.id, { name: "C" })).toBeNull();
  });

  it("keeps an item of an unknown kind byte for byte", async () => {
    const raw = await fixture("unknown-kind.json");
    const s = store();
    expect(await s.applyRemote(parseCollectionRecord(raw)!)).toBe("applied");
    const back = (await store().entries())[0].record;
    expect(back.items).toEqual(raw.items);
    // An edit that leaves the unknown item alone keeps it.
    const first = back.items[0];
    await s.update(back.id, { items: [back.items[1], first] });
    expect((await store().list())[0].items[0]).toEqual(raw.items[1]);
  });

  it("applyRemote: last writer wins, a newer unpushed local copy stays", async () => {
    const s = store();
    const valid = (await fixture("valid.json")) as CollectionRecord;
    await s.applyRemote(valid);
    expect(await s.applyRemote(valid)).toBe("unchanged");
    // A local edit, not pushed.
    clock = Date.parse(valid.updatedAt) + 60_000;
    await s.update(valid.id, { name: "Local edit" });
    expect(await s.applyRemote({ ...valid, name: "Older remote" })).toBe("kept-local");
    expect((await s.list())[0].name).toBe("Local edit");
    // A newer remote replaces it.
    const newer = { ...valid, name: "Remote wins", updatedAt: new Date(clock + 60_000).toISOString() };
    expect(await s.applyRemote(newer)).toBe("applied");
    expect((await s.list())[0].name).toBe("Remote wins");
  });

  it("markPushed never marks a newer local revision as pushed", async () => {
    const s = store();
    const made = await s.create({ name: "A", items: [], originDevice: "Mac" });
    clock += 60_000;
    const edited = await s.update(made.id, { name: "B" });
    await s.markPushed(made.id, made.updatedAt); // the PUT that was in flight carried the old revision
    expect((await s.entries())[0].pushed).toBeNull();
    await s.markPushed(made.id, edited!.updatedAt);
    expect((await s.entries())[0].pushed).toBe(edited!.updatedAt);
  });

  it("a different account clears the pushed markers", async () => {
    const s = store();
    const made = await s.create({ name: "A", items: [], originDevice: "Mac" });
    await s.bindAccount("host\na@b.c");
    await s.markPushed(made.id, made.updatedAt);
    expect((await s.entries())[0].pushed).toBe(made.updatedAt);
    await s.bindAccount("host\na@b.c");
    expect((await s.entries())[0].pushed).toBe(made.updatedAt);
    await s.bindAccount("host\nother@b.c");
    expect((await s.entries())[0].pushed).toBeNull();
  });

  it("drops an entry that does not parse, keeps the rest", async () => {
    const s = store();
    const made = await s.create({ name: "Keep", items: [], originDevice: "Mac" });
    const file = JSON.parse(await fs.readFile(collectionsFilePath(), "utf-8"));
    file.collections["bad"] = { record: { id: "bad" }, pushed: null };
    await fs.writeFile(collectionsFilePath(), JSON.stringify(file));
    expect((await store().list()).map((c) => c.id)).toEqual([made.id]);
  });
});
