import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addItems,
  buildCollectionQueue,
  buildCollectionQueueAt,
  isCurrentRow,
  rowQueuePositions,
  collectionCoverIds,
  collectionRows,
  collectionTotals,
  moveAnnouncement,
  moveRow,
  removeAt,
  splitSides,
} from "../../src/lib/collections";
import { cleanCollectionName, validateItems, type CollectionItem } from "../../src/shared/collections";
import type { Release, Track } from "../../src/shared/types";

const FIXTURES = path.resolve(__dirname, "../../../../spec/fixtures/collections");
const fixture = async (name: string) => JSON.parse(await fs.readFile(path.join(FIXTURES, name), "utf-8"));

const R1 = "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90";
const R2 = "7a0d4c52-1e3b-4f68-8a9d-2c5b7e1f4a63";
const T2 = "c41e8b27-6d95-4a30-b1f2-9e7a3c5d8f04";

function track(id: string, trackNumber: number, discNumber?: number, extra: Partial<Track> = {}): Track {
  return { id, title: id, trackNumber, ...(discNumber ? { discNumber } : {}), filePath: "/x.mp3", originalName: "x", durationSec: 60, ...extra };
}
function release(id: string, tracks: Track[], coverPath: string | null = "/c.jpg"): Release {
  return { id, kind: "album", title: id, artist: "A", year: null, genre: null, coverPath, folderPath: "/f", tracks, createdAt: "", updatedAt: "" } as unknown as Release;
}

// Release 1 is on two discs, listed out of order: disc 1 tracks 1, 3; disc 2 track 2.
const rel1 = release(R1, [track("b", 2, 2), track("a", 1, 1), track("c", 3, 1), track("gone", 4, 2, { missing: true })]);
const rel2 = release(R2, [track(T2, 1)], null);

describe("the shared fixtures", () => {
  it("valid.json resolves and queues; missing-track hides; unknown kind is skipped", async () => {
    const valid = await fixture("valid.json");
    const rows = collectionRows(valid.items, [rel1, rel2]);
    expect(rows.map((r) => r.item.kind)).toEqual(["release", "track"]);
    expect(validateItems(valid.items).ok).toBe(true);

    const missing = await fixture("missing-track.json");
    expect(collectionRows(missing.items, [rel1, rel2]).length).toBeLessThan(missing.items.length);

    const unknown = await fixture("unknown-kind.json");
    const queue = buildCollectionQueue(unknown, [rel1, rel2]);
    // Only the known release item plays.
    expect(queue!.items.every((i) => i.releaseId === R1)).toBe(true);
    expect(validateItems(unknown.items).ok).toBe(true);
  });

  it("invalid-known-item.json is refused by the Mac's own check", async () => {
    const bad = await fixture("invalid-known-item.json");
    expect(validateItems(bad.items).ok).toBe(false);
  });
});

describe("buildCollectionQueue", () => {
  const items: CollectionItem[] = [
    { kind: "release", releaseId: R1 },
    { kind: "track", releaseId: R2, trackId: T2 },
  ];
  it("expands a release item disc then track, skips a missing file, and keeps the track item", () => {
    const q = buildCollectionQueue({ id: "col", items }, [rel1, rel2])!;
    expect(q.items.map((i) => i.trackId)).toEqual(["a", "c", "b", T2]);
    expect(q.index).toBe(0);
    expect(q.context).toEqual({ kind: "collection", id: "col" });
  });
  it("starts at a given track, and refuses a start that is not in the queue", () => {
    expect(buildCollectionQueue({ id: "col", items }, [rel1, rel2], { releaseId: R1, trackId: "b" })!.index).toBe(2);
    expect(buildCollectionQueue({ id: "col", items }, [rel1, rel2], { releaseId: R1, trackId: "gone" })).toBeNull();
  });
  it("skips unresolvable items and is null when nothing can play", () => {
    const q = buildCollectionQueue({ id: "col", items: [{ kind: "release", releaseId: "9a0d4c52-1e3b-4f68-8a9d-2c5b7e1f4a63" }, ...items] }, [rel1, rel2])!;
    expect(q.items).toHaveLength(4);
    expect(buildCollectionQueue({ id: "col", items }, [])).toBeNull();
    expect(buildCollectionQueue({ id: "col", items: [] }, [rel1])).toBeNull();
  });
});

