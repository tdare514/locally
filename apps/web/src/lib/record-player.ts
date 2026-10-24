/*
 * The Collections record player (#351, plan `docs/plans/339-collections.md` "The look"), pure parts: the wheel's
 * geometry and culling, the type-ahead, the captions, and the two per-device choices (Record player / List and
 * Picture disc / Black vinyl). No DOM here except the guarded localStorage reads.
 */

/** The wheel's dial on the Mac: 64 px sleeves, 90 px between level rows at the front, each step 0.87 of the last. */
export const WHEEL = { base: 64, row: 90, ratio: 0.87, radius: 196, cx: -18 } as const;
export type WheelGeometry = { base: number; row: number; ratio: number; radius: number; cx: number };

/** Rows farther than this many steps from the front are skipped before any maths (the fade has ended well before). */
export const MAX_STEPS = 6;
/** Past this angle (rad, about 49 degrees) a row starts to fade; it is gone 0.5 rad later. */
export const FADE_START = 0.85;
export const FADE_SPAN = 0.5;
/** A row this far round the dial (rad) is not drawn at all. */
export const MAX_ANGLE = 1.4;

export const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Signed shortest distance in steps from the wheel position `pos` to row `i` of `n` (the wheel is endless). */
export function wrapD(i: number, pos: number, n: number): number {
  let d = mod(i - pos, n);
  if (d > n / 2) d -= n;
  return d;
}

/** Arc length along the dial from the front row to a row `x` steps away: each step is shorter by the ratio. */
export function arcLen(x: number, g: WheelGeometry = WHEEL): number {
  const h = (k: number) => g.row * Math.pow(g.ratio, k);
  let s = 0;
  let k = 0;
  while (k + 1 <= x) {
    s += (h(k) + h(k + 1)) / 2;
    k++;
  }
  return s + ((x - k) * (h(k) + h(k + 1))) / 2;
}

/** Opacity at an angle round the dial: full until about 49 degrees, then a fade to nothing. */
export function fadeOpacity(angle: number): number {
  const a = Math.abs(angle);
  return a < FADE_START ? 1 : Math.max(0, 1 - (a - FADE_START) / FADE_SPAN);
}

export interface RowPose {
  /** Centre of the sleeve, relative to the dial's centre height (y) and left edge (x). */
  x: number;
  y: number;
  scale: number;
  opacity: number;
  /** Nearer the front is higher. */
  z: number;
  angle: number;
}

/**
 * Where a row `d` steps from the front sits, or null when it is not drawn. The first test is on `d` alone, so a
 * row far from the front costs one comparison (200 collections cost the same as 20).
 */
export function rowPose(d: number, g: WheelGeometry = WHEEL): RowPose | null {
  const x = Math.abs(d);
  if (x > MAX_STEPS) return null;
  const angle = (Math.sign(d) * arcLen(x, g)) / g.radius;
  if (Math.abs(angle) > MAX_ANGLE) return null;
  const opacity = fadeOpacity(angle);
  if (opacity <= 0) return null;
  return {
    x: g.cx + g.radius * Math.cos(angle),
    y: g.radius * Math.sin(angle),
    scale: Math.pow(g.ratio, x),
    opacity,
    z: 100 - Math.round(x * 10),
    angle,
  };
}

/** The row indexes that can be on the dial when the wheel is at `pos`: at most 2 * (MAX_STEPS + 1) + 1, whatever `n` is. */
export function windowIndexes(pos: number, n: number, steps: number = MAX_STEPS + 1): number[] {
  if (n <= 0) return [];
  const centre = Math.round(pos);
  const out: number[] = [];
  const seen = new Set<number>();
  for (let k = -steps; k <= steps; k++) {
    const i = mod(centre + k, n);
    if (seen.has(i)) continue;
    seen.add(i);
    out.push(i);
  }
  return out;
}

/** The index in front when the wheel is at `pos`. */
export const frontIndex = (pos: number, n: number): number => (n > 0 ? mod(Math.round(pos), n) : 0);

