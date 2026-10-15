"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

// One MediaQueryList, made on first use (there is no window while rendering on the server).
let list: MediaQueryList | undefined;
function query(): MediaQueryList {
  return (list ??= window.matchMedia(QUERY));
}

function subscribe(onChange: () => void): () => void {
  const q = query();
  q.addEventListener("change", onChange);
  return () => q.removeEventListener("change", onChange);
}

/** True when the system asks for reduced motion. False on the server. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => query().matches,
    () => false,
  );
}
