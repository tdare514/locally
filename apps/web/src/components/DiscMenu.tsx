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
  /** The row's 1-based number, shown as the button's text. */
  number: number;
  actions: DiscActions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: () => void;
  onJoin: () => void;
}

/** A track's number turned into the handle for its disc menu (#222): the number with a small chevron
 * on hover or focus, and a menu of the two actions that apply ("Start disc N here", "Join disc N").
 * Real menu semantics: arrow keys move, Escape closes and gives focus back, a click outside closes. */
export default function DiscMenu({ number, actions, open, onOpenChange, onStart, onJoin }: DiscMenuProps) {
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
      if (!target || wrapRef.current?.contains(target)) return;
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
      <button
        ref={buttonRef}
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
        className="group relative flex h-8 w-6 cursor-pointer items-center rounded-md text-sm tabular-nums text-white/60 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span data-number className="tabular-nums">
          {number}
        </span>
        <ChevronRightIcon
          aria-hidden
          className="absolute -right-2 size-3 rotate-90 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
        />
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
          className="disc-pop glass-fake glass-frost absolute left-0 top-full z-30 isolate mt-1 min-w-44 rounded-2xl p-1.5"
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
