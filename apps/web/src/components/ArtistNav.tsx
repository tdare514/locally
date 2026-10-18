"use client";

import { createContext, useContext } from "react";
import { artistKey, splitArtistFeaturing } from "../lib/artist-names";
import { mergeFeatured } from "../lib/featuring-field";
import { ChevronRightIcon } from "./Icons";
import { focusRing } from "./sidebar/controls";

/** The tooltip on a name link while the release page holds edits that leaving would drop. */
export const LOCKED_TIP = "Save or undo your changes first";

/** How an artist name opens that artist's page (#288). AppShell provides `open`; the release page
 * sets `lockedReason` while it has unsaved changes, so no link on it navigates away from them. */
export interface ArtistNav {
  open: (key: string) => void;
  lockedReason: string | null;
}

const ArtistNavContext = createContext<ArtistNav>({ open: () => {}, lockedReason: null });

export const ArtistNavProvider = ArtistNavContext.Provider;

export function useArtistNav(): ArtistNav {
  return useContext(ArtistNavContext);
}

const linkClass = `inline cursor-pointer rounded-sm text-left hover:text-text hover:underline focus-visible:underline ${focusRing} aria-disabled:cursor-not-allowed aria-disabled:hover:no-underline`;

/** One artist name as a link to their page. A name with no letters in it stays plain text. */
export function ArtistLink({ name, className = "" }: { name: string; className?: string }) {
  const { open, lockedReason } = useArtistNav();
  const key = artistKey(name);
  if (key === "") return <span className={className}>{name}</span>;
  return (
    <button
      type="button"
      data-artist-link={key}
      aria-disabled={lockedReason ? true : undefined}
      title={lockedReason ?? undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (!lockedReason) open(key);
      }}
      className={`${linkClass} ${className}`}
    >
      {name}
    </button>
  );
}

/** "A & C" or "B, C & D", the way `joinFeaturing` writes names. */
function Names({ names, className }: { names: string[]; className?: string }) {
  return (
    <>
      {names.map((name, i) => (
        <span key={`${name}-${i}`}>
          {i > 0 && (i === names.length - 1 ? " & " : ", ")}
          <ArtistLink name={name} className={className} />
        </span>
      ))}
    </>
  );
}

/**
 * The artist line "A, feat. B & C": the main name as the surrounding text, the "feat." part and its
 * names dimmed, and each name its own link ("," and "&" are not). An `artist` that reads "A feat. B"
 * is split first; `featuring` is added to what it holds.
 */
export default function ArtistLinks({
  artist,
  featuring = [],
  className = "",
}: {
  artist: string;
  featuring?: string[];
  className?: string;
}) {
  const split = splitArtistFeaturing(artist);
  const names = mergeFeatured(split.featuring, featuring);
  return (
    <span className={className}>
      <ArtistLink name={split.artist} />
      {names.length > 0 && (
        <span className="opacity-75">
          {", feat. "}
          <Names names={names} />
        </span>
      )}
    </span>
  );
}

/** The small round glass chevron after an editable release's Artist field: opens that artist's page. */
export function ArtistOpenButton({ artist }: { artist: string }) {
  const { open, lockedReason } = useArtistNav();
  const name = splitArtistFeaturing(artist).artist.trim();
  const key = artistKey(name);
  if (key === "") return null;
  const label = `Open ${name}`;
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={lockedReason ? true : undefined}
      title={lockedReason ?? label}
      onClick={() => {
        if (!lockedReason) open(key);
      }}
      className="group/open glass-fake relative isolate flex size-7 shrink-0 items-center justify-center self-center rounded-full text-text opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:opacity-40"
    >
      <ChevronRightIcon className="h-3.5 w-3.5" />
    </button>
  );
}
