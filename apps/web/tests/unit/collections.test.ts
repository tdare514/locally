import fs from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Queue } from "../../src/components/CollectionsView";
import { CollectionsCard } from "../../src/components/LibraryCollections";
import { createPlayerStore } from "../../src/lib/play-queue";
import {
  addItems,
  buildCollectionQueue,
  buildCollectionQueueAt,
  isCurrentRow,
  isFailedRow,
  rowQueuePositions,
  collectionCountLabel,
  collectionCoverIds,
  collectionPlaylistGuide,
  COLLECTIONS_COPY,
  collectionRows,
  collectionTotals,
  moveAnnouncement,
  moveRow,
  removeAt,
  pressCollectionCover,
} from "../../src/lib/collections";
import { cleanCollectionName, validateItems, type CollectionItem, type CollectionRecord } from "../../src/shared/collections";
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

describe("covers and totals", () => {
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
    const a = { releaseId: R1, trackId: "a" };
    expect(isCurrentRow(q, "col", 3, a)).toBe(true);
    expect(isCurrentRow(q, "col", 0, a)).toBe(false); // same track, other row
    expect(isCurrentRow(q, "other", 3, a)).toBe(false);
    expect(isCurrentRow({ ...q, context: { kind: "release", id: "col" } }, "col", 3, a)).toBe(false);
    expect(isCurrentRow(null, "col", 3, a)).toBe(false);
    expect(isCurrentRow(q, "col", null, a)).toBe(false);
  });

  it("isFailedRow: only the row of this collection's queue whose track the player marked unavailable", () => {
    const q = buildCollectionQueueAt(col, [rel1], 3)!;
    const a = { releaseId: R1, trackId: "a" };
    const key = `${R1}/a`;
    expect(isFailedRow(q, [key], "col", 3, a)).toBe(true);
    expect(isFailedRow(q, [], "col", 3, a)).toBe(false);
    expect(isFailedRow(q, [key], "col", 1, a)).toBe(false); // that position holds another track
    expect(isFailedRow(q, [key], "other", 3, a)).toBe(false);
    expect(isFailedRow({ ...q, context: { kind: "release", id: "col" } }, [key], "col", 3, a)).toBe(false);
    expect(isFailedRow(null, [key], "col", 3, a)).toBe(false);
    expect(isFailedRow(q, [key], "col", null, a)).toBe(false);
  });

  it("a reorder while it plays doesn't light up the row that moved into the playing position", () => {
    // B plays at position 1 of [A, B]; after a reorder to [B, A], A sits at position 1 but isn't what plays.
    const queue = {
      items: [{ releaseId: R1, trackId: "a" }, { releaseId: R1, trackId: "b" }],
      index: 1,
      context: { kind: "collection", id: "col" },
    };
    expect(isCurrentRow(queue, "col", 1, { releaseId: R1, trackId: "a" })).toBe(false);
    expect(isCurrentRow(queue, "col", 1, { releaseId: R1, trackId: "b" })).toBe(true);
  });
});

describe("collectionPlaylistGuide (#353)", () => {
  const items: CollectionItem[] = [
    { kind: "track", releaseId: R2, trackId: T2 },
    { kind: "release", releaseId: R1 },
    { kind: "track", releaseId: R1, trackId: "gone" },
    { kind: "track", releaseId: R2, trackId: T2 },
  ];
  it("lists playable tracks in the collection's order (a release expands disc then track, repeats stay) and counts the rest", () => {
    const g = collectionPlaylistGuide(items, [rel1, rel2]);
    expect(g.tracks.map((t) => t.title)).toEqual([T2, "a", "c", "b", T2]);
    expect(g.leftOut).toBe(2);
  });
  it("is empty and counts nothing when no item resolves", () => {
    expect(collectionPlaylistGuide(items, [])).toEqual({ tracks: [], leftOut: 0 });
  });
  it("gives no tracks (the unavailable state) when every track is missing on disk", () => {
    const allGone = release(R1, [track("x", 1, 1, { missing: true }), track("y", 2, 1, { missing: true })]);
    const g = collectionPlaylistGuide([{ kind: "release", releaseId: R1 }], [allGone]);
    expect(g.tracks).toEqual([]);
    expect(g.leftOut).toBe(2);
  });
  it("gives no tracks when the items live only on another device (no release here)", () => {
    const g = collectionPlaylistGuide([{ kind: "release", releaseId: R2 }, { kind: "track", releaseId: R1, trackId: "a" }], []);
    expect(g.tracks).toEqual([]);
  });
  it("words the unavailable line", () => {
    expect(COLLECTIONS_COPY.nothingToAdd).toBe("None of these tracks are on this Mac, so there's nothing to add here.");
  });
  it("words the left-out line", () => {
    expect(COLLECTIONS_COPY.leftOutOfGuide(2, "Mac")).toBe("2 tracks aren't on this Mac.");
    expect(COLLECTIONS_COPY.leftOutOfGuide(1, "Mac")).toBe("1 track isn't on this Mac.");
  });
});

