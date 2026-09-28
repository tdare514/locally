/**
 * The exact strings for the guided "Make it a playlist" flow on the Mac release page
 * (issue #21, docs/plans/21-make-it-a-playlist.md). Kept framework-free, like
 * `crop-geometry.ts`, so `tests/unit/playlist-copy.test.ts` can assert them verbatim.
 * Tone: second person, present tense, no exclamation marks.
 */

/**
 * Whether the Mac Spotify client still lets Command-click multi-select local tracks and
 * "Add to playlist" them in one go (docs/research/playlists.md §5, plan "Check first" 1).
 * UNVERIFIED as of 2026-09-28: not yet checked against a real Mac Spotify client, so this
 * stays `false` and the per-track steps ship. Flip to `true` only after confirming on a Mac.
 */
export const MAC_SUPPORTS_MULTISELECT = false;

// TODO (#21 follow-up): option E (pasting `spotify:local:` URIs into a Mac playlist) is
// unverified as of 2026-09-28, see docs/research/playlists.md §5. Not implemented here.

/** Shown under the steps on every platform. */
export const PLAYLIST_FALLBACK = "If Add to playlist is missing, update Spotify and open it again.";

/** Label of the button that copies the album title, and its 2-second confirmation. */
export const COPY_LABEL = "Copy";
export const COPIED_LABEL = "Copied";

/** The Mac steps for turning the album `albumTitle` (with `trackCount` tracks) into a playlist. */
export function playlistSteps(albumTitle: string, trackCount: number, multiselect = MAC_SUPPORTS_MULTISELECT): string {
  if (multiselect) {
    return `Open Spotify, then Your Library, then Local Files. Command-click these ${trackCount} tracks. Right-click, Add to playlist, New playlist. Paste the name.`;
  }
  return `Open Spotify, then Your Library, then Local Files. On the first track, right-click, Add to playlist, New playlist, paste the name. For each other track: right-click, Add to playlist, ${albumTitle}.`;
}
