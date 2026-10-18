/**
 * The artist catalogue (issue #288, step 3 of docs/plans/224-artist-list.md): one entry per artist
 * key, with the releases they own, the tracks they appear on, and the numbers the Artists view and
 * the artist page show. Pure; built on the #286 rules in artist-names.ts and the spelling rule of
 * the #287 artist index (the most-used spelling, A to Z on a tie).
 */
import type { Release, Track } from "../shared/types";
import { before } from "./artist-index";
import { artistKey, splitArtistFeaturing, splitFeaturing } from "./artist-names";
import { normalizeSearchText } from "./library-sections";

/** A track that features an artist on a release that belongs to someone else. */
export interface AppearsOn {
  release: Release;
  track: Track;
}

/** Enough to draw a cover (`coverUrl(releaseId, updatedAt)`). */
export interface CoverRef {
  releaseId: string;
  updatedAt: string;
}

export interface CatalogEntry {
  key: string;
  /** The spelling shown: the one used on the most tracks, A to Z on a tie. */
  name: string;
  albums: Release[];
  singles: Release[];
  appearsOn: AppearsOn[];
  /** Tracks on this artist's own releases. */
  trackCount: number;
  /** Albums plus singles. */
  releaseCount: number;
  /** Up to three covers, newest first: their own releases', else from appearsOn. */
  covers: CoverRef[];
  /** The newest own release, else the newest appearsOn release: it gives the page its wash. */
  newest: Release | null;
}

/** All-time plays by track id. */
export type PlayCounts = ReadonlyMap<string, number>;

export interface MostPlayed {
  release: Release;
  track: Track;
  plays: number;
}

/** How many tracks the artist page ranks under Most played. */
export const MOST_PLAYED_LIMIT = 5;

function parseYear(year: string | null): number | null {
  if (year === null) return null;
  const n = Number.parseInt(year, 10);
  return Number.isNaN(n) ? null : n;
}

/** Year descending (a missing year last), then the date added descending. */
export function compareNewestFirst(a: Release, b: Release): number {
  const ay = parseYear(a.year);
  const by = parseYear(b.year);
  if (ay !== by) {
    if (ay === null) return 1;
    if (by === null) return -1;
    return by - ay;
  }
  return b.createdAt.localeCompare(a.createdAt);
}

/** The names a track features: its title's "(feat. ...)" and the release artist's "A feat. B", once each. */
function featuredNames(release: Release, track: Track): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const name of [...splitFeaturing(track.title).featuring, ...splitArtistFeaturing(release.artist).featuring]) {
    const key = artistKey(name);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

interface Group {
  spellings: Map<string, number>;
  albums: Release[];
  singles: Release[];
  appearsOn: AppearsOn[];
  trackCount: number;
}

/** "The Weeknd" files under W. */
function sortKey(entry: CatalogEntry): string {
  return entry.key.startsWith("the ") ? entry.key.slice(4) : entry.key;
}

function sortAtoZ(entries: CatalogEntry[]): CatalogEntry[] {
  return entries.sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    if (ka !== kb) return before(ka, kb) ? -1 : 1;
    return before(a.name, b.name) ? -1 : before(b.name, a.name) ? 1 : 0;
  });
}

/** One entry per artist, A to Z. Featured-only artists are entries too. */
export function buildArtistCatalog(releases: Release[]): CatalogEntry[] {
  const groups = new Map<string, Group>();
  const group = (key: string): Group => {
    let found = groups.get(key);
    if (!found) {
      found = { spellings: new Map(), albums: [], singles: [], appearsOn: [], trackCount: 0 };
      groups.set(key, found);
    }
    return found;
  };
  const spell = (g: Group, name: string, tracks: number) => {
    // NFC first, so "e" + U+0301 and U+00E9 are one spelling.
    const display = name.trim().normalize("NFC");
    g.spellings.set(display, (g.spellings.get(display) ?? 0) + tracks);
  };

  for (const release of releases) {
    const main = splitArtistFeaturing(release.artist).artist;
    const mainKey = artistKey(main);
    if (mainKey !== "") {
      const own = group(mainKey);
      (release.kind === "album" ? own.albums : own.singles).push(release);
      own.trackCount += release.tracks.length;
      spell(own, main, release.tracks.length);
    }
    for (const track of release.tracks) {
      for (const name of featuredNames(release, track)) {
        const key = artistKey(name);
        if (key === mainKey) continue;
        const featured = group(key);
        spell(featured, name, 1);
        featured.appearsOn.push({ release, track });
      }
    }
  }

  const entries: CatalogEntry[] = [];
  for (const [key, g] of groups) {
    let name = "";
    let best = -1;
    for (const [spelling, count] of g.spellings) {
      if (count > best || (count === best && before(spelling, name))) {
        name = spelling;
        best = count;
      }
    }
    const albums = [...g.albums].sort(compareNewestFirst);
    const singles = [...g.singles].sort(compareNewestFirst);
    const appearsOn = [...g.appearsOn].sort(
      (a, b) => compareNewestFirst(a.release, b.release) || a.track.trackNumber - b.track.trackNumber,
    );
    const own = [...albums, ...singles].sort(compareNewestFirst);
    const coverSource = own.length > 0 ? own : appearsOn.map((a) => a.release);
    const covers: CoverRef[] = [];
    for (const r of coverSource) {
      if (!r.coverPath || covers.some((c) => c.releaseId === r.id)) continue;
      covers.push({ releaseId: r.id, updatedAt: r.updatedAt });
      if (covers.length === 3) break;
    }
    entries.push({
      key,
      name,
      albums,
      singles,
      appearsOn,
      trackCount: g.trackCount,
      releaseCount: albums.length + singles.length,
      covers,
      newest: own[0] ?? appearsOn[0]?.release ?? null,
    });
  }
  return sortAtoZ(entries);
}

