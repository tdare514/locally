"use client";

import { useEffect, useRef, useState } from "react";
import type { ArtistEntry } from "../lib/artist-index";
import { featuringText } from "../lib/featuring-field";
import FeaturedField from "./FeaturedField";

interface Props {
  /** What the popover is named after: the track's title, or "track 2" while it has none. */
  trackName: string;
  names: string[];
  onChange: (names: string[]) => void;
  index: ArtistEntry[];
}

const FOCUSABLE = "input, button, a, textarea, select, [tabindex]";

/**
 * "feat. B & C" dimmed after an album track's title (#287), or a "feat." button that shows on hover
 * or focus. Either opens a small glass popover with the pill field and a Done button. Escape or
 * Done closes it and gives focus back to the button; so does a click outside.
 */
export default function TrackFeaturing({ trackName, names, onChange, index }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Element | null;
      if (!target || wrapRef.current?.contains(target)) return;
      // Blur first, so a name typed but not added is kept before the popover unmounts.
      (document.activeElement as HTMLElement | null)?.blur();
      setOpen(false);
      // Focus returns to the button unless the click landed on something that takes focus itself.
      if (!target.closest(FOCUSABLE)) buttonRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  function close() {
    (document.activeElement as HTMLElement | null)?.blur();
    setOpen(false);
    buttonRef.current?.focus();
  }

  const has = names.length > 0;

  return (
    <div ref={wrapRef} className="relative min-w-0 shrink">
      <button
        ref={buttonRef}
        type="button"
        data-featuring-button
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => (open ? close() : setOpen(true))}
        className={`cursor-pointer truncate rounded-md px-1.5 py-0.5 text-left text-[15px] outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-accent ${
          has
            ? "text-text-muted"
            : "text-text-dim opacity-0 group-hover/track:opacity-100 group-focus-within/track:opacity-100 aria-expanded:opacity-100"
        }`}
      >
        {has ? featuringText(names) : "feat."}
      </button>
      {open && (
        <div
          role="group"
          aria-label={`Featured artists on ${trackName}`}
          // The track list starts a drag from a bare press; a press in here is not one.
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            // The combobox stops its own Escape while its list is open, so this is the second one.
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            close();
          }}
          className="playlist-pop glass-fake glass-frost absolute left-0 top-full z-30 isolate mt-1 flex w-72 max-w-[80vw] flex-col gap-3 rounded-2xl p-3"
        >
          <FeaturedField
            names={names}
            onChange={onChange}
            index={index}
            ariaLabel="Add a featured artist"
            inputClassName="field-sizing-content min-w-[12ch] max-w-full rounded-md bg-transparent px-1.5 py-0.5 text-sm text-text outline-none transition-colors placeholder:text-white/50 hover:bg-white/[0.07] focus:bg-white/10 focus:ring-2 focus:ring-accent"
          />
          <button type="button" onClick={close} className="btn-ink self-end">
            <span className="btn-ink-label">Done</span>
          </button>
        </div>
      )}
    </div>
  );
}
