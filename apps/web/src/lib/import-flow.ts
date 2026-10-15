/** Pure logic behind the Mac Import page (#159): the cover beat's clock and state, how a Single or
 * Album switch trims the tracks, and which dropped files count as audio. No DOM, no React. */

import type { ReleaseKind } from "../shared/types";
import type { AmbientPalette } from "./artwork-palette";

/** Calm accent tones for the colour sky while there is no cover yet: the Import accent (#1E7DF0)
 * toned down the way artwork-palette.ts tones a cover (dark enough for white text), with a second
 * cloud leaning toward indigo. */
export const INVITE_PALETTE: AmbientPalette = {
  primary: "#1f5bb5",
  secondary: "#3547a3",
  deep: "#0a1a3a",
};

/** The cover beat's clock, in ms from the moment a cover is chosen. The keyframes in globals.css
 * (`.imp-cover`, `.imp-flash`, and `.record-face` / `.record-disc` under `.imp-beat`) hold the
 * same numbers; keep the two in step. */
export const BEAT = {
  /** The new cover slides in from the right. */
  slideEnd: 420,
  /** The flash swells to fully opaque warm white, holds, then fades so the colour comes back. */
  flashAt: 420,
  fullWhiteAt: 720,
  fullWhiteEnd: 820,
  flashEnd: 1300,
  /** The backdrop takes the cover's colours as the flash starts (its own 900ms fade follows). */
  washAt: 420,
  /** The disc slides all the way into the sleeve, turning as it goes: sealed at `discEnd`. */
  discAt: 1340,
  discEnd: 2290,
} as const;

/** With reduced motion there is no flash, slide or seal: the cover just fades in (160ms), the
 * colours follow at once and the beat is over as soon as that fade is. */
export const REDUCED_BEAT = { washAt: 0, endAt: 160 } as const;

export type BeatPhase = "slide" | "swell" | "white" | "fade" | "gap" | "seal" | "done";

/** Which part of the beat `ms` after the cover was chosen falls in. */
export function beatPhase(ms: number): BeatPhase {
  if (ms < BEAT.slideEnd) return "slide";
  if (ms < BEAT.fullWhiteAt) return "swell";
  if (ms < BEAT.fullWhiteEnd) return "white";
  if (ms < BEAT.flashEnd) return "fade";
  if (ms < BEAT.discAt) return "gap";
  if (ms < BEAT.discEnd) return "seal";
  return "done";
}

/** When the colour wash starts and when the beat ends, for this motion preference. */
export function beatTimes(reducedMotion: boolean): { washAt: number; endAt: number } {
  return reducedMotion ? REDUCED_BEAT : { washAt: BEAT.washAt, endAt: BEAT.discEnd };
}

export interface BeatState {
  /** A cover is set. */
  hasCover: boolean;
  /** Counts covers chosen; a new value restarts the beat's animations. */
  run: number;
  /** The beat is over: it ran out, or input jumped it to the end. */
  ended: boolean;
  /** Input jumped it to the end (so the disc lands in the sleeve at once, with no glide). */
  skipped: boolean;
  /** This cover replaced another, so the disc starts tucked in the sleeve, not peeking out. */
  replay: boolean;
}

export const INITIAL_BEAT: BeatState = {
  hasCover: false,
  run: 0,
  ended: false,
  skipped: false,
  replay: false,
};

export type BeatEvent =
  /** A cover was set: the first, or one replacing another. Either way the beat plays. */
  | { type: "cover" }
  /** A click or key press: jump to the end. */
  | { type: "skip" }
  /** The beat ran its course. */
  | { type: "end" }
  /** The import is cleared. */
  | { type: "reset" };

/** The beat is running: a cover is set and it has not ended. */
export function isPlaying(state: BeatState): boolean {
  return state.hasCover && !state.ended;
}

export function beatReducer(state: BeatState, event: BeatEvent): BeatState {
  switch (event.type) {
    case "cover":
      return {
        hasCover: true,
        run: state.run + 1,
        ended: false,
        skipped: false,
        replay: state.hasCover,
      };
    case "skip":
      return isPlaying(state) ? { ...state, ended: true, skipped: true } : state;
    case "end":
      return isPlaying(state) ? { ...state, ended: true } : state;
    case "reset":
      return { ...INITIAL_BEAT, run: state.run };
  }
}

/** Changes whenever the disc has to be remounted: a new cover restarts its animation, and a skip
 * lands it in the sleeve at once instead of letting it glide there. */
export function discKeyFor(state: BeatState): string {
  return `${state.run}${state.skipped ? "s" : ""}`;
}

/** What switching to `kind` leaves of the tracks: a Single is one file, so only the first stays.
 * Returns the same array when nothing is trimmed. */
export function trimForKind<T>(entries: T[], kind: ReleaseKind): T[] {
  return kind === "single" && entries.length > 1 ? entries.slice(0, 1) : entries;
}

export interface AddPlan<T> {
  /** The files that become tracks. */
  files: T[];
  /** The row of the first new track. */
  startIndex: number;
  /** The new tracks take the place of the existing ones (a Single is one file). */
  replace: boolean;
}

/** How a batch of incoming files joins the tracks: a Single keeps the first file and replaces
 * whatever is there, an Album appends them all. `incoming` is non-empty. */
export function planAdd<T>(kind: ReleaseKind, existingCount: number, incoming: T[]): AddPlan<T> {
  return kind === "single"
    ? { files: incoming.slice(0, 1), startIndex: 0, replace: true }
    : { files: incoming, startIndex: existingCount, replace: false };
}

const AUDIO_EXTENSION = /\.(mp3|wav|flac|m4a|aac|ogg|aiff|aif)$/i;

/** Whether a dropped file is audio the import accepts (the same set as the file input), so an
 * image dropped on the sleeve never becomes a track. */
export function isAudioFile(file: { name: string; type: string }): boolean {
  return file.type.startsWith("audio/") || AUDIO_EXTENSION.test(file.name);
}
