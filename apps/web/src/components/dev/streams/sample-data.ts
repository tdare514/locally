/**
 * SAMPLE DATA ONLY (#145 design prototype). Nothing here comes from the play tracker.
 *
 * What the app can know today is each track's absolute running count per device, summed into one
 * total (plays.json on the Mac, `play_counts` on the sync service): no timestamps, no history. So
 * "all time" below is real in shape, while "this week", "this month", "last week" and "last played"
 * are invented here to show what the page could do once per-day counts exist (see DataNeeded).
 *
 * The releases reuse the drawn covers of the demo library (src/server/demo) but the titles, the
 * artist split and every number are made up: 24 tracks, 6 releases, 5 artists, with one artist
 * holding two releases so the Artists view isn't one-to-one with Albums.
 *
 * Pure module: no imports, so the server page and the client components can both use it.
 */

export type Variant = "a" | "b" | "c";
export type Tab = "tracks" | "albums" | "artists";
export type SortKey = "plays" | "name" | "recent";
export type PeriodKey =
  | "this-week"
  | "last-week"
  | "october"
  | "september"
  | "august"
  | "july"
  | "all-time";

/** Demo release ids, used to look up the drawn SVG covers. */
export const COVER_IDS = [
  "demo-glasshouse-summer",
  "demo-paper-lanterns",
  "demo-night-bus-to-nowhere",
  "demo-saltwater-hymns",
  "demo-static-bloom",
  "demo-copper-sky-sessions",
] as const;
export type CoverId = (typeof COVER_IDS)[number];

export const VARIANTS: { value: Variant; label: string }[] = [
  { value: "a", label: "A Digest first" },
  { value: "b", label: "B Podium and sea" },
  { value: "c", label: "C Replay shelf" },
];

export const TABS: { value: Tab; label: string }[] = [
  { value: "tracks", label: "Tracks" },
  { value: "albums", label: "Albums" },
  { value: "artists", label: "Artists" },
];

export const SORTS: { value: SortKey; label: string }[] = [
  { value: "plays", label: "Plays" },
  { value: "name", label: "Name" },
  { value: "recent", label: "Recently played" },
];

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "this-week", label: "This week" },
  { key: "last-week", label: "Last week" },
  { key: "october", label: "October" },
  { key: "september", label: "September" },
  { key: "august", label: "August" },
  { key: "july", label: "July" },
  { key: "all-time", label: "All time" },
];

/** The three periods of direction B's toggle. */
export const B_PERIODS: PeriodKey[] = ["this-week", "october", "all-time"];

/** What direction A and B call the three periods; C names the month. */
export const RELATIVE_LABEL: Partial<Record<PeriodKey, string>> = {
  "this-week": "This week",
  october: "This month",
  "all-time": "All time",
};

export function periodLabel(key: PeriodKey): string {
  return PERIODS.find((p) => p.key === key)?.label ?? key;
}

// ---------------------------------------------------------------------------------------------
// The invented library
// ---------------------------------------------------------------------------------------------

interface SampleArtist {
  id: string;
  name: string;
}

interface SampleRelease {
  id: string;
  coverId: CoverId;
  title: string;
  artistId: string;
  kind: "Single" | "EP" | "Album";
  /** The cover's brightest colour, used for play bars and hover glows. */
  accent: string;
}

interface SampleTrack {
  id: string;
  releaseId: string;
  title: string;
  /** Plays since Monday. */
  week: number;
  /** Plays in October. */
  month: number;
  /** Plays since tracking began. */
  all: number;
  /** Minutes since this track last played. Consistent with `week`: played this week means < 5,000. */
  lastMins: number;
}

const ARTISTS: SampleArtist[] = [
  { id: "juno", name: "Juno Kessler" },
  { id: "orchard", name: "The Quiet Orchard" },
  { id: "okoro", name: "Okoro & the Tidemarks" },
  { id: "dax", name: "Dax Holloway Trio" },
  { id: "mira", name: "Mira Valdane" },
];

const RELEASES: SampleRelease[] = [
  { id: "night-bus", coverId: "demo-night-bus-to-nowhere", title: "Night Bus Sessions", artistId: "juno", kind: "EP", accent: "#ff4fa3" },
  { id: "lanterns", coverId: "demo-paper-lanterns", title: "Paper Lanterns", artistId: "orchard", kind: "Album", accent: "#8fd9a8" },
  { id: "saltwater", coverId: "demo-saltwater-hymns", title: "Saltwater Hymns", artistId: "okoro", kind: "Album", accent: "#7fd1c7" },
  { id: "copper", coverId: "demo-copper-sky-sessions", title: "Copper Sky Sessions", artistId: "dax", kind: "Album", accent: "#f08a3c" },
  { id: "glasshouse", coverId: "demo-glasshouse-summer", title: "Glasshouse Summer", artistId: "mira", kind: "Single", accent: "#ff7a59" },
  { id: "afterimage", coverId: "demo-static-bloom", title: "Afterimage", artistId: "mira", kind: "EP", accent: "#c6ff3d" },
];

