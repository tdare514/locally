/** The quiet line under a track on the release page (#212): "In Night drive", "In Night drive and Gym",
 * "In Night drive, Gym and 3 more". Empty for no playlists. Names arrive sorted. */
export function playlistsLine(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `In ${names[0]}`;
  if (names.length === 2) return `In ${names[0]} and ${names[1]}`;
  return `In ${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** The accessible name of the popover's list. */
export function playlistsListLabel(trackTitle: string): string {
  return `Playlists with ${trackTitle.trim() || "this track"}`;
}
