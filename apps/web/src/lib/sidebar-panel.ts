/** The sidebar's panel rules (#154) as plain functions, so the click and widget logic is tested
 * without a DOM. The hook in components/sidebar/use-floating-panel.ts owns the timers and the
 * events; it asks these what a click means. */

import type { StatKind } from "./play-stats";

/** Which way the pane slides after the panel docks or undocks. */
export type PinShift = "in" | "out";

export interface PanelState {
  /** Showing because of a hover, a focus or the menu button. */
  open: boolean;
  /** Docked as a column beside the rail. */
  pinned: boolean;
}

export interface PanelChange extends PanelState {
  /** The slide to play; null leaves the last one as it was. */
  shift: PinShift | null;
  /** Move keyboard focus into the panel once it is showing. */
  focusPanel: boolean;
}

/** "Pin open" on or off. Either way the panel stays showing; unpinned, it floats again. */
export function pinChange(next: boolean): PanelChange {
  return { open: true, pinned: next, shift: next ? "in" : "out", focusPanel: false };
}

/**
 * What a click on the menu button does.
 * - Pinned: unpin and close.
 * - From the keyboard (Enter or Space): open and move focus into the panel.
 * - With the mouse: a closed panel opens; an open one is pinned when Open on hover is on (it was
 *   opened by the hover), and closed when it is off (the button opened it).
 */
export function menuButtonClick(
  state: PanelState,
  how: { keyboard: boolean; hoverReveal: boolean },
): PanelChange {
  if (state.pinned) return { open: false, pinned: false, shift: "out", focusPanel: false };
  if (how.keyboard) return { open: true, pinned: false, shift: null, focusPanel: true };
  if (!state.open) return { open: true, pinned: false, shift: null, focusPanel: false };
  if (how.hoverReveal) return pinChange(true);
  return { open: false, pinned: false, shift: null, focusPanel: false };
}

/** What "Edit widgets" can switch on and off: the stats shelf, or one of the lists. */
export type WidgetKey = "shelf" | StatKind;
export type WidgetState = Record<WidgetKey, boolean>;

export const WIDGETS: { key: WidgetKey; title: string }[] = [
  { key: "shelf", title: "Stats shelf" },
  { key: "tracks", title: "Top tracks" },
  { key: "albums", title: "Top albums" },
  { key: "artists", title: "Top artists" },
];

/** The shelf starts off; the three lists start on. */
export const DEFAULT_WIDGETS: WidgetState = {
  shelf: false,
  tracks: true,
  albums: true,
  artists: true,
};

export function widgetsOnCount(widgets: WidgetState): number {
  return WIDGETS.filter((w) => widgets[w.key]).length;
}

/** Flips one widget. The last one on cannot be switched off, so at least one always shows. */
export function toggleWidget(widgets: WidgetState, key: WidgetKey): WidgetState {
  if (widgets[key] && widgetsOnCount(widgets) === 1) return widgets;
  return { ...widgets, [key]: !widgets[key] };
}