describe("sides, covers and totals", () => {
  it("splits in half with the extra track on Side A", () => {
    expect(splitSides([1, 2, 3, 4, 5])).toEqual({ a: [1, 2, 3], b: [4, 5] });
    expect(splitSides([1])).toEqual({ a: [1], b: [] });
  });
  it("the sleeve takes the first four different covers", () => {
    const rels = ["1", "2", "3", "4", "5"].map((n) => release(`0000000${n}-0000-4000-8000-000000000000`, [track("t", 1)]));
    const items = [...rels, rels[0]].map((r) => ({ kind: "release", releaseId: r.id }));
    expect(collectionCoverIds(items, rels)).toEqual(rels.slice(0, 4).map((r) => r.id));
    expect(collectionCoverIds([{ kind: "release", releaseId: R2 }], [rel2])).toEqual([]);
  });
  it("totals count what resolves", () => {
    expect(collectionTotals([{ kind: "release", releaseId: R1 }], [rel1])).toEqual({ tracks: 4, seconds: 240 });
  });
});

describe("editing", () => {
  const a: CollectionItem = { kind: "release", releaseId: R1 };
  const x: CollectionItem = { kind: "tape-side", releaseId: R1, side: "B" };
  const b: CollectionItem = { kind: "track", releaseId: R2, trackId: T2 };
  it("addItems skips what is already there", () => {
    const out = addItems([a], [{ kind: "release", releaseId: R1 }, { kind: "track", releaseId: R1, trackId: "t" }]);
    expect(out.added).toBe(1);
    expect(out.items).toHaveLength(2);
  });
  it("moveRow moves among the visible rows and leaves an unknown item in the list", () => {
    const items = [a, x, b];
    const rows = collectionRows(items, [rel1, rel2]);
    expect(moveRow(items, rows, 0, 1)).toEqual([x, b, a]);
    expect(moveRow(items, rows, 0, 0)).toEqual(items);
    expect(moveRow(items, rows, 0, 9)).toEqual(items);
  });
  it("removeAt drops one item by its full index; the announcement reads as the plan says", () => {
    expect(removeAt([a, x, b], 1)).toEqual([a, b]);
    expect(moveAnnouncement(3, 12)).toBe("Moved to 3 of 12");
  });
});

describe("names", () => {
  it("trims, and refuses empty, long or control characters", () => {
    expect(cleanCollectionName("  Late drives ")).toBe("Late drives");
    expect(cleanCollectionName("   ")).toBeNull();
    expect(cleanCollectionName("x".repeat(101))).toBeNull();
    expect(cleanCollectionName("a\u0007b")).toBeNull();
  });
});

describe("now-playing row", () => {
  // The same release listed as a release item and again as one of its tracks: track "a" appears twice.
  const items: CollectionItem[] = [
    { kind: "release", releaseId: R1 },
    { kind: "track", releaseId: R1, trackId: "a" },
  ];
  const col = { id: "col", items };

  it("positions follow the built queue and skip missing tracks", () => {
    const rows = collectionRows(items, [rel1]);
    expect(rowQueuePositions(rows)).toEqual([[0, 1, 2, null], [3]]);
  });

  it("starts at the clicked row's position, not the first occurrence of the track", () => {
    const q = buildCollectionQueueAt(col, [rel1], 3)!;
    expect(q.items[q.index]).toEqual({ releaseId: R1, trackId: "a" });
    expect(q.index).toBe(3);
    expect(q.context).toEqual({ kind: "collection", id: "col" });
    expect(buildCollectionQueueAt(col, [rel1], 4)).toBeNull();
  });

  it("a row is current only in this collection's queue at its own position", () => {
    const q = buildCollectionQueueAt(col, [rel1], 3)!;
    expect(isCurrentRow(q, "col", 3)).toBe(true);
    expect(isCurrentRow(q, "col", 0)).toBe(false); // same track, other row
    expect(isCurrentRow(q, "other", 3)).toBe(false);
    expect(isCurrentRow({ ...q, context: { kind: "release", id: "col" } }, "col", 3)).toBe(false);
    expect(isCurrentRow(null, "col", 3)).toBe(false);
    expect(isCurrentRow(q, "col", null)).toBe(false);
  });
});
