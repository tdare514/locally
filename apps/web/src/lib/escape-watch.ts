/** The slice of `document` the Escape watch needs, so it can be tested with a fake. */
export interface KeyTarget {
  addEventListener(type: "keydown", listener: (e: { key: string; preventDefault(): void }) => void): void;
  removeEventListener(type: "keydown", listener: (e: { key: string; preventDefault(): void }) => void): void;
}

/** Calls `onEscape` for every Escape press on `target` until the returned function is called. The
 * release bar's inline confirm uses it on the document, so Escape cancels wherever focus is (#294). */
export function watchEscape(target: KeyTarget, onEscape: () => void): () => void {
  const listener = (e: { key: string; preventDefault(): void }) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    onEscape();
  };
  target.addEventListener("keydown", listener);
  return () => target.removeEventListener("keydown", listener);
}
