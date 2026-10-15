/** The sidebar's panel rules (#154) as plain functions, so how the panel opens, stays and closes is
 * tested without a DOM. The hook in components/sidebar/use-floating-panel.ts owns the timer and the
 * DOM events and feeds them in here as events; this decides what each one does. */

import type { StatKind } from "./play-stats";

/** Which way the pane slides after the panel docks or undocks. */
export type PinShift = "in" | "out";

/**
 * How an unpinned panel came to be showing. A "hover" panel (the pointer on the rail, or keyboard
 * focus on it) hides again once the pointer leaves; a "click" panel (the menu button) stays until
 * it is closed on purpose.
 */
export type OpenedBy = "hover" | "click";

export interface PanelModel {
  /** Why the unpinned panel is showing; null when it is closed. Not used while pinned. */
  openedBy: OpenedBy | null;
  /** Docked as a column beside the rail. */
  pinned: boolean;
  /** "Open on hover" is on. */
  hoverReveal: boolean;
  /** The mouse is over the rail or the panel. */
  inside: boolean;
  /** A page was chosen with the mouse over the rail or panel: hovering cannot open the panel again
   * until the pointer has left that area and come back. */
  suppressed: boolean;
  /** The slide to play after the last pin change; null until there is one. */
  shift: PinShift | null;
  /** Goes up each time a keyboard open should move focus into the panel. */
  focusTick: number;
}

export const INITIAL_PANEL: PanelModel = {
  openedBy: null,
  pinned: false,
  hoverReveal: true,
  inside: false,
  suppressed: false,
  shift: null,
  focusTick: 0,
};

export type PanelEvent =
  /** The saved prefs, once they are read after mount. */
  | { type: "prefs"; pinned: boolean; hoverReveal: boolean }
  /** The mouse entered or left the rail-and-panel area. */
  | { type: "pointer-enter" }
  | { type: "pointer-leave" }
  /** The mouse entered the rail. */
  | { type: "hover-rail" }
  /** Keyboard focus landed on the rail. */
  | { type: "focus-rail" }
  /** The grace period after the pointer or focus left. */
  | { type: "grace-elapsed"; keyboardInside: boolean }
  /** A click on the menu button; `keyboard` when it came from Enter or Space. */
  | { type: "menu-click"; keyboard: boolean }
  | { type: "escape" }
  /** A page was chosen, on the rail or in the panel. */
  | { type: "page-chosen" }
  /** "Pin down" switched on or off. */
  | { type: "pin"; pinned: boolean }
  /** "Open on hover" switched on or off. */
  | { type: "hover-reveal"; on: boolean };

/** Whether the panel is on screen, floating or docked. */
export function isShown(m: PanelModel): boolean {
  return m.pinned || m.openedBy !== null;
}

/** Whether the panel is held open: docked, or opened by the menu button. A click on the menu button
 * closes it then; otherwise a click holds it open. */
export function isHeldOpen(m: PanelModel): boolean {
  return m.pinned || m.openedBy === "click";
}

/** The pointer or keyboard focus reached the rail: a closed panel shows, if hovering is on. */
function reveal(m: PanelModel): PanelModel {
  if (!m.hoverReveal || m.pinned || m.openedBy !== null) return m;
  return { ...m, openedBy: "hover" };
}

/**
 * What an event does to the panel.
 * - Hover (Open on hover on): the pointer on the rail shows the panel; it hides after the grace
 *   period once the pointer and keyboard focus have both left. With Open on hover off, hovering
 *   never shows it.
 * - The menu button: opens a closed panel, holds a hover-opened one open, closes a held one. A
 *   held panel ignores the pointer leaving. Pinned, it unpins and closes.
 * - Escape closes an unpinned panel.
 * - Choosing a page closes an unpinned panel at once and, with the pointer still over the rail or
 *   the panel, keeps hovering from opening it again until the pointer has left and returned. A
 *   pinned panel stays docked: the page is beside it.
 */
export function panelReduce(m: PanelModel, event: PanelEvent): PanelModel {
  switch (event.type) {
    case "prefs":
      return { ...m, pinned: event.pinned, hoverReveal: event.hoverReveal };
    case "pointer-enter":
      return { ...m, inside: true };
    case "pointer-leave":
      return { ...m, inside: false, suppressed: false };
    case "hover-rail":
      return m.suppressed ? m : reveal(m);
    case "focus-rail":
      return reveal(m);
    case "grace-elapsed":
      if (m.openedBy !== "hover" || m.inside || event.keyboardInside) return m;
      return { ...m, openedBy: null };
    case "menu-click":
      if (m.pinned) return { ...m, pinned: false, openedBy: null, shift: "out" };
      if (m.openedBy === "click") return { ...m, openedBy: null };
      return {
        ...m,
        openedBy: "click",
        focusTick: event.keyboard ? m.focusTick + 1 : m.focusTick,
      };
    case "escape":
      if (m.pinned || m.openedBy === null) return m;
      return { ...m, openedBy: null };
    case "page-chosen":
      if (m.pinned) return m;
      return { ...m, openedBy: null, suppressed: m.inside };
    case "pin":
      // Unpinned, the panel floats on, the way the pointer would have left it.
      return event.pinned
        ? { ...m, pinned: true, openedBy: null, shift: "in" }
        : { ...m, pinned: false, openedBy: m.hoverReveal ? "hover" : "click", shift: "out" };
    case "hover-reveal":
      // With hovering off, leaving never closes the panel, so one the hover opened is now held.
      return {
        ...m,
        hoverReveal: event.on,
        openedBy: !event.on && m.openedBy === "hover" ? "click" : m.openedBy,
      };
  }
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
