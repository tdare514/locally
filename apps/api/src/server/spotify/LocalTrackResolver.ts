import type { ReleaseRecord } from "../../shared/types";

export const LOCAL_ID_PREFIX = "spotify:local:";

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

/** The part of a live release record the resolver reads. */
export type ResolvableRelease = Pick<ReleaseRecord, "id" | "title" | "artist" | "tracks">;

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
  const [artist, album, title, secondsRaw] = parts.map(decodeSegment) as [string | null, string | null, string | null, string | null];
  if (artist === null || album === null || title === null || secondsRaw === null) return null;
  const seconds = Number(secondsRaw.trim());
  if (secondsRaw.trim() === "" || !Number.isFinite(seconds)) return null;
  return { artist, album, title, seconds };
}

function norm(s: string): string {
  return s.normalize("NFC").trim();
}

function nfc(s: string): string {
  return s.normalize("NFC");
}

/**
 * A port of the Mac's `LocalTrackResolver` (apps/web/src/server/plays), working on a user's live release
 * records. A track the Mac adopted carries the `spotify:local:` id Spotify builds from its tags (`localId`);
 * both ids are decoded and compared part by part (NFC artist, album, title, case-sensitive; seconds within
 * the tolerance), because Spotify's escaping may differ from `encodeURIComponent`. When two adopted copies
 * match, the first in library order wins, so a play counts once.
 */
function resolveAdopted(decoded: DecodedLocalId, releases: ResolvableRelease[]): ResolveResult | null {
  const artist = nfc(decoded.artist);
  const album = nfc(decoded.album);
  const title = nfc(decoded.title);
  for (const release of releases) {
    for (const track of release.tracks) {
      if (!track.localId) continue;
      const own = decodeLocalId(track.localId);
      if (!own) continue;
      if (nfc(own.artist) !== artist || nfc(own.album) !== album || nfc(own.title) !== title) continue;
      if (Math.abs(own.seconds - decoded.seconds) > DURATION_TOLERANCE_SEC) continue;
      return { kind: "match", releaseId: release.id, trackId: track.id };
    }
  }
  return null;
}

/** Find the one Locally track whose tags match a Spotify local-file id. None, or more than one, is no match. */
export function resolveLocalTrack(id: string, releases: ResolvableRelease[]): ResolveResult {
  const decoded = decodeLocalId(id);
  if (!decoded) return { kind: "none" };
  const adopted = resolveAdopted(decoded, releases);
  if (adopted) return adopted;
  const artist = norm(decoded.artist);
  const album = norm(decoded.album);
  const title = norm(decoded.title);

  const matches: { releaseId: string; trackId: string }[] = [];
  for (const release of releases) {
    if (norm(release.title) !== album) continue;
    if (norm(release.artist) !== artist) continue;
    for (const track of release.tracks) {
      if (norm(track.title) !== title) continue;
      if (track.durationSec !== null && Math.abs(track.durationSec - decoded.seconds) > DURATION_TOLERANCE_SEC) {
        continue;
      }
      matches.push({ releaseId: release.id, trackId: track.id });
    }
  }
  if (matches.length === 1) return { kind: "match", ...matches[0]! };
  return matches.length === 0 ? { kind: "none" } : { kind: "ambiguous" };
}
