"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/** The nearest ancestor that scrolls vertically (the app's main pane), or null. */
function scrollingAncestor(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/** The element's own width, kept current with a ResizeObserver; null until it is measured (and on
 * the server). The table's columns read this, not the window (#294). */
export function useElementWidth(ref: RefObject<HTMLElement | null>, ready = true): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ready ? ref.current : null;
    if (!el) return;
    const read = () => setWidth(el.getBoundingClientRect().width);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, ready]);
  return width;
}

/** The width of the pane the element scrolls in (padding included), kept current; null until measured.
 * `ready` is false while the element is not in the page yet (a page still loading); it measures once true. */
export function usePaneWidth(ref: RefObject<HTMLElement | null>, ready = true): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ready ? ref.current : null;
    const pane = el ? scrollingAncestor(el) : null;
    if (!pane) return;
    const read = () => setWidth(pane.clientWidth);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [ref, ready]);
  return width;
}
