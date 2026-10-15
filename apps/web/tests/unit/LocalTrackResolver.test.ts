import { describe, expect, it } from "vitest";
import { decodeLocalId, resolveLocalTrack } from "../../src/server/plays/LocalTrackResolver";
import type { Release, Track } from "../../src/shared/types";

function track(over: Partial<Track> & { artist?: string } = {}): Track {
  return {
    id: "t1",
    title: "Title",
    trackNumber: 1,
    filePath: "/lib/a.mp3",
    originalName: "a.mp3",
    durationSec: 200,
    ...over,
  };
}

function release(over: Partial<Release> = {}): Release {
  return {
    id: "r1",
    kind: "album",
    title: "Album",
    artist: "Artist",
    year: null,
    genre: null,
    coverPath: null,
    folderPath: "/lib/Artist/Album",
    tracks: [track()],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
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
    const r = release({ title: " Café ", tracks: [track()] });
    expect(resolveLocalTrack("spotify:local:Artist:Caf%C3%A9:Title:200", [r])).toMatchObject({ kind: "match" });
  });

  it("uses the track artist override when set", () => {
    const r = release({ tracks: [track({ artist: "Guest" } as Partial<Track>)] });
    expect(resolveLocalTrack(ID, [r]).kind).toBe("none");
    expect(resolveLocalTrack("spotify:local:Guest:Album:Title:200", [r])).toMatchObject({ kind: "match" });
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
});
