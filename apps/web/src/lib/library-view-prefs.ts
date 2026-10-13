/** Library home view preferences (#112): list or cover grid, and the cover grid's tile size.
 * Kept in localStorage; every access is guarded so a blocked or full store falls back to defaults. */

export type LibraryLayout = "list" | "covers";
/** Cover tile size: 0 compact, 1 medium, 2 large. */
export type CoverSize = 0 | 1 | 2;
/** Library column width, shared by both layouts: 920px comfortable, 1240px full. */
export type LibraryWidth = "comfortable" | "full";

/** Grid minimum column width in px, per cover size. */
export const COVER_TILE_MIN_PX = [136, 188, 260] as const;
/** Grid gap in px, per cover size. */
export const COVER_GRID_GAP_PX = [20, 28, 36] as const;

const LAYOUT_KEY = "locally.library.layout";
const COVER_SIZE_KEY = "locally.library.coverSize";
const WIDTH_KEY = "locally.library.width";

export function parseLibraryLayout(raw: string | null): LibraryLayout {
  return raw === "covers" ? "covers" : "list";
}

export function parseCoverSize(raw: string | null): CoverSize {
  return raw === "0" ? 0 : raw === "2" ? 2 : 1;
}

export function parseLibraryWidth(raw: string | null): LibraryWidth {
  return raw === "full" ? "full" : "comfortable";
}

/** The saved layout and cover size, or the defaults (list, medium). */
export function loadLibraryViewPrefs(): { layout: LibraryLayout; coverSize: CoverSize } {
  let layout: LibraryLayout = "list";
  let coverSize: CoverSize = 1;
  try {
    layout = parseLibraryLayout(window.localStorage.getItem(LAYOUT_KEY));
  } catch {
    // Storage unavailable: keep the default.
  }
  try {
    coverSize = parseCoverSize(window.localStorage.getItem(COVER_SIZE_KEY));
  } catch {
    // Storage unavailable: keep the default.
  }
  return { layout, coverSize };
}

export function saveLibraryLayout(layout: LibraryLayout): void {
  try {
    window.localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    // Not persisted; the choice still applies for this session.
  }
}

export function saveCoverSize(size: CoverSize): void {
  try {
    window.localStorage.setItem(COVER_SIZE_KEY, String(size));
  } catch {
    // Not persisted; the choice still applies for this session.
  }
}

/** The saved library width, or "comfortable". */
export function loadLibraryWidth(): LibraryWidth {
  try {
    return parseLibraryWidth(window.localStorage.getItem(WIDTH_KEY));
  } catch {
    return "comfortable";
  }
}

export function saveLibraryWidth(width: LibraryWidth): void {
  try {
    window.localStorage.setItem(WIDTH_KEY, width);
  } catch {
    // Not persisted; the choice still applies for this session.
  }
}
