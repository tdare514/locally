/** The visible top and bottom of a scrolling pane, kept for the length of a drag (#163). The track
 * list's edge auto-scroll runs every animation frame and needs these edges each time; asking the
 * browser (`getBoundingClientRect`) that often forces layout for nothing, since a pane that only
 * scrolls its content does not move. So they are read once, and again only when the window is
 * resized or the pane changes size. */

export interface PaneEdges {
  /** Top of the pane, clamped to the top of the viewport. */
  top: number;
  /** Bottom of the pane, clamped to the bottom of the viewport. */
  bottom: number;
}

export interface PaneEdgesWatch {
  /** The cached edges. Reading them touches no layout. */
  readonly edges: PaneEdges;
  /** Stops watching for resizes. Call when the drag ends. */
  stop(): void;
}

type WindowLike = Pick<Window, "innerHeight" | "addEventListener" | "removeEventListener">;
type ObserverLike = typeof ResizeObserver | undefined;

/** Measures `pane` now and keeps the result up to date on window resize and, where the browser
 * has `ResizeObserver`, on a change of the pane's own size. `win` and `Observer` are parameters
 * only so a test can stand in for them. */
export function watchPaneEdges(
  pane: HTMLElement,
  win: WindowLike = window,
  Observer: ObserverLike = typeof ResizeObserver === "undefined" ? undefined : ResizeObserver,
): PaneEdgesWatch {
  function measure(): PaneEdges {
    const rect = pane.getBoundingClientRect();
    return { top: Math.max(rect.top, 0), bottom: Math.min(rect.bottom, win.innerHeight) };
  }

  let current = measure();
  const remeasure = () => {
    current = measure();
  };
  win.addEventListener("resize", remeasure);

  // `ResizeObserver` reports once as soon as it starts watching; comparing sizes means that
  // first report, which changes nothing, does not cost a second read.
  let width = pane.clientWidth;
  let height = pane.clientHeight;
  const sizeWatch = Observer
    ? new Observer(() => {
        if (pane.clientWidth === width && pane.clientHeight === height) return;
        width = pane.clientWidth;
        height = pane.clientHeight;
        remeasure();
      })
    : null;
  sizeWatch?.observe(pane);

  return {
    get edges() {
      return current;
    },
    stop() {
      win.removeEventListener("resize", remeasure);
      sizeWatch?.disconnect();
    },
  };
}