describe("the cover is the play control (#369)", () => {
  const col = { id: "col", items: [{ kind: "release", releaseId: R1 }] as CollectionItem[] };
  it("starts from the top, then pauses, then resumes", () => {
    const store = createPlayerStore();
    expect(pressCollectionCover(store, col, [rel1, rel2], false)).toBe("started");
    expect(store.getState().playing).toBe(true);
    expect(store.getState().queue?.context).toEqual({ kind: "collection", id: "col" });
    expect(pressCollectionCover(store, col, [rel1, rel2], false)).toBe("paused");
    expect(store.getState().playing).toBe(false);
    expect(pressCollectionCover(store, col, [rel1, rel2], false)).toBe("resumed");
    expect(store.getState().playing).toBe(true);
  });
  it("starts this collection when something else is playing", () => {
    const store = createPlayerStore();
    store.start(buildCollectionQueue({ id: "other", items: col.items }, [rel1])!);
    expect(pressCollectionCover(store, col, [rel1], false)).toBe("started");
    expect(store.getState().queue?.context).toEqual({ kind: "collection", id: "col" });
  });
  it("does nothing in edit mode, or when nothing can play", () => {
    const store = createPlayerStore();
    expect(pressCollectionCover(store, col, [rel1], true)).toBeNull();
    expect(store.getState().queue).toBeNull();
    expect(pressCollectionCover(store, col, [], false)).toBeNull();
    expect(store.getState().queue).toBeNull();
  });
});

describe("the queue is one list (#369)", () => {
  it("renders every track in order with no Side headings", () => {
    const items: CollectionItem[] = [{ kind: "release", releaseId: R1 }, { kind: "track", releaseId: R2, trackId: T2 }];
    const col = { id: "col", name: "Mix", items, createdAt: "", updatedAt: "" } as unknown as CollectionRecord;
    const rows = collectionRows(items, [rel1, rel2]);
    const html = renderToStaticMarkup(createElement(Queue, { collection: col, rows, releases: [rel1, rel2], playing: false }));
    expect(html).not.toMatch(/Side [AB]/);
    expect(html).not.toContain("<h3");
    expect(html.match(/<ol/g)).toHaveLength(1);
    expect(html.match(/<li/g)).toHaveLength(5); // four playable rows and the missing file, dimmed
    expect(html.indexOf(">c<")).toBeLessThan(html.indexOf(`>${T2}<`));
  });
});

describe("the Library's Collections card (#420)", () => {
  const noop = () => {};
  const rels = ["1", "2", "3", "4"].map((n) => release(`0000000${n}-0000-4000-8000-000000000000`, [track("t", 1)]));
  const made = (n: number): CollectionRecord[] =>
    rels.slice(0, n).map((r, i) => ({ id: `c${i}`, name: `Mix ${i}`, items: [{ kind: "release", releaseId: r.id }], createdAt: "", updatedAt: "" }) as unknown as CollectionRecord);
  const card = (props: Partial<Parameters<typeof CollectionsCard>[0]> = {}) =>
    renderToStaticMarkup(createElement(CollectionsCard, { collections: made(3), loaded: true, failed: false, releases: rels, color: "#123456", onOpen: noop, ...props }));

  it("counts collections", () => {
    expect(collectionCountLabel(1)).toBe("1 collection");
    expect(collectionCountLabel(3)).toBe("3 collections");
  });
  it("is one button with the count in its label and subtitle", () => {
    const html = card();
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Collections, 3 collections"');
    expect(html).toContain(">3 collections<");
    expect(card({ collections: made(1) })).toContain('aria-label="Collections, 1 collection"');
  });
  it("stacks the first three sleeves only, washed and labelled in the cover colour", () => {
    const html = card({ collections: made(4) });
    expect(html.match(/<img/g)).toHaveLength(3);
    expect(html).toContain("linear-gradient(to right, #123456, transparent 70%)");
    expect(html).toContain('fill="#123456"');
  });
  it("with none, says the plan's line over one empty sleeve and the disc", () => {
    const html = card({ collections: [], color: "#262626" });
    expect(html).toContain('aria-label="Collections"');
    expect(html).toContain(COLLECTIONS_COPY.none);
    expect(html).not.toContain("<img");
    expect(html).toContain("<svg");
  });
  it("holds its place while loading, as a hidden placeholder", () => {
    const html = card({ loaded: false });
    expect(html).not.toContain("<button");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("min-h-20");
  });
  it("says it could not load when there are none, but still shows what it has", () => {
    const failed = card({ collections: [], failed: true });
    expect(failed.replace("&#x27;", "'")).toContain(COLLECTIONS_COPY.failedToLoad);
    expect(failed).not.toContain("<button");
    expect(card({ failed: true })).toContain('aria-label="Collections, 3 collections"');
  });
});
