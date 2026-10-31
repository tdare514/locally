"use client";

import { useEffect, useRef, useState } from "react";
import { copyText } from "../lib/copy-text";
import { COPY_LABEL, PLAYLIST_FALLBACK, playlistSteps } from "../lib/playlist-copy";
import { ChevronRightIcon, CopyIcon } from "./Icons";

/**
 * The "Make it a playlist" disclosure for a collection (#353), from the same strings as the release page's (#21):
 * Copy for the name, the tracks in order, the Mac steps and the fallback line. Collapsed until opened.
 */
export default function PlaylistGuide({
  name,
  trackTitles,
  note,
  unavailable,
}: {
  name: string;
  trackTitles: string[];
  /** A quiet line under the list, e.g. how many tracks were left out. */
  note?: string | null;
  /** When set, shown in place of the name, list and steps: this device has no track to add. */
  unavailable?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timeout.current) clearTimeout(timeout.current); }, []);

  async function handleCopy() {
    const ok = await copyText(name);
    if (timeout.current) clearTimeout(timeout.current);
    setCopied(ok);
    setFailed(!ok);
    // A failure stays until the next try; a success clears after a few seconds.
    if (ok) timeout.current = setTimeout(() => setCopied(false), 3000);
  }

  return (
    <details className="group rounded-xl border border-border bg-card p-5">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-base font-bold tracking-[-0.02em] text-text [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="h-4 w-4 text-text-muted transition-transform motion-reduce:transition-none group-open:rotate-90" />
        Make it a playlist
      </summary>
      {unavailable ? (
        <p className="mt-4 text-sm text-text-muted">{unavailable}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-text">{name}</span>
            <button type="button" onClick={handleCopy} className="btn-ink min-h-11">
              <CopyIcon className="h-3.5 w-3.5" />
              {COPY_LABEL}
            </button>
            <span role="status" aria-live="polite" className="text-sm text-text-muted">
              {failed ? "Couldn't copy the name" : copied ? "Name copied" : ""}
            </span>
          </div>
          {trackTitles.length > 0 && (
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-text">
              {trackTitles.map((title, i) => (
                <li key={i}>{title}</li>
              ))}
            </ol>
          )}
          {note && <p className="text-xs text-text-muted">{note}</p>}
          <p className="text-sm text-text-muted">{playlistSteps(name, trackTitles.length)}</p>
          <p className="text-xs text-text-muted">{PLAYLIST_FALLBACK}</p>
        </div>
      )}
    </details>
  );
}