const TRACKS: SampleTrack[] = [
  // Night Bus Sessions (4)
  { id: "t01", releaseId: "night-bus", title: "Night Bus to Nowhere", week: 28, month: 96, all: 214, lastMins: 38 },
  { id: "t02", releaseId: "night-bus", title: "Neon Transfer", week: 12, month: 41, all: 97, lastMins: 140 },
  { id: "t03", releaseId: "night-bus", title: "Last Stop Lullaby", week: 6, month: 22, all: 58, lastMins: 1500 },
  { id: "t04", releaseId: "night-bus", title: "Terminal Glow", week: 4, month: 15, all: 44, lastMins: 4300 },
  // Paper Lanterns (6)
  { id: "t05", releaseId: "lanterns", title: "Low Tide Morning", week: 11, month: 58, all: 163, lastMins: 310 },
  { id: "t06", releaseId: "lanterns", title: "Paper Lanterns", week: 9, month: 49, all: 188, lastMins: 1900 },
  { id: "t07", releaseId: "lanterns", title: "Orchard Gate", week: 4, month: 31, all: 102, lastMins: 2900 },
  { id: "t08", releaseId: "lanterns", title: "Slow Letters", week: 7, month: 44, all: 131, lastMins: 1700 },
  { id: "t09", releaseId: "lanterns", title: "Hollow Branch", week: 2, month: 18, all: 76, lastMins: 4400 },
  { id: "t10", releaseId: "lanterns", title: "Lantern Out", week: 4, month: 12, all: 52, lastMins: 3000 },
  // Saltwater Hymns (7)
  { id: "t11", releaseId: "saltwater", title: "First Light on the Pier", week: 7, month: 36, all: 143, lastMins: 720 },
  { id: "t12", releaseId: "saltwater", title: "Saltwater Hymn", week: 18, month: 103, all: 291, lastMins: 95 },
  { id: "t13", releaseId: "saltwater", title: "Rope and Ember", week: 4, month: 27, all: 98, lastMins: 3400 },
  { id: "t14", releaseId: "saltwater", title: "Harbour Lights", week: 6, month: 33, all: 121, lastMins: 1200 },
  { id: "t15", releaseId: "saltwater", title: "Where the Gulls Sleep", week: 0, month: 9, all: 87, lastMins: 6200 },
  { id: "t16", releaseId: "saltwater", title: "Amen, Tide", week: 1, month: 14, all: 109, lastMins: 3900 },
  { id: "t17", releaseId: "saltwater", title: "Low Water", week: 2, month: 8, all: 64, lastMins: 4100 },
  // Copper Sky Sessions (4)
  { id: "t18", releaseId: "copper", title: "Copper Sky", week: 5, month: 24, all: 118, lastMins: 2500 },
  { id: "t19", releaseId: "copper", title: "Quarter Past Blue", week: 3, month: 13, all: 71, lastMins: 3600 },
  { id: "t20", releaseId: "copper", title: "Rooftop Waltz", week: 1, month: 10, all: 83, lastMins: 4700 },
  { id: "t21", releaseId: "copper", title: "Understudy", week: 0, month: 6, all: 39, lastMins: 12000 },
  // Glasshouse Summer (1)
  { id: "t22", releaseId: "glasshouse", title: "Glasshouse Summer", week: 4, month: 29, all: 132, lastMins: 560 },
  // Afterimage (2)
  { id: "t23", releaseId: "afterimage", title: "Static Bloom", week: 3, month: 20, all: 85, lastMins: 880 },
  { id: "t24", releaseId: "afterimage", title: "Lime Hours", week: 1, month: 7, all: 33, lastMins: 4900 },
];

// ---------------------------------------------------------------------------------------------
// Counts per period
// ---------------------------------------------------------------------------------------------

/** A stable 0.55..1.45 factor per track and salt, so the made-up periods rank differently. */
function wobble(trackId: string, salt: number): number {
  let h = salt * 7 + 3;
  for (const ch of trackId) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return 0.55 + ((h % 100) / 100) * 0.9;
}

