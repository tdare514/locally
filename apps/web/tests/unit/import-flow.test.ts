import { describe, expect, it } from "vitest";
import {
  BEAT,
  INITIAL_BEAT,
  REDUCED_BEAT,
  SEND,
  beatPhase,
  beatReducer,
  beatTimes,
  discKeyFor,
  isAudioFile,
  isPlaying,
  mayBeAudioDrag,
  planAdd,
  sealRemaining,
  trimForKind,
  type BeatEvent,
  type BeatState,
} from "../../src/lib/import-flow";

const run = (events: BeatEvent[], from: BeatState = INITIAL_BEAT): BeatState =>
  events.reduce(beatReducer, from);

describe("beatPhase", () => {
  it("follows the approved clock", () => {
    expect(beatPhase(0)).toBe("slide");
    expect(beatPhase(419)).toBe("slide");
    expect(beatPhase(420)).toBe("swell");
    expect(beatPhase(719)).toBe("swell");
    expect(beatPhase(720)).toBe("white");
    expect(beatPhase(819)).toBe("white");
    expect(beatPhase(820)).toBe("fade");
    expect(beatPhase(1299)).toBe("fade");
    expect(beatPhase(1300)).toBe("gap");
    expect(beatPhase(1339)).toBe("gap");
    expect(beatPhase(1340)).toBe("seal");
    expect(beatPhase(2289)).toBe("seal");
    expect(beatPhase(2290)).toBe("done");
  });

  it("starts the colour wash with the flash and turns the label for 950ms after the disc starts", () => {
    expect(BEAT.washAt).toBe(BEAT.flashAt);
    expect(BEAT.discEnd - BEAT.discAt).toBe(950);
    expect(BEAT.discAt).toBeGreaterThanOrEqual(BEAT.flashEnd);
  });
});

describe("beatTimes", () => {
  it("runs the whole beat for normal motion", () => {
    expect(beatTimes(false)).toEqual({ washAt: BEAT.washAt, endAt: BEAT.discEnd });
  });

  it("is a short fade with the colours at once under reduced motion", () => {
    expect(beatTimes(true)).toEqual(REDUCED_BEAT);
    expect(beatTimes(true).washAt).toBe(0);
    expect(beatTimes(true).endAt).toBeLessThan(BEAT.slideEnd);
  });
});

describe("send", () => {
  it("seals in the time the label turns in, and slides back out faster", () => {
    expect(SEND.sealMs).toBe(BEAT.discEnd - BEAT.discAt);
    expect(SEND.sealMs).toBe(950);
    expect(SEND.unsealMs).toBe(400);
  });

  it("makes the Added moment wait for the rest of the seal, once the request is done", () => {
    // The request finished instantly: wait out the whole seal.
    expect(sealRemaining(0, false)).toBe(SEND.sealMs);
    // A slower request: only what is left of the seal.
    expect(sealRemaining(300, false)).toBe(SEND.sealMs - 300);
    expect(sealRemaining(SEND.sealMs - 1, false)).toBe(1);
  });

  it("fires at once when the request outlasts the seal", () => {
    expect(sealRemaining(SEND.sealMs, false)).toBe(0);
    expect(sealRemaining(SEND.sealMs + 4000, false)).toBe(0);
  });

  it("never waits under reduced motion, whenever the request finishes", () => {
    expect(sealRemaining(0, true)).toBe(0);
    expect(sealRemaining(300, true)).toBe(0);
    expect(sealRemaining(SEND.sealMs + 1, true)).toBe(0);
  });
});

