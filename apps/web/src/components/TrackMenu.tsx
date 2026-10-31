"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import type { TrackMenuItem } from "../lib/track-menu";
import { MoreIcon } from "./Icons";
import { MENU_ITEM } from "./Popover";

/** Where a menu opens: at the pointer, or under the button that opened it. */
export type MenuAt = { x: number; y: number } | { anchor: HTMLElement };

/** The row's More button, which a menu opened by the pointer or the keyboard gives focus back to. */
const MORE_BUTTON = "[data-track-more]";
/** Where focus goes back to for a row with no More button (a cover tile): its own button. */
const fallbackOpener = (row: HTMLElement) => row.querySelector<HTMLElement>(MORE_BUTTON) ?? row.querySelector<HTMLElement>("button");
/** A gap between a button and the menu under it, and the room the menu keeps from the window's edges. */
const GAP = 4;
const MARGIN = 8;

function inTextField(target: EventTarget): boolean {
  return target instanceof Element && target.closest("input, textarea, [contenteditable=true]") !== null;
}

interface OpenMenu {
  /** The row the menu is for (the surface's own key for it): its More button says it is open, and the surface builds the items from it. */
  key: string;
  at: MenuAt;
  opener: HTMLElement | null;
}

/**
 * The open state of a surface's one track menu (#419): which row it is for and where it opened. A surface calls
 * `rowProps` on each row (right-click, the ContextMenu key and Shift+F10), puts a `TrackMoreButton` in it, and
 * draws one `TrackMenu` after its rows while `open` is set. The title field keeps the system menu (copy and paste).
 */
export function useTrackMenu() {
  const [open, setOpen] = useState<OpenMenu | null>(null);
  const openRef = useRef(open);
  useLayoutEffect(() => {
    openRef.current = open;
  });

  /** `returnFocus`: Escape and a choice made from the keyboard give focus back to the row's More button; a press elsewhere does not. */
  const close = useCallback((returnFocus: boolean) => {
    const was = openRef.current;
    setOpen(null);
    if (returnFocus) was?.opener?.focus({ preventScroll: true });
  }, []);

  // Stable (#422): the library's rows are memoised on these.
  const rowProps = useCallback((key: string) => ({
    onContextMenu(e: ReactMouseEvent<HTMLElement>) {
      const row = e.currentTarget;
      // A popover drawn elsewhere in the page still bubbles to its row through React; only this row's own DOM counts.
      if (!row.contains(e.target as Node) || inTextField(e.target)) return;
      e.preventDefault();
      setOpen({ key, at: { x: e.clientX, y: e.clientY }, opener: fallbackOpener(row) });
    },
    onKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
      if (e.key !== "ContextMenu" && !(e.key === "F10" && e.shiftKey)) return;
      const row = e.currentTarget;
      if (!row.contains(e.target as Node) || inTextField(e.target)) return;
      e.preventDefault();
      const opener = fallbackOpener(row);
      setOpen({ key, at: { anchor: opener ?? (e.target as HTMLElement) }, opener });
    },
  }), []);

  /** The More button's click: opens the menu under the button, or closes it when it is this row's. */
  const toggleFrom = useCallback(
    (button: HTMLElement, key: string) => {
      if (openRef.current?.key === key) close(false);
      else setOpen({ key, at: { anchor: button }, opener: button });
    },
    [close],
  );

  return { open, close, rowProps, toggleFrom };
}

/**
 * The More button of a row or cover (#419): the drawn "more" glyph in a 44 px target, shown while the row is
 * hovered or has focus (or its menu is open). The row (or its wrapper) carries `group/track`. It opens the same menu as a
 * right-click.
 */
export function TrackMoreButton({
  title,
  expanded,
  onOpen,
  className = "",
}: {
  title: string;
  expanded: boolean;
  onOpen: (button: HTMLButtonElement) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-track-more
      aria-haspopup="menu"
      aria-expanded={expanded}
      aria-label={`More actions for ${title}`}
      onClick={(e) => {
        // A row that opens its page on a click (Stats) must not open it for this one.
        e.stopPropagation();
        onOpen(e.currentTarget);
      }}
      className={`btn-icon shrink-0 opacity-0 outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent group-hover/track:opacity-100 group-focus-within/track:opacity-100 aria-expanded:opacity-100 ${className}`}
    >
      <MoreIcon className="size-5" />
    </button>
  );
}

