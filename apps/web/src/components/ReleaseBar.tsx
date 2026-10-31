"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { watchEscape } from "../lib/escape-watch";

/** The nearest ancestor that scrolls vertically (the app's main pane). */
function scrollingAncestor(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

interface ReleaseBarProps {
  /** The destructive or secondary action, or its inline confirm, at the left. */
  left?: ReactNode;
  /** One quiet line just left of the main action. */
  status?: ReactNode;
  /** Secondary actions that sit beside the main one, before it. */
  beforeMain?: ReactNode;
  /** The main action, at the right end of the last line. Give it `btn-save`. */
  main: ReactNode;
  /** The bar's measured height, so the page can keep its content clear of it. */
  onHeight?: (height: number) => void;
  /** Accessible name of the bar's region. */
  label: string;
}

/**
 * The release bar (#294): one bar pinned to the bottom of the pane for the release page (Locally's
 * own release and a Spotify folder release) and Import. Inset by the page's gutters (put it as the
 * last child of the page's width container), 24 above the pane's bottom, at least 68 tall; it wraps
 * to a second line when the pane is narrow or a confirm is long, the main action keeping the right
 * end of the last line. Faked glass on the dock's base, no live blur. Nothing in it animates on load.
 *
 * It takes no room itself (a zero-height sticky anchor); it brings a spacer of `--bottom-bars-h` (this bar, the mini
 * player and some air) before the anchor so the page's content ends clear of both, and the same variable is the pane's
 * `scroll-padding-bottom` (globals.css), so a focused row scrolls clear of them. Tab order is the DOM order: left, status, secondary, main.
 */
// A sticky offset counts from the scroll container's content edge, inside its padding, so the 24 above the
// pane's bottom is 24 minus AppShell's bottom padding (p-6 md:p-10 lg:p-16): 0, -16 and -40.
export default function ReleaseBar({ left, status, beforeMain, main, onHeight, label }: ReleaseBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const onHeightRef = useRef(onHeight);
  useLayoutEffect(() => {
    onHeightRef.current = onHeight;
  });

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const pane = scrollingAncestor(bar);
    // The mini player (#338) floats above this bar: publish the bar's height plus a 12 px gap on the pane's parent.
    const stage = pane?.parentElement ?? null;
    const measure = () => {
      const height = bar.getBoundingClientRect().height;
      onHeightRef.current?.(height);
      stage?.style.setProperty("--release-bar-h", `${Math.ceil(height) + 12}px`);
      stage?.style.setProperty("--no-bar", "0");
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      stage?.style.removeProperty("--release-bar-h");
      stage?.style.removeProperty("--no-bar");
    };
  }, []);

  return (
    <>
    {/* Room for this bar and the mini player (#338): `--bottom-bars-h` on the pane. It comes before the bar's anchor and
        inside the page's container (the bar is its last child), so the content ends clear of both and the anchor, which a
        sticky box can only hold back, still ends the page at the pane's bottom edge. */}
    <div aria-hidden style={{ height: "var(--bottom-bars-h, 0px)" }} />
    <div className="pointer-events-none sticky bottom-0 z-20 h-0 md:-bottom-4 lg:-bottom-10">
      <div
        ref={barRef}
        role="region"
        aria-label={label}
        className="pointer-events-auto absolute inset-x-0 bottom-0 isolate flex min-h-[68px] flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl glass-fake glass-dock px-5 py-3"
      >
        {left && <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">{left}</div>}
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-2">
          {status && <span className="text-sm text-text-muted">{status}</span>}
          {beforeMain}
          {main}
        </div>
      </div>
    </div>
    </>
  );
}

/** State for a bar's inline confirm: the button that opens it gets `bindOpener`, and `cancel` (the
 * Cancel button or Escape) gives focus back to it. `close` ends the confirm without moving focus. */
export function useBarConfirm(): {
  open: boolean;
  ask: () => void;
  cancel: () => void;
  close: () => void;
  bindOpener: (el: HTMLButtonElement | null) => void;
} {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const bindOpener = useCallback((el: HTMLButtonElement | null) => {
    opener.current = el;
  }, []);
  const restore = useRef(false);

  useEffect(() => {
    if (!open && restore.current) {
      restore.current = false;
      opener.current?.focus();
    }
  }, [open]);

  const ask = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  const cancel = useCallback(() => {
    restore.current = true;
    setOpen(false);
  }, []);
  return { open, ask, cancel, close, bindOpener };
}

/** An inline confirm in the bar's left slot: a sentence, the confirming button and Cancel. Focus
 * moves to Cancel (the safe choice) when it opens; Escape anywhere cancels it. */
export function BarConfirm({
  message,
  children,
  onCancel,
  cancelLabel = "Cancel",
  disabled,
}: {
  message: string;
  /** The confirming button. */
  children: ReactNode;
  onCancel: () => void;
  cancelLabel?: string;
  disabled?: boolean;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  useLayoutEffect(() => {
    onCancelRef.current = onCancel;
  });
  useEffect(() => {
    cancelRef.current?.focus();
    // Escape cancels wherever focus is while the confirm is open, not only inside it; the listener
    // goes when the confirm closes.
    return watchEscape(document, () => onCancelRef.current());
  }, []);
  return (
    <div
      role="group"
      aria-label={message}
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-sm"
    >
      <span className="min-w-0 max-w-[40rem] text-text-muted">{message}</span>
      {children}
      <button ref={cancelRef} type="button" onClick={onCancel} disabled={disabled} className="btn-ink">
        {cancelLabel}
      </button>
    </div>
  );
}
