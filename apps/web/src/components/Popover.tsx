"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

/** The stops of a popover's arrow-key walk: its search field, then its menu items. */
const STOPS = 'input[data-menu-search], [role="menuitem"]:not([disabled])';

/**
 * A small anchored panel in the app's overlay layer (#349), for the Add to collection list and a row's menu. Focus
 * moves into it when it opens (the search field, else the first item); the up and down arrows, Home and End walk its
 * items; Escape closes it and gives focus back to the button that opened it; a press outside, or focus moving to somewhere outside it, closes it (Tab walks inside it, so a form in it works).
 * Placed below the anchor, right edges aligned, or above it when there is no room below.
 */
export default function Popover({
  open,
  anchorRef,
  onClose,
  label,
  role = "menu",
  width = 280,
  children,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  /** `returnFocus`: Escape and a choice give focus back to the anchor; a press elsewhere does not. */
  onClose: (returnFocus: boolean) => void;
  label: string;
  role?: "menu" | "dialog";
  width?: number;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ right: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const rect = anchor.getBoundingClientRect();
    const margin = 12;
    const below = window.innerHeight - rect.bottom - margin;
    const above = rect.top - margin;
    const natural = panel.scrollHeight;
    const goUp = natural > below && above > below;
    const right = Math.max(margin, window.innerWidth - rect.right);
    setPos(
      goUp
        ? { right, bottom: Math.round(window.innerHeight - rect.top + 6), maxHeight: Math.floor(above - 6) }
        : { right, top: Math.round(rect.bottom + 6), maxHeight: Math.floor(below - 6) },
    );
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const panel = panelRef.current;
    const observer = panel ? new ResizeObserver(place) : null;
    if (panel && observer) observer.observe(panel);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  // Focus goes in when it opens, and again if the content changes and the focused control went with it. It waits
  // for the first placement: the panel is `visibility: hidden` until then, and a hidden control can't take focus.
  const placed = pos !== null;
  useEffect(() => {
    if (!open || !placed) return;
    const panel = panelRef.current;
    if (panel?.contains(document.activeElement)) return;
    const first = panel?.querySelector<HTMLElement>(STOPS) ?? panel;
    first?.focus({ preventScroll: true });
  }, [open, placed, role]);

  // A press on the anchor toggles it; it must not also read as focus leaving.
  const anchorPressRef = useRef(false);

  // A press outside closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      anchorPressRef.current = anchorRef.current?.contains(t) ?? false;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onCloseRef.current(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, anchorRef]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const stops = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(STOPS) ?? []);
    if (stops.length === 0) return;
    // In the search field the left and right of the caret keep working; up and down leave it.
    e.preventDefault();
    const at = stops.indexOf(document.activeElement as HTMLElement);
    let next = at;
    if (e.key === "ArrowDown") next = at < 0 ? 0 : Math.min(stops.length - 1, at + 1);
    else if (e.key === "ArrowUp") next = at < 0 ? stops.length - 1 : Math.max(0, at - 1);
    else if (e.key === "Home") next = 0;
    else next = stops.length - 1;
    stops[next]?.focus();
  }

  // Focus actually leaving closes it. No related target (the window lost focus, or the focused control was removed) is not leaving.
  function onBlur(e: React.FocusEvent<HTMLDivElement>) {
    const to = e.relatedTarget as Node | null;
    if (!to || panelRef.current?.contains(to)) return;
    if (anchorPressRef.current && anchorRef.current?.contains(to)) return;
    onClose(false);
  }

  const overlay = document.getElementById("overlay-root");
  const node = (
    <div
      ref={panelRef}
      role={role}
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      // The track list starts a drag from a bare press; a press in here is not one.
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        width,
        maxHeight: pos?.maxHeight,
        right: pos?.right ?? 16,
        top: pos?.top,
        bottom: pos?.bottom,
        visibility: pos ? "visible" : "hidden",
      }}
      className="pointer-events-auto fixed z-40 flex max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-2xl glass-fake glass-frost isolate dialog-in p-2 text-left outline-none"
    >
      {children}
    </div>
  );
  return overlay ? createPortal(node, overlay) : node;
}

/** The class of a popover's item: 44 px tall, a visible focus ring. */
export const MENU_ITEM =
  "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-text outline-none hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-accent disabled:text-text-dim disabled:hover:bg-transparent";
