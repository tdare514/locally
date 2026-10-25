import { describe, expect, it } from "vitest";
import { aggregatePlays, lastPlayedAtLabel, trackMinutes } from "../../src/lib/play-stats";
import type { Release } from "../../src/shared/types";

describe("lastPlayedAtLabel (#398)", () => {
  // Today is 24 Oct 2026 (in UTC).
  const label = (ms: number, tz = "UTC", today = "2026-10-24") => lastPlayedAtLabel(ms, today, "en-GB", tz);

  it("says Today at, Yesterday at and the date at, with the time", () => {
    expect(label(Date.UTC(2026, 9, 24, 21, 14))).toBe("Today at 21:14");
    expect(label(Date.UTC(2026, 9, 23, 9, 2))).toBe("Yesterday at 09:02");
    expect(label(Date.UTC(2026, 9, 12, 18, 30))).toBe("12 Oct at 18:30");
  });

  it("adds the year when it is not this one", () => {
    expect(label(Date.UTC(2025, 11, 30, 8, 5))).toBe("30 Dec 2025 at 08:05");
  });

  it("uses the given time zone for both the time and the day", () => {
    // 21:14 UTC is 06:14 the next morning in Tokyo, where today is the 25th.
    expect(label(Date.UTC(2026, 9, 24, 21, 14), "Asia/Tokyo", "2026-10-25")).toBe("Today at 06:14");
    expect(label(Date.UTC(2026, 9, 24, 14, 0), "Asia/Tokyo", "2026-10-25")).toBe("Yesterday at 23:00");
  });

  it("uses the locale's clock", () => {
    expect(lastPlayedAtLabel(Date.UTC(2026, 9, 24, 21, 14), "2026-10-24", "en-US", "UTC")).toMatch(/^Today at 09:14\s?PM$/);
  });
});

describe("minutes (#398)", () => {
  it("is listenedMs/60000 plus the plays without an event times the track's length", () => {
    expect(trackMinutes(642_000, 4, 3, 180)).toBeCloseTo(10.7 + 3, 5);
    expect(trackMinutes(0, 5, 0, 120)).toBe(10);
    expect(trackMinutes(120_000, 2, 2, 300)).toBe(2);
  });

  it("never goes negative on the estimate when events outnumber plays, and an unknown length adds 0", () => {
    expect(trackMinutes(60_000, 1, 3, 200)).toBe(1);
    expect(trackMinutes(0, 4, 1, null)).toBe(0);
  });

  it("albums and artists sum their tracks, and last played is the latest", () => {
    const release = {
      id: "r1", kind: "album", title: "Album", artist: "Artist", year: null, genre: null, coverPath: null, folderPath: "/x",
      tracks: [
        { id: "t1", title: "One", trackNumber: 1, filePath: "", originalName: "", durationSec: 180 },
        { id: "t2", title: "Two", trackNumber: 2, filePath: "", originalName: "", durationSec: 60 },
      ],
      createdAt: "", updatedAt: "",
    } as unknown as Release;
    const stats = aggregatePlays([release], [
      { releaseId: "r1", trackId: "t1", plays: 4, listenedMs: 642_000, events: 3, lastPlayedAt: 5000 },
      { releaseId: "r1", trackId: "t2", plays: 2, lastPlayedAt: 9000 },
    ]);
    expect(stats.tracks.map((t) => [t.id, t.minutes])).toEqual([["t1", 10.7 + 3], ["t2", 2]]);
    expect(stats.albums[0].minutes).toBeCloseTo(15.7, 5);
    expect(stats.albums[0].lastPlayedAt).toBe(9000);
    expect(stats.artists[0].minutes).toBeCloseTo(15.7, 5);
    expect(stats.artists[0].lastPlayedAt).toBe(9000);
  });
});
