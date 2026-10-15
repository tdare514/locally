import type { AmbientPalette } from "../../../lib/artwork-palette";

/**
 * SAMPLE DATA ONLY (#154 design prototype). None of this comes from the play tracker: the play
 * API only has per-track totals today, and per-period (today / week / month) counts are a
 * follow-up. Titles, artists and covers mirror the invented library in src/server/demo; the play
 * counts below are made up so the three periods rank differently.
 */

/** The sidebar's starting state, forced through `?state=` for screenshots. */
export type PanelStart = "closed" | "open" | "pinned";

export function parsePanelStart(value: string | undefined): PanelStart {
  return value === "open" || value === "pinned" ? value : "closed";
}

export type Period = "today" | "week" | "month";
export type WidgetKey = "tracks" | "albums" | "artists";

export const PERIODS: { value: Period; label: string; heading: string }[] = [
  { value: "today", label: "Today", heading: "Your day" },
  { value: "week", label: "This week", heading: "Your week" },
  { value: "month", label: "This month", heading: "Your month" },
];

export const WIDGETS: { key: WidgetKey; title: string; tab: string }[] = [
  { key: "tracks", title: "Top tracks", tab: "Tracks" },
  { key: "albums", title: "Top albums", tab: "Albums" },
  { key: "artists", title: "Top artists", tab: "Artists" },
];

/** Demo release ids, used to look up the drawn SVG covers. */
export const COVER_IDS = [
  "demo-glasshouse-summer",
  "demo-paper-lanterns",
  "demo-night-bus-to-nowhere",
  "demo-saltwater-hymns",
  "demo-static-bloom",
  "demo-copper-sky-sessions",
] as const;

export interface StatItem {
  id: string;
  rank: number;
  title: string;
  subtitle: string;
  plays: number;
  coverId: string;
}

/** Plays as [today, this week, this month]. */
interface SampleRow {
  id: string;
  title: string;
  subtitle: string;
  coverId: string;
  plays: [number, number, number];
}

const TRACKS: SampleRow[] = [
  { id: "t-glasshouse", title: "Glasshouse Summer", subtitle: "Mira Valdane", coverId: "demo-glasshouse-summer", plays: [14, 63, 212] },
  { id: "t-night-bus", title: "Night Bus to Nowhere", subtitle: "Juno Kessler", coverId: "demo-night-bus-to-nowhere", plays: [11, 71, 188] },
  { id: "t-saltwater", title: "Saltwater Hymn", subtitle: "Okoro & the Tidemarks", coverId: "demo-saltwater-hymns", plays: [9, 48, 164] },
  { id: "t-lanterns", title: "Paper Lanterns", subtitle: "The Quiet Orchard", coverId: "demo-paper-lanterns", plays: [8, 29, 86] },
  { id: "t-static", title: "Static Bloom", subtitle: "Pale Meridian", coverId: "demo-static-bloom", plays: [7, 39, 121] },
  { id: "t-low-tide", title: "Low Tide Morning", subtitle: "The Quiet Orchard", coverId: "demo-paper-lanterns", plays: [6, 33, 143] },
  { id: "t-copper", title: "Copper Sky", subtitle: "Dax Holloway Trio", coverId: "demo-copper-sky-sessions", plays: [3, 22, 97] },
  { id: "t-harbour", title: "Harbour Lights", subtitle: "Okoro & the Tidemarks", coverId: "demo-saltwater-hymns", plays: [4, 19, 71] },
];

/** Albums are the user's own releases, so the singles count too. */
const ALBUMS: SampleRow[] = [
  { id: "a-saltwater", title: "Saltwater Hymns", subtitle: "Okoro & the Tidemarks", coverId: "demo-saltwater-hymns", plays: [21, 97, 352] },
  { id: "a-lanterns", title: "Paper Lanterns", subtitle: "The Quiet Orchard", coverId: "demo-paper-lanterns", plays: [19, 84, 301] },
  { id: "a-glasshouse", title: "Glasshouse Summer", subtitle: "Mira Valdane", coverId: "demo-glasshouse-summer", plays: [14, 63, 212] },
  { id: "a-night-bus", title: "Night Bus to Nowhere", subtitle: "Juno Kessler", coverId: "demo-night-bus-to-nowhere", plays: [11, 71, 188] },
  { id: "a-static", title: "Static Bloom", subtitle: "Pale Meridian", coverId: "demo-static-bloom", plays: [7, 39, 121] },
  { id: "a-copper", title: "Copper Sky Sessions", subtitle: "Dax Holloway Trio", coverId: "demo-copper-sky-sessions", plays: [6, 41, 163] },
];

const ARTISTS: SampleRow[] = [
  { id: "r-okoro", title: "Okoro & the Tidemarks", subtitle: "Soul", coverId: "demo-saltwater-hymns", plays: [23, 104, 371] },
  { id: "r-orchard", title: "The Quiet Orchard", subtitle: "Indie folk", coverId: "demo-paper-lanterns", plays: [19, 88, 318] },
  { id: "r-mira", title: "Mira Valdane", subtitle: "Dream pop", coverId: "demo-glasshouse-summer", plays: [17, 92, 296] },
  { id: "r-juno", title: "Juno Kessler", subtitle: "Synthwave", coverId: "demo-night-bus-to-nowhere", plays: [13, 79, 214] },
  { id: "r-dax", title: "Dax Holloway Trio", subtitle: "Jazz", coverId: "demo-copper-sky-sessions", plays: [8, 44, 183] },
  { id: "r-pale", title: "Pale Meridian", subtitle: "Electronic", coverId: "demo-static-bloom", plays: [7, 39, 121] },
];

const POOLS: Record<WidgetKey, SampleRow[]> = { tracks: TRACKS, albums: ALBUMS, artists: ARTISTS };

/** The top five of a widget for a period, most played first. */
export function topFor(widget: WidgetKey, period: Period): StatItem[] {
  const at = period === "today" ? 0 : period === "week" ? 1 : 2;
  return [...POOLS[widget]]
    .sort((a, b) => b.plays[at] - a.plays[at])
    .slice(0, 5)
    .map((row, i) => ({
      id: row.id,
      rank: i + 1,
      title: row.title,
      subtitle: row.subtitle,
      plays: row.plays[at],
      coverId: row.coverId,
    }));
}

export type Medal = "gold" | "silver" | "bronze";

export function medalFor(rank: number): Medal | undefined {
  return rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : undefined;
}

/** What the mock library shows behind the sidebar. */
export const SAMPLE_RELEASES: { id: string; title: string; artist: string; kind: "single" | "album" }[] = [
  { id: "demo-glasshouse-summer", title: "Glasshouse Summer", artist: "Mira Valdane", kind: "single" },
  { id: "demo-night-bus-to-nowhere", title: "Night Bus to Nowhere", artist: "Juno Kessler", kind: "single" },
  { id: "demo-static-bloom", title: "Static Bloom", artist: "Pale Meridian", kind: "single" },
  { id: "demo-paper-lanterns", title: "Paper Lanterns", artist: "The Quiet Orchard", kind: "album" },
  { id: "demo-saltwater-hymns", title: "Saltwater Hymns", artist: "Okoro & the Tidemarks", kind: "album" },
  { id: "demo-copper-sky-sessions", title: "Copper Sky Sessions", artist: "Dax Holloway Trio", kind: "album" },
];

/** A hand-picked cover palette (dark enough for white text), standing in for the hovered cover. */
export const SAMPLE_PALETTE: AmbientPalette = {
  primary: "#6a2b5f",
  secondary: "#1f4585",
  deep: "#170f2b",
};
