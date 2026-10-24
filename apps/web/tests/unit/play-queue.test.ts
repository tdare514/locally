import { describe, expect, it } from "vitest";
import type { Release } from "../../src/shared/types";
import {
  PlayCountSession,
  buildReleaseQueue,
  createPlayerStore,
  describeItem,
  mediaMetadataFor,
  openContext,
  previousAction,
  scrubberText,
  type QueueItem,
} from "../../src/lib/play-queue";

function release(id: string, title: string, artist: string, coverPath: string | null, tracks: Release["tracks"]): Release {
  return {
    id,
    kind: "album",
    title,
    artist,
    year: null,
    genre: null,
    coverPath,
    folderPath: `/lib/${id}`,
    tracks,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-02T00:00:00.000Z",
  };
}
const t = (id: string, title: string, trackNumber: number, extra: Partial<Release["tracks"][number]> = {}) => ({
  id,
  title,
  trackNumber,
  filePath: `/lib/${id}.mp3`,
  originalName: `${id}.mp3`,
  durationSec: 200,
  ...extra,
});

const withCover = release("r1", "First Album", "Alpha", "/lib/r1/cover.jpg", [t("a1", "One", 1), t("a2", "Two", 2)]);
const noCover = release("r2", "Second Album", "Beta", null, [t("b1", "Uno", 1)]);
const releases = [withCover, noCover];