/** The target (an integer in the wheel's own, unwrapped count) that brings row `i` to the front by the shortest way. */
export function turnTarget(i: number, from: number, n: number): number {
  const at = Math.round(from);
  return at + wrapD(i, at, n);
}

/** The first row whose name starts with what was typed, searching from the front: past it for one letter, from it once more are typed. Null when none. */
export function findByPrefix(names: readonly string[], typed: string, front: number): number | null {
  const n = names.length;
  if (n === 0 || typed === "") return null;
  for (let k = 1; k <= n; k++) {
    const i = mod(front + (typed.length > 1 ? k - 1 : k), n);
    if (names[i].startsWith(typed)) return i;
  }
  return null;
}

/** How long a typed letter stays part of the word being typed. */
export const TYPE_AHEAD_MS = 700;

/** The buffer after a key at time `now`: it restarts once the pause was longer than the window. */
export function nextTyped(typed: string, typedAt: number, key: string, now: number): string {
  return (now - typedAt > TYPE_AHEAD_MS ? "" : typed) + key;
}

/** "1 hr 56 min", "24 min", "2 hr" (whole minutes, rounded); empty when there is no length. */
export function durationLabel(totalSec: number): string {
  if (!(totalSec > 0)) return "";
  const minutes = Math.max(1, Math.round(totalSec / 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/** The caption under a row's name: "27 tracks, 1 hr 56 min" ("0 tracks" for an empty collection). */
export function rowCaption(tracks: number, totalSec: number): string {
  const count = `${tracks} ${tracks === 1 ? "track" : "tracks"}`;
  const length = durationLabel(totalSec);
  return length ? `${count}, ${length}` : count;
}

/** The hub's count: "5 of 24" (front index is 0-based). */
export function hubCount(front: number, n: number): string {
  return `${front + 1} of ${n}`;
}

/** The accessible name of a row. `state` comes from the same player state as the visible tag. */
export function rowLabel(name: string, tracks: number, state: "playing" | "paused" | null): string {
  return `${name}, ${tracks} ${tracks === 1 ? "track" : "tracks"}${state ? `, ${state}` : ""}`;
}

/** A turn of the wheel by an amount of scroll: one row per this many pixels (lines count 3 to a row). */
export function scrollToSteps(deltaX: number, deltaY: number, deltaMode: number): number {
  const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  return delta / (deltaMode === 1 ? 3 : 110);
}

/** Frame-rate independent easing of the wheel toward its target: about 96 ms to cover 63 % of the way. */
export const WHEEL_TAU_MS = 96;
export function easeToward(pos: number, target: number, dtMs: number): number {
  const next = pos + (target - pos) * (1 - Math.exp(-Math.max(0, dtMs) / WHEEL_TAU_MS));
  return Math.abs(target - next) < 0.002 ? target : next;
}

/** One turn of the record every 1.8 s: 33 1/3 rpm. */
export const REVOLUTION_MS = 1800;

// ---- the two per-device choices -------------------------------------------------------------

export type CollectionsViewMode = "player" | "list";
export type SpinningRecord = "picture" | "vinyl";

export const VIEW_KEY = "locally.collections.view";
export const RECORD_KEY = "locally.collections.record";

export const parseViewMode = (raw: string | null): CollectionsViewMode => (raw === "list" ? "list" : "player");
export const parseSpinningRecord = (raw: string | null): SpinningRecord => (raw === "vinyl" ? "vinyl" : "picture");

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered; the choice still applies for this session.
  }
}

export const loadViewMode = (): CollectionsViewMode => parseViewMode(read(VIEW_KEY));
export const saveViewMode = (mode: CollectionsViewMode): void => write(VIEW_KEY, mode);
export const loadSpinningRecord = (): SpinningRecord => parseSpinningRecord(read(RECORD_KEY));
export const saveSpinningRecord = (record: SpinningRecord): void => write(RECORD_KEY, record);
