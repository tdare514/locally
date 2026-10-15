/**
 * The exact strings for play counts on the Mac release page (#107), matching the iPhone
 * (`Copy.swift`, #108). One total per track; there is no per-device split, because the Mac's
 * AppleScript reports a phone's playback as its own (spike #103). Sentence case, no capitals.
 */

/** A track's total: "12 plays", "1 play". */
export function playsLabel(count: number): string {
  return count === 1 ? "1 play" : `${count} plays`;
}

/** The line under the tracks when any track has plays. */
export const PLAYS_ACROSS_DEVICES = "Plays are counted across all your devices.";
