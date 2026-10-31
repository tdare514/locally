"use client";

import { useId } from "react";
import type { ArtistEntry } from "../lib/artist-index";
import FeaturedField from "./FeaturedField";

interface FeaturingRowProps {
  names: string[];
  onChange: (names: string[]) => void;
  index: ArtistEntry[];
  readOnly?: boolean;
  /** Extra classes for the empty input (the import page's faint underline). */
  inputExtraClassName?: string;
  /** Release page (#288): each pill's name is a link to that artist's page. */
  linkNames?: boolean;
}

/** A single's Featuring row under its Artist (#287): the same label style as Year and Genre. */
export default function FeaturingRow({ names, onChange, index, readOnly, inputExtraClassName = "", linkNames }: FeaturingRowProps) {
  const inputId = useId();
  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1.5 text-[15px]">
      <label htmlFor={inputId} className="text-white/70">
        Featuring
      </label>
      <FeaturedField
        id={inputId}
        names={names}
        onChange={onChange}
        index={index}
        readOnly={readOnly}
        linkNames={linkNames}
        inputClassName={`field-sizing-content min-w-[18ch] max-w-full rounded-lg bg-transparent px-1.5 py-0.5 font-semibold text-text outline-none transition-colors placeholder:font-normal placeholder:text-white/50 hover:bg-white/[0.07] focus:bg-white/10 focus:ring-2 focus:ring-accent ${inputExtraClassName}`}
      />
    </div>
  );
}
