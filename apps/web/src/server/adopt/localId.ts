import { LOCAL_ID_PREFIX } from "../plays/PlayCounter";

/** Spotify's segment encoding: percent-encoding, with `+` for a space. */
function encodeSegment(s: string): string {
  return encodeURIComponent(s).replace(/%20/g, "+");
}

/** Build `spotify:local:artist:album:title:seconds`; decodes back through `decodeLocalId`. */
export function buildLocalId(artist: string, album: string, title: string, durationSec: number): string {
  const seconds = Math.max(0, Math.round(durationSec));
  return `${LOCAL_ID_PREFIX}${encodeSegment(artist)}:${encodeSegment(album)}:${encodeSegment(title)}:${seconds}`;
}
