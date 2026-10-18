/**
 * Artist suggestions (issue #287): an index of every artist name the library
 * holds, the suggestions while typing and the "Did you mean" check. Pure, and
 * ported to iOS as `ArtistIndex`; spec/fixtures/artists/index.json runs
 * against both. Built on the #286 rules in artist-names.ts.
 */
import { artistKey, looksLike, splitFeaturing } from "./artist-names";

export interface ArtistEntry {
  /** The spelling shown: the one used on the most tracks, A to Z on a tie. */
  display: string;
  key: string;
  trackCount: number;
  releaseCount: number;
}

export type DidYouMean =
  | { kind: "spelling"; artist: string; trackCount: number }
  | { kind: "looksLike"; artist: string; trackCount: number };

/** The least of what the index reads off a release; adopted releases count too. */
export interface IndexedRelease {
  artist: string;
  tracks: { title: string }[];
}

/** Plain code point order on NFC strings, the same as Swift's scalar order (not UTF-16 unit order). */
export function before(a: string, b: string): boolean {
  const left = Array.from(a, (c) => c.codePointAt(0) as number);
  const right = Array.from(b, (c) => c.codePointAt(0) as number);
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i++) {
    if (left[i] !== right[i]) return left[i] < right[i];
  }
  return left.length < right.length;
}

/** Most tracks first, then A to Z. */
function ranksBefore(a: ArtistEntry, b: ArtistEntry): boolean {
  if (a.trackCount !== b.trackCount) return a.trackCount > b.trackCount;
  return before(a.display, b.display);
}

export function buildArtistIndex(releases: IndexedRelease[]): ArtistEntry[] {
  const groups = new Map<string, { spellings: Map<string, number>; trackCount: number; releaseCount: number }>();
  const group = (key: string) => {
    let found = groups.get(key);
    if (!found) {
      found = { spellings: new Map(), trackCount: 0, releaseCount: 0 };
      groups.set(key, found);
    }
    return found;
  };
  const add = (name: string, tracks: number, releases: number) => {
    // NFC first, so "e" + U+0301 and U+00E9 are one spelling, as they are to Swift.
    const display = name.trim().normalize("NFC");
    const key = artistKey(display);
    if (key === "") return;
    const g = group(key);
    g.spellings.set(display, (g.spellings.get(display) ?? 0) + tracks);
    g.trackCount += tracks;
    g.releaseCount += releases;
  };
  for (const release of releases) {
    add(release.artist, release.tracks.length, 1);
    for (const track of release.tracks) {
      for (const name of splitFeaturing(track.title).featuring) add(name, 1, 0);
    }
  }
  const entries: ArtistEntry[] = [];
  for (const [key, g] of groups) {
    let display = "";
    let best = -1;
    for (const [spelling, count] of g.spellings) {
      if (count > best || (count === best && before(spelling, display))) {
        display = spelling;
        best = count;
      }
    }
    entries.push({ display, key, trackCount: g.trackCount, releaseCount: g.releaseCount });
  }
  return entries.sort((a, b) => (ranksBefore(a, b) ? -1 : ranksBefore(b, a) ? 1 : 0));
}

/** The query's key starts the artist's key or any word of it: "wee" finds "the weeknd". */
function matchOffset(key: string, query: string): number | null {
  let from = 0;
  while (from <= key.length - query.length) {
    if (key.startsWith(query, from)) return from;
    const space = key.indexOf(" ", from);
    if (space === -1) return null;
    from = space + 1;
  }
  return null;
}

export function suggestArtists(index: ArtistEntry[], query: string, limit: number): ArtistEntry[] {
  const queryKey = artistKey(query);
  if (queryKey === "" || limit <= 0) return [];
  const starts: ArtistEntry[] = [];
  const inside: ArtistEntry[] = [];
  for (const entry of index) {
    if (entry.display === query.normalize("NFC")) continue;
    const offset = matchOffset(entry.key, queryKey);
    if (offset === null) continue;
    (offset === 0 ? starts : inside).push(entry);
  }
  const sort = (list: ArtistEntry[]) =>
    list.sort((a, b) => (ranksBefore(a, b) ? -1 : ranksBefore(b, a) ? 1 : 0));
  return [...sort(starts), ...sort(inside)].slice(0, limit);
}

export function didYouMean(index: ArtistEntry[], typed: string): DidYouMean | null {
  const key = artistKey(typed);
  if (key === "") return null;
  const same = index.find((entry) => entry.key === key);
  if (same) {
    if (same.display === typed.trim().normalize("NFC")) return null;
    return { kind: "spelling", artist: same.display, trackCount: same.trackCount };
  }
  let best: ArtistEntry | null = null;
  for (const entry of index) {
    if (!looksLike(typed, entry.display)) continue;
    if (!best || ranksBefore(entry, best)) best = entry;
  }
  return best ? { kind: "looksLike", artist: best.display, trackCount: best.trackCount } : null;
}

/** "12 tracks", "1 track". */
export function trackCountLabel(count: number): string {
  return `${count} ${count === 1 ? "track" : "tracks"}`;
}

/** The one line under the Artist field, without the button. */
export function didYouMeanLine(hint: DidYouMean): string {
  return hint.kind === "looksLike"
    ? `You have ${trackCountLabel(hint.trackCount)} by ${hint.artist}.`
    : `Matches ${hint.artist}. Use that spelling?`;
}

export function didYouMeanButton(hint: DidYouMean): string {
  return `Use ${hint.artist}`;
}

/**
 * Where the typed letters sit in a suggestion, for the bolder half of the row:
 * the first word start whose same-length slice has the query's key. Null when
 * none does (then the row shows the whole name plain).
 */
export function matchRange(display: string, query: string): { start: number; end: number } | null {
  const wanted = artistKey(query);
  if (wanted === "") return null;
  const typed = query.trim().length;
  const lengths = [typed, typed - 1, typed + 1, typed + 2].filter((n) => n > 0);
  for (let start = 0; start < display.length; start++) {
    if (start > 0 && /[\p{L}\p{N}]/u.test(display.charAt(start - 1))) continue;
    for (const length of lengths) {
      if (artistKey(display.slice(start, start + length)) === wanted) return { start, end: start + length };
    }
  }
  return null;
}
