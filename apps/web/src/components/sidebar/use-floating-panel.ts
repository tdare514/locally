"use client";

import {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import {
  INITIAL_PANEL,
  isHeldOpen,
  isShown,
  panelReduce,
  type PanelEvent,
} from "../../lib/sidebar-panel";
import {
  loadSidebarPrefs,
  saveSidebarOpenOnHover,
  saveSidebarPinned,
} from "../../lib/sidebar-prefs";

/** How long the pointer can be off the panel and its trigger before the panel hides (#154). */
export const GRACE_MS = 300;

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
 * The sidebar's hover-revealed panel (#154).
 *
 * - With Open on hover on, hovering the rail reveals the panel. A panel the hover opened stays
 *   while the pointer is anywhere over the root (rail plus panel) and hides GRACE_MS after the
 *   pointer leaves; a keyboard user's focus inside the root also keeps it open. With it off,
 *   hovering and focusing the rail do nothing: only the menu button opens the panel.
 * - A panel the menu button opened (a click, or Enter or Space, which also moves focus into it)
 *   stays when the pointer leaves, in either mode. Clicking the menu button on a hover-opened panel
 *   holds it open the same way. A second click closes it; so does Escape or choosing a page.
 *   Clicking outside the sidebar does not.
 * - Choosing a page closes an unpinned panel at once and gives focus to that page's rail icon. If
 *   the pointer is still over the sidebar, hovering cannot reopen it until the pointer has left and
 *   come back. A pinned panel stays docked.
 * - Escape closes an unpinned panel and gives focus back to the trigger. A pinned panel is
 *   layout, so Escape leaves it alone.
 * - Pinned and Open on hover are remembered (lib/sidebar-prefs). What each event means is decided
 *   by panelReduce in lib/sidebar-panel.
 */
export function useFloatingPanel(refs: PanelRefs) {
  const [model, dispatch] = useReducer(panelReduce, INITIAL_PANEL);
  const { pinned, hoverReveal, shift, focusTick } = model;

  const panelId = useId();
  const { root: rootRef, trigger: triggerRef, panel: panelRef } = refs;
  const timer = useRef<number | null>(null);
  // True while we move focus ourselves, so that does not reveal the panel again.
  const quiet = useRef(false);

  const shown = isShown(model);
  const held = isHeldOpen(model);

  // Saved prefs load after mount so the server and first client render agree.
  useEffect(() => {
    const prefs = loadSidebarPrefs();
    dispatch({ type: "prefs", pinned: prefs.pinned, hoverReveal: prefs.openOnHover });
  }, []);

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
      dispatch({ type: "grace-elapsed", keyboardInside });
    }, GRACE_MS);
  }, [clearTimer, rootRef]);

  useEffect(() => clearTimer, [clearTimer]);

  /** Moves focus without that counting as a keyboard visit to the rail. */
  const focusQuietly = useCallback((el: HTMLElement | null | undefined) => {
    if (!el) return;
    quiet.current = true;
    el.focus({ preventScroll: true });
    quiet.current = false;
  }, []);

  // Escape closes an unpinned panel.
  useEffect(() => {
    if (!shown || pinned) return;
    function onKeyDown(e: KeyboardEvent) {
      // A popover inside the panel handles its own Escape first and marks the event.
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const hadFocus = !!rootRef.current && rootRef.current.contains(document.activeElement);
      clearTimer();
      dispatch({ type: "escape" });
      if (hadFocus) focusQuietly(triggerRef.current);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shown, pinned, clearTimer, rootRef, triggerRef, focusQuietly]);

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

  /** Sends an event the user caused; anything pending from the pointer leaving is dropped. Pinning
   * is remembered when the event changes it. */
  const send = useCallback(
    (event: PanelEvent) => {
      clearTimer();
      const next = panelReduce(model, event);
      if (next.pinned !== model.pinned) saveSidebarPinned(next.pinned);
      dispatch(event);
    },
    [clearTimer, model],
  );

  const changeHoverReveal = useCallback((on: boolean) => {
    dispatch({ type: "hover-reveal", on });
    saveSidebarOpenOnHover(on);
  }, []);

  return {
    shown,
    /** Docked, or opened by the menu button: the next click on the menu button closes it. */
    held,
    pinned,
    shift,
    panelId,
    hoverReveal,
    setHoverReveal: changeHoverReveal,
    /** "Pin open" on or off. */
    pin: (next: boolean) => send({ type: "pin", pinned: next }),
    /** A page was chosen, on the rail or in the panel. Closes an unpinned panel and puts focus on
     * the page's rail icon (the one with that `data-page`), so it is not lost when the panel hides.
     * A docked panel stays, and focus stays where it is. */
    pageChosen: (page: string) => {
      send({ type: "page-chosen" });
      if (!pinned) {
        focusQuietly(rootRef.current?.querySelector<HTMLElement>(`.sb-rail [data-page="${page}"]`));
      }
    },
    /** On the element that wraps the rail and the panel. */
    rootProps: {
      onPointerEnter: (e: PointerEvent) => {
        if (e.pointerType === "touch") return;
        send({ type: "pointer-enter" });
      },
      onPointerLeave: (e: PointerEvent) => {
        if (e.pointerType === "touch") return;
        send({ type: "pointer-leave" });
        scheduleClose();
      },
      onBlur: (e: FocusEvent) => {
        const next = e.relatedTarget as Node | null;
        if (next && rootRef.current?.contains(next)) return;
        scheduleClose();
      },
    },
    /** On whatever should reveal the panel when hovered or keyboard-focused (the rail). */
    zoneProps: {
      onPointerEnter: (e: PointerEvent) => {
        if (e.pointerType === "touch") return;
        send({ type: "hover-rail" });
      },
      onFocus: (e: FocusEvent<HTMLElement>) => {
        if (quiet.current || !e.target.matches(":focus-visible")) return;
        send({ type: "focus-rail" });
      },
    },
    /** On the menu button. The label says what a click does; aria-expanded says what is on screen. */
    triggerProps: {
      "aria-expanded": shown,
      "aria-controls": panelId,
      "aria-label": held ? "Close sidebar" : shown ? "Keep sidebar open" : "Open sidebar",
      // A click with no pointer position (detail 0) came from Enter or Space.
      onClick: (e: MouseEvent) => send({ type: "menu-click", keyboard: e.detail === 0 }),
    },
  };
}
