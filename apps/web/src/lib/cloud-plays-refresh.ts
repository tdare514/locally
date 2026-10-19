/** How often Settings re-reads the online counting status while it is open (#307). */
export const CLOUD_PLAYS_REREAD_MS = 60_000;

interface Listenable {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/**
 * Re-reads the status every 60 s, and at once when the window regains focus or becomes visible
 * again (the owner coming back from the browser after consent). Returns the cleanup.
 */
export function watchCloudPlays(
  refresh: () => void,
  win: Listenable,
  doc: Listenable & { visibilityState: string },
  intervalMs: number = CLOUD_PLAYS_REREAD_MS,
): () => void {
  const timer = setInterval(refresh, intervalMs);
  const onFocus = () => refresh();
  const onVisible = () => {
    if (doc.visibilityState === "visible") refresh();
  };
  win.addEventListener("focus", onFocus);
  doc.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(timer);
    win.removeEventListener("focus", onFocus);
    doc.removeEventListener("visibilitychange", onVisible);
  };
}