/**
 * The one menu of a track row or release cover (#419): glass, because it floats, in the app's overlay layer.
 * Real menu semantics: arrow keys, Home and End move, Enter or Space chooses, Escape closes and gives focus back
 * to the row's More button, Tab closes and moves on from it, and a press outside or a scroll closes it. Groups
 * are drawn with a 1 px divider between them. It opens at the pointer or under a button, kept inside the window.
 */
export default function TrackMenu({
  label,
  at,
  opener,
  groups,
  onClose,
}: {
  label: string;
  at: MenuAt;
  /** The row's More button (or, for a cover with none, its own button): Escape gives focus back to it. */
  opener: HTMLElement | null;
  groups: TrackMenuItem[][];
  onClose: (returnFocus: boolean) => void;
}) {
  const menuRef = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const place = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const maxHeight = window.innerHeight - 2 * MARGIN;
    const width = menu.offsetWidth;
    const height = Math.min(menu.scrollHeight, maxHeight);
    let left: number;
    let top: number;
    if ("anchor" in at) {
      const rect = at.anchor.getBoundingClientRect();
      // Right edges aligned, under the button; above it when there is no room below and more above.
      left = rect.right - width;
      const below = window.innerHeight - rect.bottom - GAP - MARGIN;
      top = height > below && rect.top - GAP - MARGIN > below ? rect.top - GAP - height : rect.bottom + GAP;
    } else {
      ({ x: left, y: top } = at);
    }
    setPos({
      left: Math.max(MARGIN, Math.min(left, window.innerWidth - width - MARGIN)),
      top: Math.max(MARGIN, Math.min(top, window.innerHeight - height - MARGIN)),
      maxHeight,
    });
  }, [at]);

  useLayoutEffect(() => {
    place();
  }, [place]);

  // Focus goes to the first item once it is placed: a hidden menu can't take focus.
  const placed = pos !== null;
  useEffect(() => {
    if (placed) menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, [placed]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      onCloseRef.current(true);
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      // The More button toggles the menu, so a press on it is not "outside".
      if (!target || menuRef.current?.contains(target) || (opener?.matches(MORE_BUTTON) && opener.contains(target))) return;
      onCloseRef.current(false);
    }
    // A scroll anywhere but in the menu itself leaves it floating over rows that moved.
    function onScroll(e: Event) {
      if (menuRef.current?.contains(e.target as Node)) return;
      onCloseRef.current(false);
    }
    const onResize = () => onCloseRef.current(false);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [opener]);

  function onMenuKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    const els = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]"));
    const current = els.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (e.key === "ArrowDown") next = (current + 1) % els.length;
    else if (e.key === "ArrowUp") next = current <= 0 ? els.length - 1 : current - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = els.length - 1;
    else if (e.key === "Tab") {
      // Focus goes to the row's button first, so Tab moves on from there rather than from a menu that is about to unmount.
      onClose(true);
      return;
    } else return;
    e.preventDefault();
    els[next]?.focus();
  }

  const node = (
    <ul
      ref={menuRef}
      role="menu"
      aria-label={label}
      onKeyDown={onMenuKeyDown}
      // The menu is its own: no system menu on it.
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, maxHeight: pos?.maxHeight, visibility: pos ? "visible" : "hidden" }}
      className="pointer-events-auto fixed z-40 isolate dialog-in glass-fake glass-frost min-w-48 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl p-1.5"
    >
      {groups.map((group, g) => (
        <Fragment key={g}>
          {g > 0 && <li role="separator" className="mx-1.5 my-1 h-px bg-white/10" />}
          {group.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                // A choice made from the keyboard (a click with no pointer) gives focus back to the row's button; the action then moves focus on if it must.
                onClick={(e) => {
                  onClose(e.detail === 0);
                  item.run();
                }}
                className={MENU_ITEM}
              >
                <span className="whitespace-nowrap">{item.label}</span>
              </button>
            </li>
          ))}
        </Fragment>
      ))}
    </ul>
  );
  return createPortal(node, document.getElementById("overlay-root") ?? document.body);
}
