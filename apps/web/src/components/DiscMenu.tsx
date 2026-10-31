"use client";

import { useEffect, useId, useRef } from "react";
import { ChevronRightIcon } from "./Icons";

export interface DiscActions {
  /** The disc a "Start disc N here" action would create. */
  start?: number;
  /** The disc a "Join disc N" action would merge into. */
  join?: number;
}

interface DiscMenuProps {
  /** The row's 1-based number, for the menu's name. */
  number: number;
  /** The track's title, for the trailing button's name: "Move {title} to another disc". */
  title: string;
  actions: DiscActions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: () => void;
  onJoin: () => void;
}

/** The disc menu of a track row (#222), as the trailing chevron button and its menu of the two actions that apply ("Start disc N here", "Join disc N").
 * Real menu semantics: arrow keys move, Escape closes and gives focus back, a click outside closes. */
export default function DiscMenu({ number, title, actions, open, onOpenChange, onStart, onJoin }: DiscMenuProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const menuId = useId();
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });

  const items: { label: string; run: () => void }[] = [];
  if (actions.start !== undefined) items.push({ label: `Start disc ${actions.start} here`, run: onStart });
  if (actions.join !== undefined) items.push({ label: `Join disc ${actions.join}`, run: onJoin });

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onOpenChangeRef.current(false);
      buttonRef.current?.focus();
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Element | null;
      // The number's own button toggles the menu, so a press on it is not "outside".
      if (!target || wrapRef.current?.contains(target) || target.closest("[data-disc-button]")) return;
      onOpenChangeRef.current(false);
    }
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);

  function onMenuKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    const els = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]"));
    const at = els.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (e.key === "ArrowDown") next = (at + 1) % els.length;
    else if (e.key === "ArrowUp") next = (at - 1 + els.length) % els.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = els.length - 1;
    else if (e.key === "Tab") {
      onOpenChange(false);
      return;
    } else return;
    e.preventDefault();
    els[next]?.focus();
  }

  return (
    <div ref={wrapRef} className="relative shrink-0">
      {/* The pointer's way in (#338): the play button covers the number, so the menu has its own trailing button, quiet
          like the grip until the row is hovered or has focus. The number stays the keyboard handle. */}
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Move ${title} to another disc`}
        onClick={() => onOpenChange(!open)}
        className="track-affordance flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-white outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ChevronRightIcon aria-hidden className="size-4 rotate-90" />
      </button>
      {open && (
        <ul
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`Track ${number}, disc options`}
          onKeyDown={onMenuKeyDown}
          // The track list starts a drag from a bare press; a press in here is not one.
          onPointerDown={(e) => e.stopPropagation()}
          className="disc-pop glass-fake glass-frost absolute right-0 top-full z-30 isolate mt-1 min-w-44 rounded-2xl p-1.5"
        >
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={item.run}
                className="block w-full cursor-pointer whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-sm text-text outline-none hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-accent"
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A track's number as the keyboard handle of its disc menu (#222): Enter, Space or ArrowDown opens the menu that
 * `DiscMenu` (the trailing button) shows. Right-click on the row opens it too.
 */
export function DiscNumberButton({
  number,
  open,
  menuId,
  onOpenChange,
}: {
  number: number;
  open: boolean;
  menuId?: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <button
      type="button"
      data-disc-button
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      aria-label={`Track ${number}, disc options`}
      onClick={() => onOpenChange(!open)}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" && !open) {
          e.preventDefault();
          onOpenChange(true);
        }
      }}
      className="relative flex h-8 w-6 cursor-pointer items-center rounded-full text-sm tabular-nums text-white/60 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span data-number className="tabular-nums">
        {number}
      </span>
    </button>
  );
}
