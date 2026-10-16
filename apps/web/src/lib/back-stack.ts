// The Mac app's back history (#258). Pure: AppShell owns the stack and the view snapshots.

/** The minimum a view needs for a label; AppShell's `View` fits it. */
export interface BackView {
  type: "library" | "import" | "release" | "settings" | "stats";
}

/** One earlier view plus the state needed to put it back as it was. */
export interface BackEntry<V extends BackView, S> {
  view: V;
  /** scrollTop of the scrolling pane when the view was left. */
  scrollTop: number;
  /** Library sort and search, Stats prefs: whatever AppShell keeps for the view. */
  state: S;
}

export type BackStack<V extends BackView, S> = readonly BackEntry<V, S>[];

export function pushEntry<V extends BackView, S>(
  stack: BackStack<V, S>,
  entry: BackEntry<V, S>
): BackStack<V, S> {
  return [...stack, entry];
}

/** The latest entry and the stack without it; null when there is nothing to go back to. */
export function popEntry<V extends BackView, S>(
  stack: BackStack<V, S>
): { entry: BackEntry<V, S>; stack: BackStack<V, S> } | null {
  if (stack.length === 0) return null;
  return { entry: stack[stack.length - 1], stack: stack.slice(0, -1) };
}

/** A page chosen from the rail, sidebar panel, profile or Settings links starts a fresh history. */
export function clearStack<V extends BackView, S>(): BackStack<V, S> {
  return [];
}

/** After an import lands on its release page, back goes to the Library, never the used import page. */
export function stackAfterImport<V extends BackView, S>(
  library: BackEntry<V, S>
): BackStack<V, S> {
  return [library];
}

/** The button shows only while there is somewhere to go back to. */
export function canGoBack<V extends BackView, S>(stack: BackStack<V, S>): boolean {
  return stack.length > 0;
}

/** Where the back button goes, for its aria-label and tooltip. */
export function backLabel(destination: BackView["type"]): string {
  switch (destination) {
    case "library":
      return "Back to Library";
    case "stats":
      return "Back to Stats";
    case "import":
      return "Back to Import";
    case "settings":
      return "Back to Settings";
    case "release":
      return "Back to release";
  }
}
