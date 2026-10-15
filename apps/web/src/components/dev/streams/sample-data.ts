/**
 * SAMPLE DATA ONLY (#145 design prototype). Nothing here comes from the play tracker.
 *
 * What the app can know today is each track's absolute running count per device, summed into one
 * total (plays.json on the Mac, `play_counts` on the sync service): no timestamps, no history. So
 * "all time" below is real in shape, while today, this week, this month, this year, every step
 * back and "last played" are invented here to show what the page could do once per-day counts
 * exist (see FooterNotes).
 *
 * The invented history is a day-by-day count per track, built once from a fixed seed, and every
 * period is a sum over it. So a week is exactly the sum of its days, a year the sum of its months,
 * and all time the sum of everything, and stepping back gives each period its own plausible,
 * different numbers.
 *
 * The releases reuse the drawn covers of the demo library (src/server/demo) but the titles, the
 * artist split and every number are made up: 24 tracks, 6 releases, 5 artists, with one artist
 * holding two releases so the Artists view isn't one-to-one with Albums.
 *
 * Pure module: no imports, no clock and no randomness, so the server page and the client
 * components print the same numbers.
 */

export type Tab = "tracks" | "albums" | "artists";
export type SortKey = "plays" | "name" | "recent";
export type View = "list" | "grid";
export type PeriodKind = "day" | "week" | "month" | "year" | "all";

/** A time frame: a kind and how many steps back from the current one (0 is today, this week...). */
export interface Period {
  kind: PeriodKind;
  back: number;
}

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

/** The five time frames, shortest first. Each can step back except all time. */
export const PERIOD_KINDS: { value: PeriodKind; label: string }[] = [
  { value: "day", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
  { value: "all", label: "All time" },
];

// ---------------------------------------------------------------------------------------------
// The calendar
// ---------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Days since 1970-01-01 (UTC), so day arithmetic is plain subtraction. */
function dayIndex(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month, day) / DAY_MS);
}

/** The sample's today: Thursday 15 October 2026, at 16:40. */
const TODAY = dayIndex(2026, 9, 15);
const NOW_MINUTE = 16 * 60 + 40;
/** Tracking began with the oldest release (540 days ago, 23 April 2025), so "this year" is a part
 * of all time and stepping back never lands on a stretch with nothing in it. */
const START = TODAY - 540;
const DAYS = TODAY - START + 1;

function dateOf(day: number): Date {
  return new Date(day * DAY_MS);
}

