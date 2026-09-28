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

/** Singles section, then Albums; empty sections are left empty for the caller to hide. */
export function partitionLibrary(releases: Release[]): LibrarySections {
  const sorted = sortByNewest(releases);
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
