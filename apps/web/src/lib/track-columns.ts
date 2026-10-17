import { UNKNOWN_ARTIST } from "../shared/adopt";

/** Track table widths (#294): In playlists drops under 760 px of table width, Plays under 560. */
export const PLAYLISTS_MIN_TABLE = 760;
export const PLAYS_MIN_TABLE = 560;

export interface TrackColumns {
  plays: boolean;
  playlists: boolean;
}

/** Which optional columns fit a table `tableWidth` px wide. Unmeasured (null) shows both. */
export function trackColumns(tableWidth: number | null): TrackColumns {
  if (tableWidth === null) return { plays: true, playlists: true };
  return { plays: tableWidth >= PLAYS_MIN_TABLE, playlists: tableWidth >= PLAYLISTS_MIN_TABLE };
}

/** The artist under a track's title: the track's own, else the release's, else "Unknown artist". */
export function trackArtist(trackArtistName: string | null | undefined, releaseArtist: string | null | undefined): string {
  const own = trackArtistName?.trim();
  if (own) return own;
  const release = releaseArtist?.trim();
  return release || UNKNOWN_ARTIST;
}

/** The grid template for the track table's header and rows. `actions` is the width in px of the
 * grip and remove buttons at the end (0 when there are none). */
export function trackGridTemplate(columns: TrackColumns, actions: number): string {
  const parts = ["2rem", "minmax(0,1fr)"];
  if (columns.plays) parts.push("4.5rem");
  if (columns.playlists) parts.push("minmax(0,15rem)");
  parts.push("5.5rem");
  if (actions > 0) parts.push(`${actions}px`);
  return parts.join(" ");
}
