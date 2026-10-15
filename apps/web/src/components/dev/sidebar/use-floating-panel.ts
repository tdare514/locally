"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";

import type { PanelStart } from "./sample-data";

/** How long the pointer can be off the panel and its trigger before the panel hides (#154). */
export const GRACE_MS = 300;

export type { PanelStart };

/** The DOM nodes the panel logic needs. Kept apart from the hook's result: the React Compiler lint
 * treats any object holding a ref as a ref, which would flag every plain read of `panel.pinned`. */
export function usePanelRefs() {
  return {
    root: useRef<HTMLDivElement>(null),
    trigger: useRef<HTMLButtonElement>(null),
    panel: useRef<HTMLDivElement>(null),
  };
}
export type PanelRefs = ReturnType<typeof usePanelRefs>;

/**
 * Hover-revealed floating panel (#154 prototype), shared by the three variants.
 *
 * - Hovering a "zone" (the trigger, or the whole rail in variant 2) reveals the panel. It stays
 *   while the pointer is anywhere over the root (trigger plus panel) and hides GRACE_MS after the
 *   pointer leaves. A keyboard user's focus inside the root also keeps it open.
 * - Clicking the trigger with the mouse pins a hover-opened panel; clicking again unpins and
 *   closes it. With "Open on hover" off, a click opens it and a second click closes it.
 * - Pressing Enter or Space on the trigger opens the panel and moves focus into it.
 * - Escape closes an unpinned panel and gives focus back to the trigger. A pinned panel is
 *   layout, so Escape leaves it alone.
 */
export function useFloatingPanel(start: PanelStart, refs: PanelRefs) {
  const [open, setOpen] = useState(start === "open");
  const [pinned, setPinned] = useState(start === "pinned");
  const [hoverReveal, setHoverReveal] = useState(true);
  // Which way the content area should slide after the last pin change; null until it changes.
  const [shift, setShift] = useState<"in" | "out" | null>(null);
  const [focusTick, setFocusTick] = useState(0);

  const panelId = useId();
  const { root: rootRef, trigger: triggerRef, panel: panelRef } = refs;
  const timer = useRef<number | null>(null);
  const hovering = useRef(false);
  // True while we move focus to the trigger ourselves, so that does not reveal the panel again.
  const quiet = useRef(false);

  const shown = open || pinned;

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearTimer();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const active = document.activeElement;
      const keyboardInside =
        !!rootRef.current && !!active && rootRef.current.contains(active) && active.matches(":focus-visible");
      if (hovering.current || keyboardInside) return;
      setOpen(false);
    }, GRACE_MS);
  }, [clearTimer, rootRef]);

  useEffect(() => clearTimer, [clearTimer]);

  // Escape closes an unpinned panel.
  useEffect(() => {
    if (!shown || pinned) return;
    function onKeyDown(e: KeyboardEvent) {
      // A popover inside the panel handles its own Escape first and marks the event.
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const hadFocus = !!rootRef.current && rootRef.current.contains(document.activeElement);
      clearTimer();
      setOpen(false);
      if (hadFocus) {
        quiet.current = true;
        triggerRef.current?.focus();
        quiet.current = false;
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shown, pinned, clearTimer, rootRef, triggerRef]);

  // Focus moves into the panel after a keyboard open. Runs after the commit that shows it.
  useEffect(() => {
    if (focusTick === 0) return;
    const panel = panelRef.current;
    if (!panel) return;
    const first = panel.querySelector<HTMLElement>(
      'button:not([disabled]):not([tabindex="-1"]), a[href], input:not([disabled])',
    );
    (first ?? panel).focus({ preventScroll: true });
  }, [focusTick, panelRef]);

  const reveal = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      clearTimer();
      if (hoverReveal) setOpen(true);
    },
    [clearTimer, hoverReveal],
  );

  const revealOnFocus = useCallback(
    (e: FocusEvent<HTMLElement>) => {
      if (quiet.current || !hoverReveal) return;
      if (!e.target.matches(":focus-visible")) return;
      clearTimer();
      setOpen(true);
    },
    [clearTimer, hoverReveal],
  );

  const pin = useCallback(
    (next: boolean) => {
      clearTimer();
      setPinned(next);
      setShift(next ? "in" : "out");
      setOpen(true);
    },
    [clearTimer],
  );

  const onTriggerClick = (e: MouseEvent) => {
    clearTimer();
    if (pinned) {
      setPinned(false);
      setShift("out");
      setOpen(false);
      return;
    }
    if (e.detail === 0) {
      // Enter or Space: open if needed, then move focus into the panel.
      setOpen(true);
      setFocusTick((t) => t + 1);
      return;
    }
    if (!open) setOpen(true);
    else if (hoverReveal) pin(true);
    else setOpen(false);
  };

  return {
    shown,
    pinned,
    hoverReveal,
    shift,
    panelId,
    pin,
    setHoverReveal,
    /** On the element that wraps the trigger and the panel. */
    rootProps: {
      onPointerEnter: (e: PointerEvent) => {
        if (e.pointerType === "touch") return;
        hovering.current = true;
        clearTimer();
      },
      onPointerLeave: (e: PointerEvent) => {
        if (e.pointerType === "touch") return;
        hovering.current = false;
        scheduleClose();
      },
      onBlur: (e: FocusEvent) => {
        const next = e.relatedTarget as Node | null;
        if (next && rootRef.current?.contains(next)) return;
        if (!hovering.current) scheduleClose();
      },
    },
    /** On whatever should reveal the panel when hovered or keyboard-focused. */
    zoneProps: { onPointerEnter: reveal, onFocus: revealOnFocus },
    /** On the button(s) that toggle the panel. */
    triggerProps: {
      "aria-expanded": shown,
      "aria-controls": panelId,
      onClick: onTriggerClick,
    },
  };
}
