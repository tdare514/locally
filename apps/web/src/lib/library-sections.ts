/**
 * Pure helpers for the Mac library home (issue #7): split releases into
 * Singles then Albums, newest-updated first, matching iOS LibraryView and
 * docs/design.md's "Library list" component.
 */
import type { Release } from "../shared/types";

export interface LibrarySections {
  singles: Release[];
  albums: Release[];
  totalTracks: number;
}

/** Newest `updatedAt` first — same order as iOS `LibraryView.load()`. */
export function sortByNewest(releases: Release[]): Release[] {
  return [...releases].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export type LibrarySort = "newest" | "title" | "artist" | "year";

export const LIBRARY_SORT_OPTIONS: { value: LibrarySort; label: string }[] = [
  { value: "newest", label: "Recently updated" },
  { value: "title", label: "Title A–Z" },
  { value: "artist", label: "Artist A–Z" },
  { value: "year", label: "Year, newest first" },
];

/** Lowercase, strip diacritics ("Björk" -> "bjork"), collapse whitespace, trim. */
export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Case- and accent-insensitive search over title, artist, genre, year and
 * track titles. Every whitespace-separated token must appear somewhere.
 * An empty query returns the input array itself.
 */
export function filterLibrary(releases: Release[], query: string): Release[] {
  const normalized = normalizeSearchText(query);
  if (normalized === "") return releases;
  const tokens = normalized.split(" ");
  return releases.filter((r) => {
    const haystack = normalizeSearchText(
      [r.title, r.artist, r.genre ?? "", r.year ?? "", ...r.tracks.map((t) => t.title)].join(" ")
    );
    return tokens.every((token) => haystack.includes(token));
  });
}

const collator = { sensitivity: "base", numeric: true } as const;

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, collator);
}

function compareUpdatedDesc(a: Release, b: Release): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

/** Returns a sorted copy; never mutates the input. */
export function sortLibrary(releases: Release[], sort: LibrarySort): Release[] {
  const copy = [...releases];
  switch (sort) {
    case "newest":
      return sortByNewest(copy);
    case "title":
      return copy.sort(
        (a, b) =>
          compareText(a.title, b.title) ||
          compareText(a.artist, b.artist) ||
          compareUpdatedDesc(a, b)
      );
    case "artist":
      return copy.sort(
        (a, b) =>
          compareText(a.artist, b.artist) ||
          compareText(a.title, b.title) ||
          compareUpdatedDesc(a, b)
      );
    case "year":
      return copy.sort((a, b) => {
        const ay = parseYear(a.year);
        const by = parseYear(b.year);
        if (ay === null && by === null) return compareText(a.title, b.title);
        if (ay === null) return 1;
        if (by === null) return -1;
        return by - ay || compareText(a.title, b.title);
      });
  }
}

function parseYear(year: string | null): number | null {
  if (year === null) return null;
  const n = Number.parseInt(year, 10);
  return Number.isNaN(n) ? null : n;
}

/** Singles section, then Albums; empty sections are left empty for the caller to hide. */
export function partitionLibrary(
  releases: Release[],
  sort: LibrarySort = "newest"
): LibrarySections {
  const sorted = sortLibrary(releases, sort);
  return {
    singles: sorted.filter((r) => r.kind === "single"),
    albums: sorted.filter((r) => r.kind === "album"),
    totalTracks: releases.reduce((n, r) => n + r.tracks.length, 0),
  };
}

/** Album row subtitle: "artist · 4 tracks". Singles keep the artist alone. */
export function libraryRowSubtitle(release: Release): string {
  if (release.kind === "album") {
    const n = release.tracks.length;
    return `${release.artist} · ${n} track${n === 1 ? "" : "s"}`;
  }
  return release.artist;
}
