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

/** The quiet line for a period with no plays (when plays exist from before it). */
export function periodEmptyLine(period: StatsPeriod): string {
  const when = period === "today" ? "today" : period === "week" ? "this week" : "this month";
  return `No plays yet ${when}.`;
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
  /** The release to open for this item: the track's, or the album itself. null for an artist. */
  releaseId: string | null;
  /** The latest day (`YYYY-MM-DD`) in the period with a play of it; null when the counts carry no days (all time). */
  lastPlayedDay: string | null;
  /** Epoch ms the item was last played, from play events (#398); null when none of its plays has one. */
  lastPlayedAt: number | null;
  /** Minutes listened in the period (all time on the all-time tab): see {@link trackMinutes}. Null when nothing is known. */
  minutes: number | null;
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
  releaseId: string | null;
  lastPlayedDay: string | null;
  lastPlayedAt: number | null;
  minutes: number | null;
}

/** The later of two optional instants. */
function laterAt(a: number | null, b: number | null): number | null {
  return a === null ? b : b === null ? a : Math.max(a, b);
}

/**
 * Minutes for one track over a window (`spec/sync.md`, "Play events"): the audible time of its events plus the #367
 * estimate (a full length per play) for the plays that have no event. A track with no known length adds 0 for
 * the estimated part. Shown as plain minutes, with no "about" for the estimate.
 */
export function trackMinutes(listenedMs: number, plays: number, events: number, lengthSec: number | null): number {
  const estimated = Math.max(0, plays - events) * ((lengthSec ?? 0) / 60);
  return listenedMs / 60000 + estimated;
}

/**
 * "Today at 21:14", "Yesterday at 09:02", "12 Oct at 18:30" (the year too when it is not this one): the moment of the
 * latest play in the browser's locale and time zone. `today` is the page's `YYYY-MM-DD` in that zone, which keeps the
 * render pure. `locale` and `timeZone` are for tests; the browser's are used when omitted.
 */
export function lastPlayedAtLabel(ms: number, today: string, locale?: string, timeZone?: string): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(ms);
  if (day === today) return `Today at ${time}`;
  const [y, m, d] = today.split("-").map(Number);
  if (day === new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)) return `Yesterday at ${time}`;
  const date = new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "numeric",
    month: "short",
    ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" as const }),
  }).format(ms);
  return `${date} at ${time}`;
}

/** The later of two optional days. */
function laterDay(a: string | null, b: string | null): string | null {
  return a === null ? b : b === null ? a : a > b ? a : b;
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
  lastPlayedDay: string | null;
  lastPlayedAt: number | null;
  minutes: number | null;
}

/** One track's plays on this Mac: a row of the summary's `tracks` (the chosen period) or `allTime`. */
export type TrackPlayCount = Pick<PlaysSummaryTrack, "releaseId" | "trackId" | "plays"> &
  Partial<Pick<PlaysSummaryTrack, "lastPlayedDay" | "lastPlayedAt" | "listenedMs" | "events">>;

/**
 * The top `limit` (three by default) tracks, albums (releases, singles included) and artists by plays.
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

  const countsByRelease = new Map<string, Map<string, TrackPlayCount>>();
  for (const t of counts) {
    const forRelease = countsByRelease.get(t.releaseId) ?? new Map<string, TrackPlayCount>();
    forRelease.set(t.trackId, t);
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
        lastPlayedDay: null,
        lastPlayedAt: null,
        minutes: null,
      });
    }
    const entry = artists.get(key);
    if (entry) entry.releases += 1;
  }

  for (const release of releases) {
    const counted = countsByRelease.get(release.id);

    const cover = coverOf(release);
    let releasePlays = 0;
    let releaseLast: string | null = null;
    let releaseAt: number | null = null;
    let releaseMinutes = 0;
    for (const track of release.tracks) {
      const entry = counted?.get(track.id);
      const plays = entry?.plays ?? 0;
      if (!Number.isFinite(plays) || plays <= 0) continue;
      releasePlays += plays;
      const lastPlayedDay = entry?.lastPlayedDay || null;
      releaseLast = laterDay(releaseLast, lastPlayedDay);
      const lastPlayedAt = typeof entry?.lastPlayedAt === "number" ? entry.lastPlayedAt : null;
      releaseAt = laterAt(releaseAt, lastPlayedAt);
      const minutes = trackMinutes(entry?.listenedMs ?? 0, plays, entry?.events ?? 0, track.durationSec);
      releaseMinutes += minutes;
      trackRows.push({
        id: track.id,
        title: track.title || release.title,
        subtitle: release.artist,
        plays,
        cover,
        releaseId: release.id,
        lastPlayedDay,
        lastPlayedAt,
        minutes,
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
      releaseId: release.id,
      lastPlayedDay: releaseLast,
      lastPlayedAt: releaseAt,
      minutes: releaseMinutes,
    });

    const artist = artists.get(artistKey(release.artist));
    if (artist) {
      artist.plays += releasePlays;
      artist.lastPlayedDay = laterDay(artist.lastPlayedDay, releaseLast);
      artist.lastPlayedAt = laterAt(artist.lastPlayedAt, releaseAt);
      artist.minutes = (artist.minutes ?? 0) + releaseMinutes;
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
    releaseId: null,
    lastPlayedDay: a.lastPlayedDay,
    lastPlayedAt: a.lastPlayedAt,
    minutes: a.minutes,
  }));

  return {
    total,
    tracks: rankRows(trackRows, limit),
    albums: rankRows(albumRows, limit),
    artists: rankRows(artistRows, limit),
  };
}
