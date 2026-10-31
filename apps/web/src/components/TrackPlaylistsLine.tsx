"use client";

import { useEffect, useId, useRef, useState } from "react";
import { playlistsLine, playlistsListLabel } from "../lib/spotify-playlists-copy";

export interface PlaylistRef {
  id: string;
  name: string;
}

interface Props {
  trackTitle: string;
  playlists: PlaylistRef[];
  /** Open one playlist in Spotify. */
  onOpen: (id: string) => void;
}

const FOCUSABLE = "input, button, a, textarea, select, [tabindex]";

/**
 * "In Night drive and Gym" under a track (#212). It is a button that opens a small list of every
 * playlist; each name opens that playlist in Spotify. Escape or a click outside closes it.
 */
export default function TrackPlaylistsLine({ trackTitle, playlists, onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      lineRef.current?.focus();
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Element | null;
      if (!target || wrapRef.current?.contains(target)) return;
      setOpen(false);
      // Focus returns to the line unless the click landed on something that takes focus itself.
      if (!target.closest(FOCUSABLE)) lineRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);

  if (playlists.length === 0) return null;

  return (
    <div ref={wrapRef} className="relative min-w-0">
      <button
        ref={lineRef}
        type="button"
        data-playlists-line
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="-mx-1.5 block cursor-pointer truncate rounded-lg px-1.5 text-left text-[13px] leading-5 text-text-muted outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-accent"
      >
        {playlistsLine(playlists.map((p) => p.name))}
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          aria-label={playlistsListLabel(trackTitle)}
          // The track list starts a drag from a bare press; a press in here is not one.
          onPointerDown={(e) => e.stopPropagation()}
          className="playlist-pop glass-fake glass-frost absolute left-0 top-full z-30 isolate mt-1 max-h-64 min-w-44 max-w-72 overflow-y-auto overscroll-contain rounded-2xl p-1.5"
        >
          {playlists.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  lineRef.current?.focus();
                  onOpen(p.id);
                }}
                className="block w-full cursor-pointer truncate rounded-lg px-3 py-1.5 text-left text-sm text-text outline-none hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-accent"
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
