import { describe, expect, it, vi } from "vitest";
import type { Release } from "../../src/shared/types";
import { createPlayerStore } from "../../src/lib/play-queue";
import {
  queueTarget,
  queueToastText,
  targetActions,
  targetItems,
  targetSubject,
  trackMenuGroups,
} from "../../src/lib/track-menu";

const t = (id: string, title: string, trackNumber: number, extra: Partial<Release["tracks"][number]> = {}) => ({
  id,
  title,
  trackNumber,
  filePath: `/lib/${id}.mp3`,
  originalName: `${id}.mp3`,
  durationSec: 200,
  ...extra,
});
function release(id: string, artist: string, tracks: Release["tracks"], extra: Partial<Release> = {}): Release {
  return {
    id,
    kind: "album",
    title: `Album ${id}`,
    artist,
    year: null,
    genre: null,
    coverPath: null,
    folderPath: `/lib/${id}`,
    tracks,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-02T00:00:00.000Z",
    ...extra,
  };
}

const album = release("r1", "Mira Valdane", [
  t("c", "Night Bus to Nowhere", 3),
  t("a", "Afterglow", 1),
  t("b", "Bluebird", 2),
  t("gone", "Gone", 4, { missing: true }),
]);
const labels = (groups: ReturnType<typeof trackMenuGroups>) => groups.map((g) => g.map((i) => i.label));
const run = () => undefined;

describe("the track menu's items (#419)", () => {
  it("lists the iPhone's actions in its order and wording, with the disc actions as a last group", () => {
    const groups = trackMenuGroups({
      playNext: run,
      addToQueue: run,
      addToCollection: run,
      share: run,
      edit: run,
      goToAlbum: run,
      goToArtist: run,
      disc: [{ label: "Start disc 2 here", run }],
    });
    expect(labels(groups)).toEqual([
      ["Play next", "Add to queue", "Add to collection", "Share"],
      ["Edit", "Go to album", "Go to artist"],
      ["Start disc 2 here"],
    ]);
  });

  it("leaves out an action the row can't do, and a group that is then empty (no stray divider)", () => {
    expect(labels(trackMenuGroups({ playNext: run, addToQueue: run, goToArtist: run }))).toEqual([
      ["Play next", "Add to queue"],
      ["Go to artist"],
    ]);
    expect(labels(trackMenuGroups({ goToArtist: run, disc: [{ label: "Join disc 1", run }] }))).toEqual([["Go to artist"], ["Join disc 1"]]);
    expect(labels(trackMenuGroups({ disc: [{ label: "Start disc 2 here", run }, { label: "Join disc 1", run }] }))).toEqual([
      ["Start disc 2 here", "Join disc 1"],
    ]);
    expect(trackMenuGroups({})).toEqual([]);
  });
});

describe("what the menu acts on (#419)", () => {
  it("a track is that one track; a release is its tracks in play order, files that are gone left out", () => {
    expect(targetItems({ release: album, trackId: "b" })).toEqual([{ releaseId: "r1", trackId: "b" }]);
    expect(targetItems({ release: album }).map((i) => i.trackId)).toEqual(["a", "b", "c"]);
    expect(targetItems({ release: album, trackId: "gone" })).toEqual([]);
    expect(targetItems({ release: album, trackId: "nope" })).toEqual([]);
  });

  it("names the subject for the toast: the song's title, or how many songs", () => {
    expect(targetSubject({ release: album, trackId: "c" })).toBe("Night Bus to Nowhere");
    expect(targetSubject({ release: album })).toBe("3 songs");
    expect(targetSubject({ release: release("s", "X", [t("one", "Only one", 1)]) })).toBe("Only one");
    expect(targetSubject({ release: release("s", "X", [t("one", "  ", 1)]) })).toBe("Untitled");
  });

  it("words the toast with the iPhone's lines and the subject", () => {
    expect(queueToastText({ added: 1, started: false }, true, "Night Bus to Nowhere")).toBe("Playing next: Night Bus to Nowhere");
    expect(queueToastText({ added: 3, started: false }, false, "3 songs")).toBe("Added to queue: 3 songs");
    expect(queueToastText({ added: 3, started: true }, true, "3 songs")).toBe("Playing now: 3 songs");
    expect(queueToastText({ added: 3, started: true }, false, "3 songs")).toBe("Playing now: 3 songs");
    expect(queueToastText({ added: 0, started: false }, true, "x")).toBeNull();
  });
});