/** This track's plays in a period. This week, October and all time are the hand-written sample
 * numbers; last week and the earlier months are derived from them so the scroller has something
 * different to show in each chip. */
function playsIn(track: SampleTrack, period: PeriodKey): number {
  switch (period) {
    case "this-week":
      return track.week;
    case "october":
      return track.month;
    case "all-time":
      return track.all;
    case "last-week":
      return Math.round(track.week * wobble(track.id, 7) * 0.74) + (track.week === 0 ? 1 : 0);
    case "september":
      return Math.round(track.month * wobble(track.id, 2) * 0.88);
    case "august":
      return Math.round(track.month * wobble(track.id, 3) * 0.8);
    case "july":
      return Math.round(track.month * wobble(track.id, 4) * 0.7);
  }
}

/** The period the delta is measured against, or null for all time. */
function previousPeriod(period: PeriodKey): PeriodKey | null {
  if (period === "this-week") return "last-week";
  if (period === "october") return "september";
  if (period === "september") return "august";
  if (period === "august") return "july";
  return null;
}

function previousName(period: PeriodKey): string {
  const prev = previousPeriod(period);
  if (!prev) return "";
  return prev === "last-week" ? "last week" : periodLabel(prev);
}

// ---------------------------------------------------------------------------------------------
// Rows: one shape for tracks, albums and artists
// ---------------------------------------------------------------------------------------------

export interface Row {
  id: string;
  tab: Tab;
  title: string;
  /** Second line under the title. */
  subtitle: string;
  /** The column after the title: the release of a track, the track count of an album. */
  detail: string;
  plays: number;
  /** 1-based rank by plays in this period; null when nothing played. Stays put under any sort. */
  rank: number | null;
  coverId: CoverId;
  accent: string;
  lastMins: number;
  /** All-time plays, whatever the period; also the tiebreak when two rows tie in the period. */
  allTime: number;
  /** Artists show as round discs. */
  round: boolean;
}

const artistById = new Map(ARTISTS.map((a) => [a.id, a]));
const releaseById = new Map(RELEASES.map((r) => [r.id, r]));

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function rawRows(tab: Tab, period: PeriodKey): Omit<Row, "rank">[] {
  if (tab === "tracks") {
    return TRACKS.map((t) => {
      const release = releaseById.get(t.releaseId)!;
      return {
        id: t.id,
        tab,
        title: t.title,
        subtitle: artistById.get(release.artistId)!.name,
        detail: release.title,
        plays: playsIn(t, period),
        coverId: release.coverId,
        accent: release.accent,
        lastMins: t.lastMins,
        round: false,
        allTime: t.all,
      };
    });
  }
  if (tab === "albums") {
    return RELEASES.map((r) => {
      const tracks = TRACKS.filter((t) => t.releaseId === r.id);
      return {
        id: r.id,
        tab,
        title: r.title,
        subtitle: artistById.get(r.artistId)!.name,
        detail: r.kind === "Single" ? "Single" : plural(tracks.length, "track"),
        plays: tracks.reduce((sum, t) => sum + playsIn(t, period), 0),
        coverId: r.coverId,
        accent: r.accent,
        lastMins: Math.min(...tracks.map((t) => t.lastMins)),
        round: false,
        allTime: tracks.reduce((sum, t) => sum + t.all, 0),
      };
    });
  }
  return ARTISTS.map((a) => {
    const releases = RELEASES.filter((r) => r.artistId === a.id);
    const tracks = TRACKS.filter((t) => releases.some((r) => r.id === t.releaseId));
    // The disc shows the cover of the artist's most-played release (all time).
    const lead = [...releases].sort(
      (x, y) =>
        TRACKS.filter((t) => t.releaseId === y.id).reduce((s, t) => s + t.all, 0) -
        TRACKS.filter((t) => t.releaseId === x.id).reduce((s, t) => s + t.all, 0),
    )[0];
    return {
      id: a.id,
      tab,
      title: a.name,
      subtitle: plural(releases.length, "release"),
      detail: plural(tracks.length, "track"),
      plays: tracks.reduce((sum, t) => sum + playsIn(t, period), 0),
      coverId: lead.coverId,
      accent: lead.accent,
      lastMins: Math.min(...tracks.map((t) => t.lastMins)),
      round: true,
      allTime: tracks.reduce((sum, t) => sum + t.all, 0),
    };
  });
}

/** Rows for a tab and period, ranked by plays (ties broken by all-time plays, then name) and
 * returned in rank order. */
