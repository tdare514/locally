import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { playsFilePath } from "../../src/server/config/paths";
import { FilePlayCountStore } from "../../src/server/plays/FilePlayCountStore";

const DAY = "2026-10-15";
/** Noon UTC on DAY: the same date in every zone the tests use. */
const NOW = Date.UTC(2026, 9, 15, 12);

/** The clock and zone are injected, so no test depends on today's date or the machine's zone. */
const newStore = () => new FilePlayCountStore(() => NOW, "UTC");

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
    expect(await newStore().get()).toEqual({ version: 1, tracks: {} });
  });

  it("increments and round-trips with pushed starting at 0", async () => {
    const store = newStore();
    await store.increment("t1", "r1", DAY);
    await store.increment("t1", "r1", DAY);
    await store.increment("t2", "r1", DAY);
    expect(await newStore().get()).toEqual({
      version: 1,
      tracks: {
        t1: { releaseId: "r1", count: 2, pushed: 0, days: { [DAY]: 2 } },
        t2: { releaseId: "r1", count: 1, pushed: 0, days: { [DAY]: 1 } },
      },
    });
  });

  it("does not lose concurrent increments", async () => {
    const store = newStore();
    await Promise.all(Array.from({ length: 10 }, () => store.increment("t1", "r1", DAY)));
    expect((await store.get()).tracks.t1.count).toBe(10);
  });

  it("removeRelease drops only that release's tracks", async () => {
    const store = newStore();
    await store.increment("t1", "r1", DAY);
    await store.increment("t2", "r2", DAY);
    await store.removeRelease("r1");
    expect(Object.keys((await store.get()).tracks)).toEqual(["t2"]);
  });

  it("markPushed records what was sent, only moves up, and ignores a dropped track", async () => {
    const store = newStore();
    await store.increment("t1", "r1", DAY);
    await store.increment("t1", "r1", DAY);
    await store.markPushed({ t1: 2, gone: 4 }, store.pushedEpoch());
    expect((await store.get()).tracks.t1.pushed).toBe(2);
    await store.markPushed({ t1: 1 }, store.pushedEpoch());
    expect((await store.get()).tracks.t1.pushed).toBe(2);
    expect(Object.keys((await store.get()).tracks)).toEqual(["t1"]);
  });

  it("a play counted after a push stays pending", async () => {
    const store = newStore();
    await store.increment("t1", "r1", DAY);
    await store.markPushed({ t1: 1 }, store.pushedEpoch());
    await store.increment("t1", "r1", DAY);
    expect((await store.get()).tracks.t1).toEqual({ releaseId: "r1", count: 2, pushed: 1, days: { [DAY]: 2 } });
  });

  it("resetPushed clears every marker and keeps every count", async () => {
    const store = newStore();
    await store.increment("t1", "r1", DAY);
    await store.increment("t2", "r2", DAY);
    await store.increment("t2", "r2", DAY);
    await store.markPushed({ t1: 1, t2: 2 }, store.pushedEpoch());
    await store.resetPushed();
    expect((await store.get()).tracks).toEqual({
      t1: { releaseId: "r1", count: 1, pushed: 0, days: { [DAY]: 1 } },
      t2: { releaseId: "r2", count: 2, pushed: 0, days: { [DAY]: 2 } },
    });
  });

  it("resetPushed between a push and its markPushed leaves pushed at 0 (sign-out race)", async () => {
    const store = newStore();
    await store.increment("t1", "r1", DAY);
    const epoch = store.pushedEpoch(); // the push begins
    await store.resetPushed(); // sign-out while the request is in flight
    await store.markPushed({ t1: 1 }, epoch); // the request comes back accepted
    expect((await store.get()).tracks.t1).toEqual({ releaseId: "r1", count: 1, pushed: 0, days: { [DAY]: 1 } });
    expect(store.pushedEpoch()).not.toBe(epoch);
    // A push that begins after the reset marks normally.
    await store.markPushed({ t1: 1 }, store.pushedEpoch());
    expect((await store.get()).tracks.t1.pushed).toBe(1);
  });

  it("a reset that lands while markPushed is queued still wins", async () => {
    const store = newStore();
    await store.increment("t1", "r1", DAY);
    const epoch = store.pushedEpoch();
    const marked = store.markPushed({ t1: 1 }, epoch);
    const reset = store.resetPushed();
    await Promise.all([marked, reset]);
    expect((await store.get()).tracks.t1.pushed).toBe(0);
  });

  it("reads an invalid or corrupt file as empty", async () => {
    await fs.mkdir(path.dirname(playsFilePath()), { recursive: true });
    await fs.writeFile(playsFilePath(), JSON.stringify({ version: 1, tracks: { t: { count: "x" } } }));
    expect(await newStore().get()).toEqual({ version: 1, tracks: {} });
    await fs.writeFile(playsFilePath(), "{not json");
    expect(await newStore().get()).toEqual({ version: 1, tracks: {} });
  });

  it("writes plays.json with mode 0600", async () => {
    await newStore().increment("t1", "r1", DAY);
    const stat = await fs.stat(playsFilePath());
    expect((stat.mode & 0o777).toString(8)).toBe("600");
  });

  describe("plays by day (#200)", () => {
    async function writeFile(content: unknown): Promise<void> {
      await fs.mkdir(path.dirname(playsFilePath()), { recursive: true });
      await fs.writeFile(playsFilePath(), JSON.stringify(content));
    }

    it("counts each play into its day and keeps a bucket per day", async () => {
      const store = newStore();
      await store.increment("t1", "r1", "2026-10-14");
      await store.increment("t1", "r1", "2026-10-15");
      await store.increment("t1", "r1", "2026-10-15");
      expect((await store.get()).tracks.t1).toEqual({
        releaseId: "r1",
        count: 3,
        pushed: 0,
        days: { "2026-10-14": 1, "2026-10-15": 2 },
      });
    });

    it("loads a file from before days with its totals and no days, then adds days on the next play", async () => {
      await writeFile({ version: 1, tracks: { t1: { releaseId: "r1", count: 7, pushed: 4 } } });
      const store = newStore();
      expect(await store.get()).toEqual({ version: 1, tracks: { t1: { releaseId: "r1", count: 7, pushed: 4 } } });
      await store.increment("t1", "r1", DAY);
      expect((await store.get()).tracks.t1).toEqual({ releaseId: "r1", count: 8, pushed: 4, days: { [DAY]: 1 } });
    });

    it("writes days into plays.json and reads them back through a new store", async () => {
      await newStore().increment("t1", "r1", DAY);
      expect(JSON.parse(await fs.readFile(playsFilePath(), "utf-8"))).toEqual({
        version: 1,
        tracks: { t1: { releaseId: "r1", count: 1, pushed: 0, days: { [DAY]: 1 } } },
      });
      expect((await newStore().get()).tracks.t1.days).toEqual({ [DAY]: 1 });
    });

    it("keeps days through markPushed and resetPushed", async () => {
      const store = newStore();
      await store.increment("t1", "r1", DAY);
      await store.markPushed({ t1: 1 }, store.pushedEpoch());
      expect((await store.get()).tracks.t1).toEqual({ releaseId: "r1", count: 1, pushed: 1, days: { [DAY]: 1 } });
      await store.resetPushed();
      expect((await store.get()).tracks.t1).toEqual({ releaseId: "r1", count: 1, pushed: 0, days: { [DAY]: 1 } });
    });

    it("drops days older than 400 days when the file is written, and keeps the counts", async () => {
      // On 2026-10-15, 400 days back is 2025-09-10: that day stays, the one before it goes.
      await writeFile({
        version: 1,
        tracks: {
          t1: {
            releaseId: "r1",
            count: 9,
            pushed: 0,
            days: { "2025-09-09": 3, "2025-09-10": 2, "2026-10-15": 1 },
          },
          t2: { releaseId: "r1", count: 4, pushed: 0, days: { "2024-01-01": 4 } },
        },
      });
      const store = newStore();
      expect((await store.get()).tracks.t1.days).toEqual({ "2025-09-09": 3, "2025-09-10": 2, "2026-10-15": 1 }); // reading alone drops nothing
      await store.increment("t3", "r2", DAY);
      expect((await store.get()).tracks).toEqual({
        t1: { releaseId: "r1", count: 9, pushed: 0, days: { "2025-09-10": 2, "2026-10-15": 1 } },
        t2: { releaseId: "r1", count: 4, pushed: 0 },
        t3: { releaseId: "r2", count: 1, pushed: 0, days: { [DAY]: 1 } },
      });
    });

    it("takes today in the store's zone when dropping old days", async () => {
      await writeFile({
        version: 1,
        tracks: { t1: { releaseId: "r1", count: 2, pushed: 0, days: { "2025-09-10": 1, "2025-09-11": 1 } } },
      });
      // 2026-10-16 02:30 UTC is still 2026-10-15 in New York, so 2025-09-10 is exactly 400 days back there.
      const store = new FilePlayCountStore(() => Date.UTC(2026, 9, 16, 2, 30), "America/New_York");
      await store.resetPushed();
      expect((await store.get()).tracks.t1.days).toEqual({ "2025-09-10": 1, "2025-09-11": 1 });
      const utc = new FilePlayCountStore(() => Date.UTC(2026, 9, 16, 2, 30), "UTC");
      await utc.resetPushed();
      expect((await utc.get()).tracks.t1.days).toEqual({ "2025-09-11": 1 });
    });

    it("removeRelease drops that release's days with its counts", async () => {
      const store = newStore();
      await store.increment("t1", "r1", DAY);
      await store.increment("t2", "r2", DAY);
      await store.removeRelease("r1");
      expect(await store.get()).toEqual({
        version: 1,
        tracks: { t2: { releaseId: "r2", count: 1, pushed: 0, days: { [DAY]: 1 } } },
      });
      expect(await fs.readFile(playsFilePath(), "utf-8")).not.toContain("t1");
    });

    it("ignores bad day keys and counts without losing the totals", async () => {
      await writeFile({
        version: 1,
        tracks: {
          t1: {
            releaseId: "r1",
            count: 5,
            pushed: 0,
            days: { [DAY]: 2, "not-a-day": 1, "2026-13-40": 1, "2026-10-14": 0, "2026-10-13": 1.5, "2026-10-12": "x" },
          },
          t2: { releaseId: "r1", count: 1, pushed: 0, days: "nope" },
          t3: { releaseId: "r1", count: 1, pushed: 0, days: ["2026-10-15"] },
        },
      });
      expect(await newStore().get()).toEqual({
        version: 1,
        tracks: {
          t1: { releaseId: "r1", count: 5, pushed: 0, days: { [DAY]: 2 } },
          t2: { releaseId: "r1", count: 1, pushed: 0 },
          t3: { releaseId: "r1", count: 1, pushed: 0 },
        },
      });
    });
  });
});
