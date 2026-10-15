import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { playsFilePath } from "../../src/server/config/paths";
import { FilePlayCountStore } from "../../src/server/plays/FilePlayCountStore";

let root: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  originalEnv = process.env.LOCALLY_CONFIG_DIR;
  root = await fs.mkdtemp(path.join(os.tmpdir(), "sli-plays-store-"));
  process.env.LOCALLY_CONFIG_DIR = path.join(root, "config");
});

afterEach(async () => {
  if (originalEnv === undefined) delete process.env.LOCALLY_CONFIG_DIR;
  else process.env.LOCALLY_CONFIG_DIR = originalEnv;
  await fs.rm(root, { recursive: true, force: true });
});

describe("FilePlayCountStore", () => {
  it("reads empty when there is no file", async () => {
    expect(await new FilePlayCountStore().get()).toEqual({ version: 1, tracks: {} });
  });

  it("increments and round-trips with pushed starting at 0", async () => {
    const store = new FilePlayCountStore();
    await store.increment("t1", "r1");
    await store.increment("t1", "r1");
    await store.increment("t2", "r1");
    expect(await new FilePlayCountStore().get()).toEqual({
      version: 1,
      tracks: {
        t1: { releaseId: "r1", count: 2, pushed: 0 },
        t2: { releaseId: "r1", count: 1, pushed: 0 },
      },
    });
  });

  it("does not lose concurrent increments", async () => {
    const store = new FilePlayCountStore();
    await Promise.all(Array.from({ length: 10 }, () => store.increment("t1", "r1")));
    expect((await store.get()).tracks.t1.count).toBe(10);
  });

  it("removeRelease drops only that release's tracks", async () => {
    const store = new FilePlayCountStore();
    await store.increment("t1", "r1");
    await store.increment("t2", "r2");
    await store.removeRelease("r1");
    expect(Object.keys((await store.get()).tracks)).toEqual(["t2"]);
  });

  it("markPushed records what was sent, only moves up, and ignores a dropped track", async () => {
    const store = new FilePlayCountStore();
    await store.increment("t1", "r1");
    await store.increment("t1", "r1");
    await store.markPushed({ t1: 2, gone: 4 });
    expect((await store.get()).tracks.t1.pushed).toBe(2);
    await store.markPushed({ t1: 1 });
    expect((await store.get()).tracks.t1.pushed).toBe(2);
    expect(Object.keys((await store.get()).tracks)).toEqual(["t1"]);
  });

  it("a play counted after a push stays pending", async () => {
    const store = new FilePlayCountStore();
    await store.increment("t1", "r1");
    await store.markPushed({ t1: 1 });
    await store.increment("t1", "r1");
    expect((await store.get()).tracks.t1).toEqual({ releaseId: "r1", count: 2, pushed: 1 });
  });

  it("resetPushed clears every marker and keeps every count", async () => {
    const store = new FilePlayCountStore();
    await store.increment("t1", "r1");
    await store.increment("t2", "r2");
    await store.increment("t2", "r2");
    await store.markPushed({ t1: 1, t2: 2 });
    await store.resetPushed();
    expect((await store.get()).tracks).toEqual({
      t1: { releaseId: "r1", count: 1, pushed: 0 },
      t2: { releaseId: "r2", count: 2, pushed: 0 },
    });
  });

  it("reads an invalid or corrupt file as empty", async () => {
    await fs.mkdir(path.dirname(playsFilePath()), { recursive: true });
    await fs.writeFile(playsFilePath(), JSON.stringify({ version: 1, tracks: { t: { count: "x" } } }));
    expect(await new FilePlayCountStore().get()).toEqual({ version: 1, tracks: {} });
    await fs.writeFile(playsFilePath(), "{not json");
    expect(await new FilePlayCountStore().get()).toEqual({ version: 1, tracks: {} });
  });

  it("writes plays.json with mode 0600", async () => {
    await new FilePlayCountStore().increment("t1", "r1");
    const stat = await fs.stat(playsFilePath());
    expect((stat.mode & 0o777).toString(8)).toBe("600");
  });
});