describe("the Mac player queue (#338)", () => {
  it("builds a release queue in disc, then track order, at the tapped track", () => {
    const album = release("r3", "Two Discs", "G", null, [
      t("d2t1", "D2 one", 3, { discNumber: 2 }),
      t("d1t2", "D1 two", 2, { discNumber: 1 }),
      t("d1t1", "D1 one", 1, { discNumber: 1 }),
      t("gone", "Gone", 4, { discNumber: 2, missing: true }),
    ]);
    const queue = buildReleaseQueue(album, "d1t2");
    expect(queue?.items.map((i) => i.trackId)).toEqual(["d1t1", "d1t2", "d2t1"]);
    expect(queue?.index).toBe(1);
    expect(queue?.context).toEqual({ kind: "release", id: "r3" });
    expect(buildReleaseQueue(album, "gone")).toBeNull();
  });

  it("shows each item's own title and cover, and counts against its own release (two releases in one queue)", () => {
    const items: QueueItem[] = [
      { releaseId: "r1", trackId: "a2" },
      { releaseId: "r2", trackId: "b1" },
    ];
    const infos = items.map((i) => describeItem(i, releases));
    expect(infos[0]).toMatchObject({ title: "Two", artist: "Alpha", album: "First Album" });
    expect(infos[0]?.coverUrl).toContain("/api/releases/r1/cover");
    expect(infos[1]).toMatchObject({ title: "Uno", artist: "Beta", album: "Second Album", coverUrl: null });
    // The media session follows the same rule.
    expect(mediaMetadataFor(infos[1]!, "http://127.0.0.1:3000")).toMatchObject({ title: "Uno", artist: "Beta", artwork: [] });
    expect(mediaMetadataFor(infos[0]!, "http://127.0.0.1:3000").artwork?.[0].src).toContain("http://127.0.0.1:3000/api/releases/r1/cover");

    // Counting: each item plays 31 s and is reported as its own (releaseId, trackId).
    const counted: QueueItem[] = [];
    const session = new PlayCountSession((item) => counted.push(item));
    let at = 0;
    for (const item of items) {
      for (let pos = 0; pos <= 31; pos++) {
        session.sample(item, { at, playing: true, positionSec: pos, durationSec: 200 });
        at += 1000;
      }
    }
    expect(counted).toEqual(items);
  });

  it("counts once per session, at min(30 s, 90%), and a replay from the start is a new play", () => {
    const counted: QueueItem[] = [];
    const session = new PlayCountSession((i) => counted.push(i));
    const item = { releaseId: "r1", trackId: "a1" };
    let at = 0;
    const play = (from: number, to: number, durationSec: number) => {
      for (let pos = from; pos <= to; pos++) session.sample(item, { at: (at += 1000), playing: true, positionSec: pos, durationSec });
    };
    play(0, 29, 200);
    expect(counted).toHaveLength(0);
    play(30, 60, 200);
    expect(counted).toHaveLength(1);
    play(0, 31, 200);
    expect(counted).toHaveLength(2);
  });

  it("counts a short track at 90% of its length", () => {
    const counted: QueueItem[] = [];
    const session = new PlayCountSession((i) => counted.push(i));
    const item = { releaseId: "r2", trackId: "b1" };
    for (let pos = 0; pos <= 10; pos++) session.sample(item, { at: pos * 1000, playing: true, positionSec: pos, durationSec: 10 });
    expect(counted).toEqual([item]);
  });

  it("does not credit paused time", () => {
    const counted: QueueItem[] = [];
    const session = new PlayCountSession((i) => counted.push(i));
    const item = { releaseId: "r1", trackId: "a1" };
    for (let s = 0; s < 100; s++) session.sample(item, { at: s * 1000, playing: false, positionSec: 5, durationSec: 200 });
    expect(counted).toHaveLength(0);
  });

  it("a collection context has no page yet: opening it does nothing", () => {
    const opened: string[] = [];
    openContext({ kind: "collection", id: "c1" }, (id) => opened.push(id));
    expect(opened).toEqual([]);
    openContext({ kind: "release", id: "r1" }, (id) => opened.push(id));
    expect(opened).toEqual(["r1"]);
  });

  it("the store plays, pauses, skips and stops after the last item", () => {
    const store = createPlayerStore();
    const queue = buildReleaseQueue(withCover, "a1")!;
    store.start(queue);
    expect(store.getState()).toMatchObject({ playing: true, queue: { index: 0 } });
    store.toggle();
    expect(store.getState().playing).toBe(false);
    store.next();
    expect(store.getState()).toMatchObject({ playing: true, queue: { index: 1 } });
    store.next();
    expect(store.getState()).toMatchObject({ playing: false, queue: { index: 1 } });
    store.back();
    expect(store.getState().queue?.index).toBe(0);
    expect(previousAction(store.getState().queue!, 10)).toBe("restart");
    expect(previousAction({ ...queue, index: 1 }, 1)).toBe("back");
  });

  it("words the scrubber as 'm:ss of m:ss'", () => {
    expect(scrubberText(62, 200)).toBe("1:02 of 3:20");
  });

  describe("an item that will not play", () => {
    const failNow = (store: ReturnType<typeof createPlayerStore>, key: string) => store.fail(key, store.getState().attempt);

    it("moves on to the next item and marks the failed one unavailable", () => {
      const store = createPlayerStore();
      store.start(buildReleaseQueue(withCover, "a1")!);
      const first = store.getState().attempt;
      failNow(store, "r1/a1");
      expect(store.getState()).toMatchObject({ playing: true, queue: { index: 1 }, unavailable: ["r1/a1"] });
      // The same load reported twice (the play() rejection and the error event) skips once, and so does a late report.
      store.fail("r1/a1", first);
      expect(store.getState().queue?.index).toBe(1);
    });

    it("stops with the mark showing when the last item fails; a play-button retry that fails again stops again", () => {
      const store = createPlayerStore();
      store.start(buildReleaseQueue(withCover, "a2")!);
      failNow(store, "r1/a2");
      expect(store.getState()).toMatchObject({ playing: false, queue: { index: 1 }, unavailable: ["r1/a2"] });
      store.toggle();
      expect(store.getState()).toMatchObject({ playing: true, unavailable: [] });
      failNow(store, "r1/a2");
      expect(store.getState()).toMatchObject({ playing: false, unavailable: ["r1/a2"] });
    });

    it("a media-key retry of a failed item that fails again ends stopped, with playing false", () => {
      const store = createPlayerStore();
      store.start(buildReleaseQueue(withCover, "a2")!);
      failNow(store, "r1/a2");
      store.setPlaying(true); // the media key's play
      expect(store.getState()).toMatchObject({ playing: true, unavailable: [] });
      failNow(store, "r1/a2");
      expect(store.getState()).toMatchObject({ playing: false, unavailable: ["r1/a2"] });
    });

    it("going back to a failed item that fails again stops there instead of bouncing forward", () => {
      const store = createPlayerStore();
      store.start(buildReleaseQueue(withCover, "a1")!);
      failNow(store, "r1/a1"); // moves on to a2
      store.back();
      expect(store.getState()).toMatchObject({ playing: true, queue: { index: 0 }, unavailable: [] });
      failNow(store, "r1/a1");
      expect(store.getState()).toMatchObject({ playing: false, queue: { index: 0 }, unavailable: ["r1/a1"] });
    });

    it("ignores a failure reported for an item that is no longer current", () => {
      const store = createPlayerStore();
      store.start(buildReleaseQueue(withCover, "a1")!);
      const old = store.getState().attempt;
      store.next();
      store.fail("r1/a1", old);
      expect(store.getState()).toMatchObject({ playing: true, queue: { index: 1 }, unavailable: [] });
    });
  });
});
