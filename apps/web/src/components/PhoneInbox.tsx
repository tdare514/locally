"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PendingFromPhone } from "../shared/types";
import { CloudDownIcon, MusicNoteIcon, XIcon } from "./Icons";

/** Matches the .phone-tray exit transition in globals.css. */
const EXIT_MS = 200;

interface PhoneInboxProps {
  pending: PendingFromPhone[];
  /** Resolves true when the release was imported; false brings the row back. */
  onAccept: (id: string) => Promise<boolean>;
}

function triggerLabel(count: number, open: boolean): string {
  const base =
    count === 0
      ? "Nothing from your phone"
      : `${count} release${count === 1 ? "" : "s"} from your phone`;
  return open ? `${base}, close` : base;
}

/** Round inbox button in the pane's top-right corner that opens a "From your phone" tray. */
export default function PhoneInbox({ pending, onAccept }: PhoneInboxProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const count = pending.length;

  // The panel renders while open or mounted: focus it on open; on close keep it mounted for its
  // exit, then unmount.
  useEffect(() => {
    if (open) {
      panelRef.current?.focus({ preventScroll: true });
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setMounted(false), reduced ? 0 : EXIT_MS + 40);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function toggle() {
    if (open) triggerRef.current?.focus();
    else setMounted(true);
    setOpen(!open);
  }

  async function accept(id: string) {
    setLeaving((prev) => new Set(prev).add(id));
    if (await onAccept(id)) return;
    // Failed: bring the row back so it can be retried.
    setLeaving((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={triggerLabel(count, open)}
        className={`relative flex h-10 w-10 items-center justify-center rounded-full bg-elevated transition-colors hover:bg-elevated-hover active:scale-95 ${
          count > 0 ? "text-text" : "text-text-dim"
        }`}
      >
        <span className="relative block h-5 w-5">
          <CloudDownIcon className="phone-tray-glyph absolute inset-0 h-5 w-5" data-open={open} />
          <XIcon
            className="phone-tray-glyph phone-tray-glyph-x absolute inset-0 h-5 w-5 text-danger"
            data-open={open}
          />
        </span>
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold leading-none text-black">
            {count}
          </span>
        )}
      </button>

      {(open || mounted) && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="From your phone"
          tabIndex={-1}
          data-state={open ? "open" : "closed"}
          className="phone-tray absolute right-0 top-full z-30 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-white/10 p-2 outline-none"
        >
          <p className="px-2 py-2 text-xs font-bold uppercase tracking-[0.18em] text-accent">
            From your phone
          </p>
          {pending.length === 0 && (
            <p className="px-2 pb-2 text-sm text-text-muted">Nothing waiting from your phone.</p>
          )}
          {pending.map((p) => {
            const isLeaving = leaving.has(p.id);
            return (
              <div key={p.id} className="phone-tray-row" data-leaving={isLeaving}>
                <div className="min-h-0 overflow-hidden">
                  <div className="flex items-center gap-3 rounded-md px-2 py-2">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-elevated text-text-muted">
                      <MusicNoteIcon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text">
                        {p.title || p.artist}
                      </span>
                      <span className="block truncate text-xs text-text-muted">
                        {p.artist} · {p.trackCount} track{p.trackCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={isLeaving}
                      onClick={() => accept(p.id)}
                      className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-xs font-bold text-black transition-colors hover:bg-accent-hover active:scale-95 disabled:opacity-60"
                    >
                      Send to Spotify
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