function shortDate(day: number): string {
  const d = dateOf(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function weekdayDate(day: number): string {
  return `${WEEKDAYS[dateOf(day).getUTCDay()]} ${shortDate(day)}`;
}

function mondayOf(day: number): number {
  return day - ((dateOf(day).getUTCDay() + 6) % 7);
}

interface Range {
  from: number;
  to: number;
  /** "Today", "Last week", "3 months ago". */
  label: string;
  /** The dates it covers: "5 to 11 Oct", "September 2026". */
  detail: string;
  /** For the digest sentence: "today", "last week", "in August". */
  when: string;
}

function rangeOf({ kind, back }: Period): Range {
  const ago = (one: string, many: string) => (back === 1 ? one : `${back} ${many} ago`);
  const now = dateOf(TODAY);
  switch (kind) {
    case "day": {
      const day = TODAY - back;
      return {
        from: day,
        to: day,
        label: back === 0 ? "Today" : ago("Yesterday", "days"),
        detail: weekdayDate(day),
        when: back === 0 ? "today" : back === 1 ? "yesterday" : `on ${weekdayDate(day)}`,
      };
    }
    case "week": {
      const monday = mondayOf(TODAY) - 7 * back;
      return {
        from: monday,
        to: Math.min(monday + 6, TODAY),
        label: back === 0 ? "This week" : ago("Last week", "weeks"),
        detail: `${shortDate(monday)} to ${shortDate(monday + 6)}`,
        when: back === 0 ? "this week" : back === 1 ? "last week" : `in the week of ${shortDate(monday)}`,
      };
    }
    case "month": {
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
      const from = Math.floor(first.getTime() / DAY_MS);
      const last = dayIndex(first.getUTCFullYear(), first.getUTCMonth() + 1, 0);
      const name = MONTHS_LONG[first.getUTCMonth()];
      const year = first.getUTCFullYear();
      return {
        from,
        to: Math.min(last, TODAY),
        label: back === 0 ? "This month" : ago("Last month", "months"),
        detail: `${name} ${year}`,
        when:
          back === 0
            ? "this month"
            : back === 1
              ? "last month"
              : `in ${name}${year === now.getUTCFullYear() ? "" : ` ${year}`}`,
      };
    }
    case "year": {
      const year = now.getUTCFullYear() - back;
      return {
        from: Math.max(dayIndex(year, 0, 1), START),
        to: Math.min(dayIndex(year, 11, 31), TODAY),
        label: back === 0 ? "This year" : ago("Last year", "years"),
        detail: `${year}`,
        when: back === 0 ? "this year" : back === 1 ? "last year" : `in ${year}`,
      };
    }
    case "all":
      return {
        from: START,
        to: TODAY,
        label: "All time",
        detail: `Since ${shortDate(START)} ${dateOf(START).getUTCFullYear()}`,
        when: "so far",
      };
  }
}

/** How far back a kind can step before it ends up wholly before tracking began. */
export function maxBack(kind: PeriodKind): number {
  if (kind === "all") return 0;
  let back = 0;
  while (rangeOf({ kind, back: back + 1 }).to >= START) back += 1;
  return back;
}

/** "Last week", "3 months ago". */
export function periodLabel(period: Period): string {
  return rangeOf(period).label;
}

/** "5 to 11 Oct", "September 2026". */
export function periodDetail(period: Period): string {
  return rangeOf(period).detail;
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
  /** Days before today that it joined the library; nothing plays before that. */
  since: number;
}

interface SampleTrack {
  id: string;
  releaseId: string;
  title: string;
  /** Relative pull: about weight / 110 plays a day while the release is in the library. */
  weight: number;
  /** How much hotter (or colder) it is right now than usual; fades over a month or so. */
  heat: number;
}

const ARTISTS: SampleArtist[] = [
  { id: "juno", name: "Juno Kessler" },
  { id: "orchard", name: "The Quiet Orchard" },
  { id: "okoro", name: "Okoro & the Tidemarks" },
  { id: "dax", name: "Dax Holloway Trio" },
  { id: "mira", name: "Mira Valdane" },
];

const RELEASES: SampleRelease[] = [
  { id: "night-bus", coverId: "demo-night-bus-to-nowhere", title: "Night Bus Sessions", artistId: "juno", kind: "EP", accent: "#ff4fa3", since: 75 },
  { id: "lanterns", coverId: "demo-paper-lanterns", title: "Paper Lanterns", artistId: "orchard", kind: "Album", accent: "#8fd9a8", since: 470 },
  { id: "saltwater", coverId: "demo-saltwater-hymns", title: "Saltwater Hymns", artistId: "okoro", kind: "Album", accent: "#7fd1c7", since: 540 },
  { id: "copper", coverId: "demo-copper-sky-sessions", title: "Copper Sky Sessions", artistId: "dax", kind: "Album", accent: "#f08a3c", since: 330 },
  { id: "glasshouse", coverId: "demo-glasshouse-summer", title: "Glasshouse Summer", artistId: "mira", kind: "Single", accent: "#ff7a59", since: 400 },
  { id: "afterimage", coverId: "demo-static-bloom", title: "Afterimage", artistId: "mira", kind: "EP", accent: "#c6ff3d", since: 190 },
];

const TRACKS: SampleTrack[] = [
  // Night Bus Sessions (4): new this season, so hot
  { id: "t01", releaseId: "night-bus", title: "Night Bus to Nowhere", weight: 214, heat: 2.2 },
  { id: "t02", releaseId: "night-bus", title: "Neon Transfer", weight: 97, heat: 2.0 },
  { id: "t03", releaseId: "night-bus", title: "Last Stop Lullaby", weight: 58, heat: 1.2 },
  { id: "t04", releaseId: "night-bus", title: "Terminal Glow", weight: 44, heat: 1.0 },
  // Paper Lanterns (6)
  { id: "t05", releaseId: "lanterns", title: "Low Tide Morning", weight: 163, heat: 0.4 },
  { id: "t06", releaseId: "lanterns", title: "Paper Lanterns", weight: 188, heat: -0.3 },
  { id: "t07", releaseId: "lanterns", title: "Orchard Gate", weight: 102, heat: 0 },
  { id: "t08", releaseId: "lanterns", title: "Slow Letters", weight: 131, heat: 0.1 },
  { id: "t09", releaseId: "lanterns", title: "Hollow Branch", weight: 76, heat: -0.2 },
  { id: "t10", releaseId: "lanterns", title: "Lantern Out", weight: 52, heat: 0 },
  // Saltwater Hymns (7)
  { id: "t11", releaseId: "saltwater", title: "First Light on the Pier", weight: 143, heat: 0.2 },
  { id: "t12", releaseId: "saltwater", title: "Saltwater Hymn", weight: 291, heat: 0.6 },
  { id: "t13", releaseId: "saltwater", title: "Rope and Ember", weight: 98, heat: 0 },
  { id: "t14", releaseId: "saltwater", title: "Harbour Lights", weight: 121, heat: 0 },
  { id: "t15", releaseId: "saltwater", title: "Where the Gulls Sleep", weight: 87, heat: -0.6 },
  { id: "t16", releaseId: "saltwater", title: "Amen, Tide", weight: 109, heat: -0.5 },
  { id: "t17", releaseId: "saltwater", title: "Low Water", weight: 64, heat: -0.3 },
  // Copper Sky Sessions (4)
  { id: "t18", releaseId: "copper", title: "Copper Sky", weight: 118, heat: -0.2 },
  { id: "t19", releaseId: "copper", title: "Quarter Past Blue", weight: 71, heat: 0 },
  { id: "t20", releaseId: "copper", title: "Rooftop Waltz", weight: 83, heat: -0.4 },
  { id: "t21", releaseId: "copper", title: "Understudy", weight: 39, heat: -0.7 },
  // Glasshouse Summer (1)
  { id: "t22", releaseId: "glasshouse", title: "Glasshouse Summer", weight: 132, heat: -0.4 },
  // Afterimage (2)
  { id: "t23", releaseId: "afterimage", title: "Static Bloom", weight: 85, heat: 0.8 },
  { id: "t24", releaseId: "afterimage", title: "Lime Hours", weight: 33, heat: 0.3 },
];

// ---------------------------------------------------------------------------------------------
// The day-by-day history every period is summed from
// ---------------------------------------------------------------------------------------------

/** A fixed-seed 0..1 value for (a, b, c); integer mixing only, so it is the same everywhere. */
function hash01(a: number, b: number, c = 0): number {
  let h = Math.imul(a + 1, 374761393) + Math.imul(b + 1, 668265263) + Math.imul(c + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Weekdays are busier (the commute), Sundays quietest. Indexed by getUTCDay(). */
const WEEKDAY_FACTOR = [0.75, 1.15, 1.15, 1.15, 1.15, 1.15, 0.9];

const releaseById = new Map(RELEASES.map((r) => [r.id, r]));

/** Plays of each track on each day since START. */
const DAILY: Uint16Array[] = TRACKS.map((track, ti) => {
  const since = releaseById.get(track.releaseId)!.since;
  const counts = new Uint16Array(DAYS);
  for (let i = 0; i < DAYS; i++) {
    const age = DAYS - 1 - i;
    if (age > since) continue;
    const trend = 1 + track.heat * Math.exp(-age / 40);
    const weekday = WEEKDAY_FACTOR[dateOf(START + i).getUTCDay()];
    const mood = 0.55 + hash01(i, 101) * 0.9;
    // Today is only part played at 16:40.
    const part = age === 0 ? 0.6 : 1;
    const expected = Math.max(0, (track.weight / 110) * trend * weekday * mood * part);
    let plays = Math.floor(expected + hash01(ti, i, 1));
    if (hash01(ti, i, 2) < 0.06) plays += 1 + Math.floor(hash01(ti, i, 3) * 3);
    counts[i] = plays;
  }
  return counts;
});

/** PREFIX[t][i] is the plays of track t on the first i days, so any range is two lookups. */
const PREFIX: Uint32Array[] = DAILY.map((counts) => {
  const sums = new Uint32Array(DAYS + 1);
  for (let i = 0; i < DAYS; i++) sums[i + 1] = sums[i] + counts[i];
  return sums;
});

function playsBetween(ti: number, from: number, to: number): number {
  const a = Math.max(from, START) - START;
  const b = Math.min(to, TODAY) - START;
  return b < a ? 0 : PREFIX[ti][b + 1] - PREFIX[ti][a];
}

/** Minutes between the track's last play on or before `end` and the sample's now. */
function lastPlayedMins(ti: number, end: number): number {
  const top = Math.min(end, TODAY);
  for (let day = top; day >= START; day--) {
    if (DAILY[ti][day - START] === 0) continue;
    const r = hash01(ti, day, 9);
    const minuteOfDay =
      day === TODAY ? 6 * 60 + Math.floor(r * (NOW_MINUTE - 6 * 60 - 5)) : 8 * 60 + Math.floor(r * 14 * 60);
    return (TODAY - day) * 1440 + NOW_MINUTE - minuteOfDay;
  }
  return NEVER;
}

/** Stands in for "never"; only unplayed rows can carry it, and they are not shown. */
const NEVER = 1e9;

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
  /** Minutes since the last play on or before the end of the period. */
  lastMins: number;
  /** All-time plays, whatever the period; also the tiebreak when two rows tie in the period. */
  allTime: number;
  /** Artists show as round discs. */
  round: boolean;
}

const artistById = new Map(ARTISTS.map((a) => [a.id, a]));

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function rawRows(tab: Tab, range: Range): Omit<Row, "rank">[] {
  const plays = (ti: number) => playsBetween(ti, range.from, range.to);
  const allTime = (ti: number) => playsBetween(ti, START, TODAY);
  const indexes = (releaseIds: string[]) =>
    TRACKS.flatMap((t, ti) => (releaseIds.includes(t.releaseId) ? [ti] : []));

  if (tab === "tracks") {
    return TRACKS.map((t, ti) => {
      const release = releaseById.get(t.releaseId)!;
      return {
        id: t.id,
        tab,
        title: t.title,
        subtitle: artistById.get(release.artistId)!.name,
        detail: release.title,
        plays: plays(ti),
        coverId: release.coverId,
        accent: release.accent,
        lastMins: lastPlayedMins(ti, range.to),
        round: false,
        allTime: allTime(ti),
      };
    });
  }
  if (tab === "albums") {
    return RELEASES.map((r) => {
      const tis = indexes([r.id]);
      return {
        id: r.id,
        tab,
        title: r.title,
        subtitle: artistById.get(r.artistId)!.name,
        detail: r.kind === "Single" ? "Single" : plural(tis.length, "track"),
        plays: tis.reduce((sum, ti) => sum + plays(ti), 0),
        coverId: r.coverId,
        accent: r.accent,
        lastMins: Math.min(...tis.map((ti) => lastPlayedMins(ti, range.to))),
        round: false,
        allTime: tis.reduce((sum, ti) => sum + allTime(ti), 0),
      };
    });
  }
  return ARTISTS.map((a) => {
    const releases = RELEASES.filter((r) => r.artistId === a.id);
    const tis = indexes(releases.map((r) => r.id));
    // The disc shows the cover of the artist's most-played release (all time).
    const releaseTotal = (id: string) => indexes([id]).reduce((s, ti) => s + allTime(ti), 0);
    const lead = [...releases].sort((x, y) => releaseTotal(y.id) - releaseTotal(x.id))[0];
    return {
      id: a.id,
      tab,
      title: a.name,
      subtitle: plural(releases.length, "release"),
      detail: plural(tis.length, "track"),
      plays: tis.reduce((sum, ti) => sum + plays(ti), 0),
      coverId: lead.coverId,
      accent: lead.accent,
      lastMins: Math.min(...tis.map((ti) => lastPlayedMins(ti, range.to))),
      round: true,
      allTime: tis.reduce((sum, ti) => sum + allTime(ti), 0),
    };
  });
}

/** Rows for a tab and period, ranked by plays (ties broken by all-time plays, then name) and
 * returned in rank order. Rows with no plays come last, unranked. */
export function rankedRows(tab: Tab, period: Period): Row[] {
  const sorted = rawRows(tab, rangeOf(period)).sort(
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
// The digest sentence
// ---------------------------------------------------------------------------------------------

/** One line for the top of the page: "You played your tracks 142 times this week, mostly Night Bus
 * to Nowhere." It always speaks of tracks, whichever tab is showing. */
export function digestSentence(period: Period): string {
  const range = rangeOf(period);
  const total = TRACKS.reduce((sum, _, ti) => sum + playsBetween(ti, range.from, range.to), 0);
  if (total === 0) return `You did not play any tracks ${range.when}.`;
  const top = rankedRows("tracks", period)[0].title;
  const times = total === 1 ? "time" : "times";
  if (period.kind === "all") return `You have played your tracks ${fmt(total)} ${times} so far, mostly ${top}.`;
  return `You played your tracks ${fmt(total)} ${times} ${range.when}, mostly ${top}.`;
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
  if (weeks < 9) return weeks === 1 ? "Last week" : `${weeks} weeks ago`;
  const months = Math.floor(mins / 43200);
  return months < 12 ? `${months} months ago` : months < 24 ? "Last year" : `${Math.floor(months / 12)} years ago`;
}

export function parseTab(value: string | undefined): Tab {
  return value === "albums" || value === "artists" ? value : "tracks";
}

export function parseSort(value: string | undefined): SortKey {
  return value === "name" || value === "recent" ? value : "plays";
}

export function parseView(value: string | undefined): View {
  return value === "grid" ? "grid" : "list";
}

/** `?period=day|week|month|year|all` and `?back=3`; anything else is this week. */
export function parsePeriod(kind: string | undefined, back: string | undefined): Period {
  const found = PERIOD_KINDS.find((k) => k.value === kind)?.value ?? "week";
  const steps = Math.floor(Number(back));
  return { kind: found, back: Number.isFinite(steps) && steps > 0 ? Math.min(steps, maxBack(found)) : 0 };
}