export function rankedRows(tab: Tab, period: PeriodKey): Row[] {
  const sorted = rawRows(tab, period).sort(
    (a, b) => b.plays - a.plays || b.allTime - a.allTime || a.title.localeCompare(b.title),
  );
  return sorted.map((row, i) => ({ ...row, rank: row.plays > 0 ? i + 1 : null }));
}

export function sortRows(rows: Row[], sort: SortKey): Row[] {
  const copy = [...rows];
  if (sort === "name") return copy.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "recent") return copy.sort((a, b) => a.lastMins - b.lastMins);
  return copy; // already in rank order
}

// ---------------------------------------------------------------------------------------------
// Digests
// ---------------------------------------------------------------------------------------------

export interface Digest {
  period: PeriodKey;
  total: number;
  /** Total of the period before it; null for all time. */
  prevTotal: number | null;
  /** "last week", "September"; empty for all time. */
  prevName: string;
  tracks: Row[];
  albums: Row[];
  artists: Row[];
}

function totalFor(period: PeriodKey): number {
  return TRACKS.reduce((sum, t) => sum + playsIn(t, period), 0);
}

export function digestFor(period: PeriodKey): Digest {
  const prev = previousPeriod(period);
  return {
    period,
    total: totalFor(period),
    prevTotal: prev ? totalFor(prev) : null,
    prevName: previousName(period),
    tracks: rankedRows("tracks", period),
    albums: rankedRows("albums", period),
    artists: rankedRows("artists", period),
  };
}

export const TRACK_COUNT = TRACKS.length;
export const RELEASE_COUNT = RELEASES.length;
export const ARTIST_COUNT = ARTISTS.length;

/** "24 more than last week", "9 fewer than September", or "" for all time. */
export function comparison(d: Digest): string {
  if (d.prevTotal === null) return "";
  const diff = d.total - d.prevTotal;
  if (diff === 0) return `the same as ${d.prevName}`;
  return `${fmt(Math.abs(diff))} ${diff > 0 ? "more" : "fewer"} than ${d.prevName}`;
}

/** B's compact digest, one or two short sentences. */
export function compactSentence(d: Digest): string {
  const top = d.tracks[0]?.title ?? "nothing yet";
  const cmp = comparison(d);
  if (d.period === "all-time") {
    return `${fmt(d.total)} plays so far across ${TRACK_COUNT} tracks, mostly ${top}.`;
  }
  const when = d.period === "this-week" ? "this week" : `in ${periodLabel(d.period)}`;
  return `${fmt(d.total)} plays ${when}, mostly ${top}.${cmp ? ` That is ${cmp}.` : ""}`;
}

/** C's playful headline for the period. */
export function headline(d: Digest): string {
  const top = d.tracks[0];
  if (!top) return "Nothing played yet.";
  const n = fmt(top.plays);
  const total = fmt(d.total);
  switch (d.period) {
    case "this-week":
      return `${top.title} kept coming back: ${n} of your ${total} plays this week.`;
    case "last-week":
      return `Last week it was ${top.title}, with ${n} of ${total} plays.`;
    case "all-time":
      return `${total} plays so far, and ${top.title} is still out in front with ${n}.`;
    default:
      return `${periodLabel(d.period)} was ${top.title}'s month: ${n} of ${total} plays.`;
  }
}

// ---------------------------------------------------------------------------------------------
// Formatting and query-param parsing
// ---------------------------------------------------------------------------------------------

/** en-US on purpose: the server and the browser must print the same digits. */
export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function playsLabel(n: number): string {
  return n === 1 ? "1 play" : `${fmt(n)} plays`;
}

export function ago(mins: number): string {
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)} h ago`;
  if (mins < 2880) return "Yesterday";
  if (mins < 10080) return `${Math.floor(mins / 1440)} days ago`;
  const weeks = Math.floor(mins / 10080);
  return weeks === 1 ? "Last week" : `${weeks} weeks ago`;
}

export function parseVariant(value: string | undefined): Variant {
  return value === "b" || value === "c" ? value : "a";
}

export function parseTab(value: string | undefined): Tab {
  return value === "albums" || value === "artists" ? value : "tracks";
}

export function parseSort(value: string | undefined): SortKey {
  return value === "name" || value === "recent" ? value : "plays";
}

export function parsePeriod(value: string | undefined): PeriodKey | null {
  return PERIODS.some((p) => p.key === value) ? (value as PeriodKey) : null;
}

/** Counts shown in the segmented control. */
export const TAB_COUNTS: Record<Tab, number> = {
  tracks: TRACK_COUNT,
  albums: RELEASE_COUNT,
  artists: ARTIST_COUNT,
};
