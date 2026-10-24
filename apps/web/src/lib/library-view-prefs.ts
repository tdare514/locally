/** Library home view preferences (#112, #288): list, cover grid or artists, and the cover grid's tile size.
 * Kept in localStorage; every access is guarded so a blocked or full store falls back to defaults. */

export type LibraryLayout = "list" | "covers" | "artists";
/** Cover tile size: 0 compact, 1 medium, 2 large. */
export type CoverSize = 0 | 1 | 2;
/** Library width, shared by both layouts: "full" fills the main pane (default), "comfortable" is a centred 920px column. */
export type LibraryWidth = "comfortable" | "full";

/** Grid minimum column width in px, per cover size. */
export const COVER_TILE_MIN_PX = [136, 188, 260] as const;
/** Grid gap in px, per cover size. */
export const COVER_GRID_GAP_PX = [20, 28, 36] as const;

const LAYOUT_KEY = "locally.library.layout";
const COVER_SIZE_KEY = "locally.library.coverSize";
const WIDTH_KEY = "locally.library.width";

export function parseLibraryLayout(raw: string | null): LibraryLayout {
  return raw === "covers" || raw === "artists" ? raw : "list";
}

export function parseCoverSize(raw: string | null): CoverSize {
  return raw === "0" ? 0 : raw === "2" ? 2 : 1;
}

export function parseLibraryWidth(raw: string | null): LibraryWidth {
  return raw === "comfortable" ? "comfortable" : "full";
}

/** Tailwind classes for the library container at each width. Full has no max width and reaches into
 * the pane's own padding (AppShell's p-10 / lg:p-16), leaving about 24px at md and 32px from lg. */
export function libraryWidthClass(width: LibraryWidth): string {
  return width === "comfortable" ? "mx-auto w-full max-w-[920px]" : "md:-mx-4 lg:-mx-8";
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

/** The saved library width, or "full". */
export function loadLibraryWidth(): LibraryWidth {
  try {
    return parseLibraryWidth(window.localStorage.getItem(WIDTH_KEY));
  } catch {
    return "full";
  }
}

export function saveLibraryWidth(width: LibraryWidth): void {
  try {
    window.localStorage.setItem(WIDTH_KEY, width);
  } catch {
    // Not persisted; the choice still applies for this session.
  }
}

/** Which library section: Collections (#349), Singles or Albums (#260). */
export type LibrarySectionKey = "collections" | "singles" | "albums";
export type SectionFolds = Record<LibrarySectionKey, boolean>;

const FOLD_KEYS: Record<LibrarySectionKey, string> = {
  collections: "locally.library.collectionsFolded",
  singles: "locally.library.singlesFolded",
  albums: "locally.library.albumsFolded",
};

/** Both sections open: the default. */
export const NO_FOLDS: SectionFolds = { collections: false, singles: false, albums: false };

export function parseSectionFolded(raw: string | null): boolean {
  return raw === "1";
}

/** The saved fold of each section; open when nothing is saved or storage is blocked. */
export function loadSectionFolds(): SectionFolds {
  const folds = { ...NO_FOLDS };
  for (const key of Object.keys(FOLD_KEYS) as LibrarySectionKey[]) {
    try {
      folds[key] = parseSectionFolded(window.localStorage.getItem(FOLD_KEYS[key]));
    } catch {
      // Storage unavailable: keep it open.
    }
  }
  return folds;
}

export function saveSectionFolded(key: LibrarySectionKey, folded: boolean): void {
  try {
    window.localStorage.setItem(FOLD_KEYS[key], folded ? "1" : "0");
  } catch {
    // Not persisted; the choice still applies for this session.
  }
}

/** A section shows its rows unless folded; a typed search opens both without touching the stored fold. */
export function isSectionOpen(folded: boolean, query: string): boolean {
  return !folded || query.trim() !== "";
}
