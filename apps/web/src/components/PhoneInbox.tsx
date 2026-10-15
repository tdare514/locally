"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PendingFromPhone } from "../shared/types";
import { CloudDownIcon, MusicNoteIcon, PlusIcon, XIcon } from "./Icons";

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
        className={`relative isolate flex h-[var(--tray-size)] w-[var(--tray-size)] items-center justify-center rounded-full transition-[filter,background-color,box-shadow] active:scale-95 ${
          // Open: the glass drops away and the red X stands alone.
          open ? "bg-transparent" : "glass-fake hover:brightness-125"
        } ${
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
        {count > 0 && !open && (
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
          className="phone-tray glass-fake glass-frost absolute right-full top-full z-30 isolate w-[17rem] max-w-[calc(100vw-2rem)] rounded-[22px] p-2 outline-none"
        >
          {pending.length === 0 && (
            <p className="px-3 py-3 text-sm text-text-muted">Nothing waiting from your phone.</p>
          )}
          {pending.map((p) => (
            <div key={p.id} className="phone-tray-row" data-leaving={leaving.has(p.id)}>
              <div className="min-h-0 overflow-hidden">
                <PendingRow
                  item={p}
                  leaving={leaving.has(p.id)}
                  onSend={() => accept(p.id)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One pending release as a small record sleeve, echoing the release page. The sleeve is the
 * Send to Spotify button: on hover the cover turns accent with a plus (Spotify's own "add" mark)
 * and the disc rolls out; the title and artist sit beside it. */
function PendingRow({
  item,
  leaving,
  onSend,
}: {
  item: PendingFromPhone;
  leaving: boolean;
  onSend: () => void;
}) {
  const title = item.title || item.artist;
  return (
    <div className="flex items-center gap-3.5 rounded-2xl px-2.5 py-2.5">
      <button
        type="button"
        disabled={leaving}
        onClick={onSend}
        aria-label={`Send ${title} to Spotify`}
        title="Send to Spotify"
        className="group/send relative h-12 w-[4.25rem] shrink-0 rounded-[10px] active:scale-95 disabled:opacity-60"
      >
        <span className="absolute right-0 top-1/2 h-11 w-11 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,#3a3a40_0_12%,#0c0c0e_13%_17%,#26262b_18%_40%,#1a1a1e_41%_62%,#2a2a30_63%_100%)] shadow-[0_4px_12px_-4px_rgb(0_0_0/0.8)] ring-1 ring-white/15 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/send:translate-x-1.5 group-hover/send:rotate-45 group-focus-visible/send:translate-x-1.5" />
        <span className="absolute left-0 top-0 flex h-12 w-12 items-center justify-center rounded-[10px] bg-[linear-gradient(140deg,color-mix(in_srgb,var(--accent)_55%,#1a1a1f),#121216)] text-white/70 shadow-[0_6px_16px_-6px_rgb(0_0_0/0.8)] ring-1 ring-white/10 transition-colors group-hover/send:bg-accent group-hover/send:bg-none group-focus-visible/send:bg-accent group-focus-visible/send:bg-none group-focus-visible/send:ring-2 group-focus-visible/send:ring-white">
          <MusicNoteIcon className="h-4 w-4 transition-opacity group-hover/send:opacity-0 group-focus-visible/send:opacity-0" />
          <PlusIcon
            className="absolute h-5 w-5 text-black opacity-0 transition-opacity group-hover/send:opacity-100 group-focus-visible/send:opacity-100"
            strokeWidth={2.5}
          />
        </span>
      </button>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-text">{title}</span>
        {/* A long artist name gives way first; the track count always shows. */}
        <span className="flex text-[13px] text-text-muted">
          <span className="truncate">{item.artist}</span>
          <span className="shrink-0 whitespace-pre">
            {" · "}
            {item.trackCount} track{item.trackCount === 1 ? "" : "s"}
          </span>
        </span>
      </span>
    </div>
  );
}