describe("queueing the target (#419)", () => {
  it("starts a queue and says 'Playing now', then adds next and at the end with their own lines", () => {
    const store = createPlayerStore();
    const toast = vi.fn();
    queueTarget(store, { release: album }, true, toast);
    expect(toast).toHaveBeenLastCalledWith("success", "Playing now: 3 songs");
    expect(store.getState().queue?.items.map((i) => i.trackId)).toEqual(["a", "b", "c"]);
    queueTarget(store, { release: album, trackId: "c" }, true, toast);
    expect(toast).toHaveBeenLastCalledWith("success", "Playing next: Night Bus to Nowhere");
    expect(store.getState().queue?.items.map((i) => i.trackId)).toEqual(["a", "c", "b", "c"]);
    queueTarget(store, { release: album, trackId: "b" }, false, toast);
    expect(toast).toHaveBeenLastCalledWith("success", "Added to queue: Bluebird");
    expect(store.getState().queue?.items.map((i) => i.trackId)).toEqual(["a", "c", "b", "c", "b"]);
  });

  it("says nothing and queues nothing for a target with no playable file", () => {
    const store = createPlayerStore();
    const toast = vi.fn();
    queueTarget(store, { release: album, trackId: "gone" }, false, toast);
    expect(toast).not.toHaveBeenCalled();
    expect(store.getState().queue).toBeNull();
  });
});

describe("the actions every surface shares (#419)", () => {
  const store = createPlayerStore();
  const open = vi.fn();
  const artist = vi.fn();
  const env = { toast: vi.fn(), openRelease: open, openArtist: artist };

  it("offers every action a surface that can open pages has", () => {
    const a = targetActions({ release: album }, env, store, false);
    expect(Object.keys(a).filter((k) => a[k as keyof typeof a])).toEqual(["playNext", "addToQueue", "edit", "goToAlbum", "goToArtist"]);
    a.edit?.();
    a.goToAlbum?.();
    expect(open.mock.calls).toEqual([["r1"], ["r1"]]);
    a.goToArtist?.();
    expect(artist).toHaveBeenCalledWith("Mira Valdane");
  });

  it("leaves out Go to album and Edit where the surface can't open a release page (the release's own page)", () => {
    const a = targetActions({ release: album, trackId: "a" }, { toast: env.toast, openArtist: artist }, store, false);
    expect(a.goToAlbum).toBeUndefined();
    expect(a.edit).toBeUndefined();
    expect(a.playNext).toBeDefined();
  });

  it("leaves out the queue in the demo, for a track whose file is gone, and Edit for an adopted release or in the demo", () => {
    expect(targetActions({ release: album }, env, store, true)).toMatchObject({ playNext: undefined, addToQueue: undefined, edit: undefined });
    expect(targetActions({ release: album, trackId: "gone" }, env, store, false)).toMatchObject({ playNext: undefined, addToQueue: undefined });
    expect(targetActions({ release: { ...album, adopted: true } }, env, store, false).edit).toBeUndefined();
    expect(targetActions({ release: { ...album, adopted: true } }, env, store, false).goToAlbum).toBeDefined();
  });

  it("leaves out Go to artist when the release has no artist to open", () => {
    expect(targetActions({ release: { ...album, artist: "" } }, env, store, false).goToArtist).toBeUndefined();
    expect(targetActions({ release: { ...album, artist: "!!!" } }, env, store, false).goToArtist).toBeUndefined();
  });

  it("hands the credit as the release shows it to the opener, which opens its main artist (creditKey)", () => {
    const a = targetActions({ release: { ...album, artist: "Mira Valdane feat. Kai" } }, env, store, false);
    expect(a.goToArtist).toBeDefined();
    a.goToArtist?.();
    expect(artist).toHaveBeenLastCalledWith("Mira Valdane feat. Kai");
  });
});
