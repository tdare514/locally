import type { Release, Track } from "../../shared/types";
import { LOCAL_ID_PREFIX } from "./PlayCounter";

export interface DecodedLocalId {
  artist: string;
  album: string;
  title: string;
  seconds: number;
}

export type ResolveResult =
  | { kind: "match"; releaseId: string; trackId: string }
  | { kind: "none" }
  | { kind: "ambiguous" };

/** A track that may carry its own artist (a per-track override of the release artist). */
type ResolvableTrack = Track & { artist?: string | null };

const DURATION_TOLERANCE_SEC = 2;

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment.replace(/\+/g, " "));
  } catch {
    return null;
  }
}

/** Split `spotify:local:artist:album:title:seconds` into its decoded parts, or null if malformed. */
export function decodeLocalId(id: string): DecodedLocalId | null {
  if (!id.startsWith(LOCAL_ID_PREFIX)) return null;
  const parts = id.slice(LOCAL_ID_PREFIX.length).split(":");
  if (parts.length !== 4) return null;
  const [artist, album, title, secondsRaw] = parts.map(decodeSegment);
  if (artist === null || album === null || title === null || secondsRaw === null) return null;
  const seconds = Number(secondsRaw.trim());
  if (secondsRaw.trim() === "" || !Number.isFinite(seconds)) return null;
  return { artist, album, title, seconds };
}

function norm(s: string): string {
  return s.normalize("NFC").trim();
}

/** Find the one Locally track whose tags match a Spotify local-file id. */
export function resolveLocalTrack(id: string, releases: Release[]): ResolveResult {
  const decoded = decodeLocalId(id);
  if (!decoded) return { kind: "none" };
  const artist = norm(decoded.artist);
  const album = norm(decoded.album);
  const title = norm(decoded.title);

  const matches: { releaseId: string; trackId: string }[] = [];
  for (const release of releases) {
    if (norm(release.title) !== album) continue;
    for (const track of release.tracks as ResolvableTrack[]) {
      const trackArtist = track.artist && track.artist.trim() ? track.artist : release.artist;
      if (norm(trackArtist) !== artist) continue;
      if (norm(track.title) !== title) continue;
      if (track.durationSec !== null && Math.abs(track.durationSec - decoded.seconds) > DURATION_TOLERANCE_SEC) {
        continue;
      }
      matches.push({ releaseId: release.id, trackId: track.id });
    }
  }
  if (matches.length === 1) return { kind: "match", ...matches[0] };
  return matches.length === 0 ? { kind: "none" } : { kind: "ambiguous" };
}