/** The first letter of the sort key, A to Z; everything else is "#". */
export function letterOf(entry: CatalogEntry): string {
  const first = sortKey(entry).charAt(0).toUpperCase();
  return first >= "A" && first <= "Z" ? first : "#";
}

/** The entries (already A to Z) under their letters, "#" last. */
export function groupByLetter(entries: CatalogEntry[]): { letter: string; entries: CatalogEntry[] }[] {
  const groups = new Map<string, CatalogEntry[]>();
  for (const entry of entries) {
    const letter = letterOf(entry);
    const list = groups.get(letter);
    if (list) list.push(entry);
    else groups.set(letter, [entry]);
  }
  const letters = [...groups.keys()].sort((a, b) => (a === "#" ? 1 : b === "#" ? -1 : a < b ? -1 : 1));
  return letters.map((letter) => ({ letter, entries: groups.get(letter) ?? [] }));
}

/** The entry for a key, or null when the library has none (deleted since, a stale back entry). */
export function catalogEntry(catalog: CatalogEntry[], key: string): CatalogEntry | null {
  return catalog.find((entry) => entry.key === key) ?? null;
}

/** The top five tracks by all-time plays across the artist's albums, singles and appearances. */
export function mostPlayed(entry: CatalogEntry, plays: PlayCounts): MostPlayed[] {
  const rows: MostPlayed[] = [];
  for (const release of [...entry.albums, ...entry.singles]) {
    for (const track of release.tracks) rows.push({ release, track, plays: plays.get(track.id) ?? 0 });
  }
  for (const { release, track } of entry.appearsOn) rows.push({ release, track, plays: plays.get(track.id) ?? 0 });
  return rows
    .filter((row) => row.plays > 0)
    .sort(
      (a, b) =>
        b.plays - a.plays ||
        a.track.title.localeCompare(b.track.title, undefined, { sensitivity: "base", numeric: true }) ||
        a.track.id.localeCompare(b.track.id),
    )
    .slice(0, MOST_PLAYED_LIMIT);
}

/** The library search's folding (case, accents, every word must match) over the artist's name. */
export function filterArtists(entries: CatalogEntry[], query: string): CatalogEntry[] {
  const normalized = normalizeSearchText(query);
  if (normalized === "") return entries;
  const tokens = normalized.split(" ");
  return entries.filter((entry) => {
    const name = normalizeSearchText(entry.name);
    return tokens.every((token) => name.includes(token));
  });
}

export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** "1 release, 4 tracks", or "Appears on 3 tracks" for an artist with no releases of their own. */
export function artistCountLine(entry: CatalogEntry): string {
  if (entry.releaseCount === 0) return `Appears on ${plural(entry.appearsOn.length, "track")}`;
  return `${plural(entry.releaseCount, "release")}, ${plural(entry.trackCount, "track")}`;
}

/** The page header's line: "1 album, 2 singles, appears on 3 tracks" from the non-zero parts. */
export function artistPageLine(entry: CatalogEntry): string {
  const parts: string[] = [];
  if (entry.albums.length > 0) parts.push(plural(entry.albums.length, "album"));
  if (entry.singles.length > 0) parts.push(plural(entry.singles.length, "single"));
  if (entry.appearsOn.length > 0) parts.push(`appears on ${plural(entry.appearsOn.length, "track")}`);
  const line = parts.join(", ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}
