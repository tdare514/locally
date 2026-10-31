"use client";

import { useEffect, useState } from "react";

/** How long a wait runs before its placeholder shows (#422, docs/design.md rule 10): shorter waits show nothing. */
export const PLACEHOLDER_DELAY_MS = 300;

/**
 * The effect behind {@link useDelayedFlag}, apart so it can be tested without a DOM. While `busy`, calls
 * `show(true)` once `delayMs` has passed; the returned cleanup cancels a pending call and hides again.
 */
export function revealAfter(busy: boolean, delayMs: number, show: (shown: boolean) => void): (() => void) | undefined {
  if (!busy) return undefined;
  const timer = setTimeout(() => show(true), delayMs);
  return () => {
    clearTimeout(timer);
    show(false);
  };
}

/**
 * True once `busy` has stayed true for `delayMs` (300 ms by default), false again the moment it ends. A page that
 * answers quickly never flashes its skeleton; a real wait shows it.
 */
export function useDelayedFlag(busy: boolean, delayMs: number = PLACEHOLDER_DELAY_MS): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => revealAfter(busy, delayMs, setShown), [busy, delayMs]);
  return busy && shown;
}
