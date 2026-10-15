/** Play-count rankings for the sidebar widgets (#154): the top tracks, albums and artists, from
 * the library list plus this Mac's `GET /api/plays/summary` (#200): the plays in the chosen period
 * (#203), or `allTime`. Pure: no fetch of its own, no DOM. Each play is counted once. */

import type { PlaysSummaryTrack, Release } from "../shared/types";

/** The three ranked lists. */
export type StatKind = "tracks" | "albums" | "artists";

/** The lists in the order the panel shows them. */
export const STAT_KINDS: { key: StatKind; title: string; tab: string }[] = [
  { key: "tracks", title: "Top tracks", tab: "Tracks" },
  { key: "albums", title: "Top albums", tab: "Albums" },
  { key: "artists", title: "Top artists", tab: "Artists" },
];

/** What the widgets cover (the ranges are in lib/play-periods). All time is not in the sidebar. */
export type StatsPeriod = "today" | "week" | "month";

/** The period the panel starts on. */
export const DEFAULT_PERIOD: StatsPeriod = "week";

/** The periods the switch offers. */
export const PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

/** The panel heading for a period. */
export function periodHeading(period: StatsPeriod): string {
  switch (period) {
    case "today":
      return "Today";
    case "week":
      return "Your week";
    case "month":
      return "Your month";
  }
}

/** The quiet line for a period with no plays when other plays exist (counting by day is new). */
export function periodEmptyLine(period: StatsPeriod): string {
  const when = period === "today" ? "today" : period === "week" ? "this week" : "this month";
  return `No plays yet ${when}. Counting by day started with this update.`;
}

/** How many of each list the sidebar shows. */
export const TOP_COUNT = 3;

/** Which release's cover to draw: enough to build the cover URL, nothing about the file. */
export interface StatCover {
  releaseId: string;
  updatedAt: string;
}

export interface StatItem {
  /** Stable across refreshes: a track id, a release id, or the normalised artist name. */
  id: string;
  /** 1-based position. Equal plays are still ordered (see {@link aggregatePlays}), so ranks never repeat. */
  rank: number;
  title: string;
  subtitle: string;
  plays: number;
  cover: StatCover | null;
}

export interface PlayStats {
  /** Every counted play in the library, each once. 0 means there is nothing to show. */
  total: number;
  tracks: StatItem[];
  albums: StatItem[];
  artists: StatItem[];
}

export type Medal = "gold" | "silver" | "bronze";

/** The first three ranks get a gold, silver and bronze touch. */
export function medalFor(rank: number): Medal | undefined {
  return rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : undefined;
}

/** "1 release", "6 releases". Also the Library row's count in the sidebar. */
export function releaseCountLabel(count: number): string {
  return count === 1 ? "1 release" : `${count} releases`;
}

interface Row {
  id: string;
  title: string;
  subtitle: string;
  plays: number;
  cover: StatCover | null;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);
}

/** Most plays first. Equal plays go A to Z by title, then by id, so the order never flickers. */
function rankRows(rows: Row[], limit: number): StatItem[] {
  return rows
    .filter((row) => row.plays > 0)
    .sort((a, b) => b.plays - a.plays || compareText(a.title, b.title) || compareText(a.id, b.id))
    .slice(0, limit)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

function coverOf(release: Release): StatCover | null {
  return release.coverPath ? { releaseId: release.id, updatedAt: release.updatedAt } : null;
}

/** "Mira Valdane" and " mira valdane " are one artist. */
function artistKey(name: string): string {
  return name.normalize("NFKC").trim().toLowerCase();
}

interface ArtistTotals {
  name: string;
  plays: number;
  /** Releases by this artist in the library, played or not. */
  releases: number;
  /** The most played release by this artist. */
  best: { plays: number; release: Release } | null;
  /** The first played release with a cover, for when the best one has none. */
  coverFallback: StatCover | null;
}

/** One track's plays on this Mac: a row of the summary's `tracks` (the chosen period) or `allTime`. */
export type TrackPlayCount = Pick<PlaysSummaryTrack, "releaseId" | "trackId" | "plays">;

/**
 * The top three tracks, albums (releases, singles included) and artists by plays.
 * Only tracks still in the library count, so a count left behind for a removed track is ignored.
 * Ties: A to Z by title, then by id. An artist with a blank name is left out of the artist list.
 */
export function aggregatePlays(
  releases: Release[],
  counts: TrackPlayCount[],
  limit: number = TOP_COUNT,
): PlayStats {
  const trackRows: Row[] = [];
  const albumRows: Row[] = [];
  const artists = new Map<string, ArtistTotals>();
  let total = 0;

  const countsByRelease = new Map<string, Map<string, number>>();
  for (const t of counts) {
    const forRelease = countsByRelease.get(t.releaseId) ?? new Map<string, number>();
    forRelease.set(t.trackId, t.plays);
    countsByRelease.set(t.releaseId, forRelease);
  }

  for (const release of releases) {
    const key = artistKey(release.artist);
    if (key !== "" && !artists.has(key)) {
      artists.set(key, {
        name: release.artist.trim(),
        plays: 0,
        releases: 0,
        best: null,
        coverFallback: null,
      });
    }
    const entry = artists.get(key);
    if (entry) entry.releases += 1;
  }

  for (const release of releases) {
    const counted = countsByRelease.get(release.id);

    const cover = coverOf(release);
    let releasePlays = 0;
    for (const track of release.tracks) {
      const plays = counted?.get(track.id) ?? 0;
      if (!Number.isFinite(plays) || plays <= 0) continue;
      releasePlays += plays;
      trackRows.push({
        id: track.id,
        title: track.title || release.title,
        subtitle: release.artist,
        plays,
        cover,
      });
    }
    if (releasePlays === 0) continue;

    total += releasePlays;
    albumRows.push({
      id: release.id,
      title: release.title || release.artist,
      subtitle: release.artist,
      plays: releasePlays,
      cover,
    });

    const artist = artists.get(artistKey(release.artist));
    if (artist) {
      artist.plays += releasePlays;
      if (!artist.best || releasePlays > artist.best.plays) {
        artist.best = { plays: releasePlays, release };
      }
      if (!artist.coverFallback && cover) artist.coverFallback = cover;
    }
  }

  const artistRows: Row[] = [...artists.entries()].map(([key, a]) => ({
    id: key,
    title: a.name,
    subtitle: a.best?.release.genre || releaseCountLabel(a.releases),
    plays: a.plays,
    cover: (a.best && coverOf(a.best.release)) ?? a.coverFallback,
  }));

  return {
    total,
    tracks: rankRows(trackRows, limit),
    albums: rankRows(albumRows, limit),
    artists: rankRows(artistRows, limit),
  };
}
