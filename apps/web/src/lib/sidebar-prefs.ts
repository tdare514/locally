/** Sidebar preferences (#154): whether the panel is docked, whether hovering the rail opens it,
 * and which widgets show. Kept in localStorage like the library view prefs; every access is
 * guarded so a blocked or full store falls back to the defaults. */

import { DEFAULT_WIDGETS, WIDGETS, widgetsOnCount, type WidgetState } from "./sidebar-panel";

const PINNED_KEY = "locally.sidebar.pinned";
const OPEN_ON_HOVER_KEY = "locally.sidebar.openOnHover";
const WIDGETS_KEY = "locally.sidebar.widgets";

export interface SidebarPrefs {
  pinned: boolean;
  openOnHover: boolean;
  widgets: WidgetState;
}

/** Docked only when saved as "true". */
export function parsePinned(raw: string | null): boolean {
  return raw === "true";
}

/** On unless saved as "false". */
export function parseOpenOnHover(raw: string | null): boolean {
  return raw !== "false";
}

/** The saved widgets, or the defaults for anything missing, malformed, or with every widget off. */
export function parseWidgets(raw: string | null): WidgetState {
  if (!raw) return DEFAULT_WIDGETS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_WIDGETS;
    const record = parsed as Record<string, unknown>;
    const widgets = { ...DEFAULT_WIDGETS };
    for (const { key } of WIDGETS) {
      if (typeof record[key] === "boolean") widgets[key] = record[key];
    }
    return widgetsOnCount(widgets) === 0 ? DEFAULT_WIDGETS : widgets;
  } catch {
    return DEFAULT_WIDGETS;
  }
}

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
    // Not persisted; the choice still applies for this session.
  }
}

export function loadSidebarPrefs(): SidebarPrefs {
  return {
    pinned: parsePinned(read(PINNED_KEY)),
    openOnHover: parseOpenOnHover(read(OPEN_ON_HOVER_KEY)),
    widgets: parseWidgets(read(WIDGETS_KEY)),
  };
}

export function saveSidebarPinned(pinned: boolean): void {
  write(PINNED_KEY, String(pinned));
}

export function saveSidebarOpenOnHover(openOnHover: boolean): void {
  write(OPEN_ON_HOVER_KEY, String(openOnHover));
}

export function saveSidebarWidgets(widgets: WidgetState): void {
  write(WIDGETS_KEY, JSON.stringify(widgets));
}