describe("beatReducer", () => {
  it("does nothing until a cover is set", () => {
    expect(isPlaying(INITIAL_BEAT)).toBe(false);
    expect(run([{ type: "skip" }])).toBe(INITIAL_BEAT);
    expect(run([{ type: "end" }])).toBe(INITIAL_BEAT);
  });

  it("starts the beat when a cover is set", () => {
    const state = run([{ type: "cover" }]);
    expect(isPlaying(state)).toBe(true);
    expect(state).toMatchObject({ hasCover: true, run: 1, ended: false, skipped: false, replay: false });
  });

  it("jumps to the end on input, once", () => {
    const state = run([{ type: "cover" }, { type: "skip" }]);
    expect(isPlaying(state)).toBe(false);
    expect(state).toMatchObject({ hasCover: true, ended: true, skipped: true });
    // Later input finds nothing to skip: same state back, so no re-render.
    expect(beatReducer(state, { type: "skip" })).toBe(state);
  });

  it("ends by itself without counting as a skip", () => {
    const state = run([{ type: "cover" }, { type: "end" }]);
    expect(isPlaying(state)).toBe(false);
    expect(state.skipped).toBe(false);
    expect(beatReducer(state, { type: "skip" })).toBe(state);
  });

  it("replays the beat when the cover is replaced", () => {
    const first = run([{ type: "cover" }, { type: "skip" }]);
    const second = beatReducer(first, { type: "cover" });
    expect(isPlaying(second)).toBe(true);
    expect(second).toMatchObject({ run: 2, ended: false, skipped: false, replay: true });
  });

  it("resets to no cover, keeping the run count so keys never repeat", () => {
    const state = run([{ type: "cover" }, { type: "cover" }, { type: "reset" }]);
    expect(state).toEqual({ ...INITIAL_BEAT, run: 2 });
    expect(beatReducer(state, { type: "cover" })).toMatchObject({ run: 3, replay: false });
  });
});

describe("discKeyFor", () => {
  it("changes for a new cover and for a skip, not for the beat running out", () => {
    const a = run([{ type: "cover" }]);
    const ended = beatReducer(a, { type: "end" });
    const skipped = beatReducer(a, { type: "skip" });
    const replaced = beatReducer(ended, { type: "cover" });
    expect(discKeyFor(ended)).toBe(discKeyFor(a));
    expect(discKeyFor(skipped)).not.toBe(discKeyFor(a));
    expect(discKeyFor(replaced)).not.toBe(discKeyFor(a));
  });
});

describe("trimForKind", () => {
  it("keeps only the first track when switching to Single", () => {
    expect(trimForKind(["a", "b", "c"], "single")).toEqual(["a"]);
  });

  it("leaves an Album, and a Single that is already one track, alone", () => {
    const three = ["a", "b", "c"];
    const one = ["a"];
    expect(trimForKind(three, "album")).toBe(three);
    expect(trimForKind(one, "single")).toBe(one);
    expect(trimForKind([], "single")).toEqual([]);
  });
});

describe("planAdd", () => {
  it("replaces with the first file for a Single", () => {
    expect(planAdd("single", 1, ["x", "y"])).toEqual({ files: ["x"], startIndex: 0, replace: true });
  });

  it("appends every file after the existing tracks for an Album", () => {
    expect(planAdd("album", 2, ["x", "y"])).toEqual({ files: ["x", "y"], startIndex: 2, replace: false });
  });
});

describe("isAudioFile", () => {
  it("accepts audio by type or by extension", () => {
    expect(isAudioFile({ name: "song", type: "audio/mpeg" })).toBe(true);
    expect(isAudioFile({ name: "Song.FLAC", type: "" })).toBe(true);
    expect(isAudioFile({ name: "a.m4a", type: "application/octet-stream" })).toBe(true);
    expect(isAudioFile({ name: "a.aif", type: "" })).toBe(true);
  });

  it("refuses an image dropped on the sleeve", () => {
    expect(isAudioFile({ name: "cover.png", type: "image/png" })).toBe(false);
    expect(isAudioFile({ name: "cover.jpg", type: "" })).toBe(false);
    expect(isAudioFile({ name: "mp3", type: "" })).toBe(false);
  });
});

describe("mayBeAudioDrag", () => {
  it("lights up for audio, and for a file whose type is blank or generic", () => {
    expect(mayBeAudioDrag([{ kind: "file", type: "audio/mpeg" }])).toBe(true);
    expect(mayBeAudioDrag([{ kind: "file", type: "" }])).toBe(true);
    expect(mayBeAudioDrag([{ kind: "file", type: "application/octet-stream" }])).toBe(true);
    expect(mayBeAudioDrag([{ kind: "file", type: "image/png" }, { kind: "file", type: "audio/flac" }])).toBe(true);
  });

  it("stays dark for images, other files and text", () => {
    expect(mayBeAudioDrag([{ kind: "file", type: "image/jpeg" }])).toBe(false);
    expect(mayBeAudioDrag([{ kind: "file", type: "application/pdf" }])).toBe(false);
    expect(mayBeAudioDrag([{ kind: "string", type: "audio/mpeg" }])).toBe(false);
    expect(mayBeAudioDrag([])).toBe(false);
  });
});
