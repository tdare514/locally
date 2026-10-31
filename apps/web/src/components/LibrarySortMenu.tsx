"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LIBRARY_SORT_OPTIONS, type LibrarySort } from "../lib/library-sections";
import { MENU_ITEM } from "./Popover";

interface LibrarySortMenuProps {
  value: LibrarySort;
  onChange: (sort: LibrarySort) => void;
}

/** The Library's sort (#410): an icon-only button that opens a menu of the four orders (the iPhone's), built like the
 * disc menu so one restyle covers both. Real menu semantics: the chosen order is a checked `menuitemradio` with an
 * `accent` check (its label stays white for contrast), arrows on the button open the menu, arrows, Home and End move,
 * Escape closes and gives focus back, a click outside or Tab closes. */
export default function LibrarySortMenu({ value, onChange }: LibrarySortMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const menuId = useId();
  const currentLabel = LIBRARY_SORT_OPTIONS.find((o) => o.value === value)?.label ?? "";

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Element | null;
      // The trigger toggles the menu, so a press on it is not "outside".
      if (!target || wrapRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);

  function onMenuKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    const els = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitemradio]"));
    const at = els.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (e.key === "ArrowDown") next = (at + 1) % els.length;
    else if (e.key === "ArrowUp") next = at < 0 ? els.length - 1 : (at - 1 + els.length) % els.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = els.length - 1;
    else if (e.key === "Tab") {
      // Focus goes to the trigger first, so Tab moves on from there rather than from a menu that is about to unmount.
      buttonRef.current?.focus();
      setOpen(false);
      return;
    } else return;
    e.preventDefault();
    els[next]?.focus();
  }

  function choose(sort: LibrarySort) {
    onChange(sort);
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        className="btn-icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Sort, ${currentLabel}`}
        title="Sort"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {/* #412 replaces this glyph with the shared sort icon. */}
        <svg
          viewBox="0 0 24 24"
          width={20}
          height={20}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M8 20V4M4.5 7.5 8 4l3.5 3.5" />
          <path d="M16 4v16M12.5 16.5 16 20l3.5-3.5" />
        </svg>
      </button>
      {open && (
        <ul
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Sort library"
          onKeyDown={onMenuKeyDown}
          className="disc-pop glass-fake glass-frost absolute right-0 top-full z-30 isolate mt-1 min-w-44 rounded-2xl p-1.5"
        >
          {LIBRARY_SORT_OPTIONS.map((o) => {
            const chosen = o.value === value;
            return (
              <li key={o.value} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={chosen}
                  tabIndex={-1}
                  className={MENU_ITEM}
                  onClick={() => choose(o.value)}
                >
                  <span className="flex-1 whitespace-nowrap">{o.label}</span>
                  {chosen && (
                    <svg
                      viewBox="0 0 24 24"
                      width={16}
                      height={16}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="shrink-0 text-accent"
                    >
                      <path d="m5 12.5 4.5 4.5L19 7.5" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
