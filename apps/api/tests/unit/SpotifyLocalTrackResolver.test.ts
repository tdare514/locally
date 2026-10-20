import { describe, expect, it } from "vitest";
import { decodeLocalId, resolveLocalTrack, type ResolvableRelease } from "../../src/server/spotify/LocalTrackResolver";

// Fixtures ported from apps/web/tests/unit/LocalTrackResolver.test.ts so the two resolvers agree.
type TrackIn = Partial<ResolvableRelease["tracks"][number]>;

function track(over: TrackIn = {}): ResolvableRelease["tracks"][number] {
  return {
    id: "t1",
    title: "Title",
    trackNumber: 1,
    file: "a.mp3",
    bytes: 1000,
    durationSec: 200,
    ...over,
  };
}

function release(over: Partial<ResolvableRelease> = {}): ResolvableRelease {
  return { id: "r1", title: "Album", artist: "Artist", tracks: [track()], ...over };
}

const ID = "spotify:local:Artist:Album:Title:200";

describe("decodeLocalId", () => {
  it("decodes plus and percent encoding", () => {
    expect(decodeLocalId("spotify:local:Destroy+Lonely:%3C%2F3+%28Unreleased%29:l8r+dude:128")).toEqual({
      artist: "Destroy Lonely",
      album: "</3 (Unreleased)",
      title: "l8r dude",
      seconds: 128,
    });
  });

  it("allows empty segments", () => {
    expect(decodeLocalId("spotify:local:::Title:200")).toEqual({ artist: "", album: "", title: "Title", seconds: 200 });
  });

  it("returns null for malformed encoding, wrong shape, or a non-local id", () => {
    expect(decodeLocalId("spotify:local:A:B:%E0%A4%A:200")).toBeNull();
    expect(decodeLocalId("spotify:local:A:B:200")).toBeNull();
    expect(decodeLocalId("spotify:local:A:B:C:soon")).toBeNull();
    expect(decodeLocalId("spotify:track:abc")).toBeNull();
  });
});

describe("resolveLocalTrack", () => {
  it("matches album, artist, title and duration", () => {
    expect(resolveLocalTrack(ID, [release()])).toEqual({ kind: "match", releaseId: "r1", trackId: "t1" });
  });

  it("matches after NFC normalisation and trimming", () => {
    const r = release({ title: " Café " });
    expect(resolveLocalTrack("spotify:local:Artist:Caf%C3%A9:Title:200", [r])).toMatchObject({ kind: "match" });
  });

  it("allows 2 s of duration difference but not 3", () => {
    expect(resolveLocalTrack("spotify:local:Artist:Album:Title:202", [release()]).kind).toBe("match");
    expect(resolveLocalTrack("spotify:local:Artist:Album:Title:198", [release()]).kind).toBe("match");
    expect(resolveLocalTrack("spotify:local:Artist:Album:Title:203", [release()]).kind).toBe("none");
  });

  it("ignores duration when the track's is unknown", () => {
    const r = release({ tracks: [track({ durationSec: null })] });
    expect(resolveLocalTrack("spotify:local:Artist:Album:Title:999", [r]).kind).toBe("match");
  });

  it("reports ambiguity and no match", () => {
    const a = release({ id: "r1" });
    const b = release({ id: "r2", tracks: [track({ id: "t2" })] });
    expect(resolveLocalTrack(ID, [a, b]).kind).toBe("ambiguous");
    expect(resolveLocalTrack("spotify:local:Nobody:Album:Title:200", [a]).kind).toBe("none");
    expect(resolveLocalTrack("spotify:local:A:B:%E0%A4%A:200", [a]).kind).toBe("none");
  });

  describe("adopted tracks (localId)", () => {
    const adopted = (localId: string, over: Partial<ResolvableRelease> = {}) =>
      release({ title: "Different Album Name", artist: "Different", tracks: [track({ id: "tA", title: "Edited title", localId })], ...over });

    it("matches on the decoded localId even when the tags differ", () => {
      const r = adopted("spotify:local:Artist+feat.+X:Album:Title:200");
      expect(resolveLocalTrack("spotify:local:Artist+feat.+X:Album:Title:200", [r])).toEqual({ kind: "match", releaseId: "r1", trackId: "tA" });
    });

    it("compares decoded parts, not raw strings, and in NFC", () => {
      const r = adopted("spotify:local:Artist:Caf%C3%A9+(Live):T%C3%ADtle:200");
      expect(resolveLocalTrack("spotify:local:Artist:Cafe%CC%81+%28Live%29:Ti%CC%81tle:201", [r]).kind).toBe("match"); // decomposed é and í equal the stored NFC forms
    });

    it("needs seconds within 2 s", () => {
      const r = adopted("spotify:local:Artist:Album:Title:200");
      expect(resolveLocalTrack("spotify:local:Artist:Album:Title:202", [r]).kind).toBe("match");
      expect(resolveLocalTrack("spotify:local:Artist:Album:Title:203", [r]).kind).toBe("none");
    });

    it("matches an empty album segment and is case-sensitive", () => {
      const r = adopted("spotify:local:Artist::Title:200");
      expect(resolveLocalTrack("spotify:local:Artist::Title:200", [r]).kind).toBe("match");
      expect(resolveLocalTrack("spotify:local:artist::Title:200", [r]).kind).toBe("none");
    });

    it("takes the first of two matching adopted copies", () => {
      const a = adopted("spotify:local:Artist:Album:Title:200", { id: "r1" });
      const b = adopted("spotify:local:Artist:Album:Title:200", { id: "r2" });
      expect(resolveLocalTrack(ID, [a, b])).toMatchObject({ kind: "match", releaseId: "r1" });
    });

    it("skips a malformed localId and falls back to the tags", () => {
      const r = release({ tracks: [track({ localId: "spotify:local:broken" })] });
      expect(resolveLocalTrack(ID, [r])).toMatchObject({ kind: "match", trackId: "t1" });
    });
  });
});
