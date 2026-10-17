"use client";

import { useRef, useState } from "react";
import type { ArtistEntry } from "../lib/artist-index";
import { addFeatured, commitDraft, featuredKeyAction, removeFeatured, removeLastFeatured } from "../lib/featuring-field";
import ArtistCombobox from "./ArtistCombobox";
import { XIcon } from "./Icons";
import { focusRing } from "./sidebar/controls";

interface FeaturedFieldProps {
  names: string[];
  onChange: (names: string[]) => void;
  /** Every artist in the library, for the name input's suggestions. */
  index: ArtistEntry[];
  /** The input's id, so a visible label can point at it. */
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  readOnly?: boolean;
  inputClassName: string;
}

/**
 * The names as small glass pills, each with a remove button, and a trailing artist input (#287).
 * Enter or "," adds the typed name; Backspace in the empty input removes the last pill.
 */
export default function FeaturedField({
  names,
  onChange,
  index,
  id,
  ariaLabel,
  placeholder = "Add a featured artist",
  readOnly,
  inputClassName,
}: FeaturedFieldProps) {
  const [draft, setDraft] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  function focusInput() {
    wrapRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (readOnly || (e.target as HTMLElement).tagName !== "INPUT") return;
    // The combobox took this key itself (picking an option): nothing more to do with it.
    if (e.defaultPrevented) return;
    const action = featuredKeyAction(e.key, draft, names.length > 0, e.nativeEvent.isComposing || e.keyCode === 229);
    if (action === "add") {
      e.preventDefault();
      onChange(addFeatured(names, draft));
      setDraft("");
    } else if (action === "removeLast") {
      e.preventDefault();
      onChange(removeLastFeatured(names));
    }
  }

  // Focus leaving the input (a click on Save, Tab, a pill's remove button) keeps what was typed.
  // Picking a suggestion is a mousedown with preventDefault, so it never blurs.
  function onBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (readOnly || (e.target as HTMLElement).tagName !== "INPUT" || draft.trim() === "") return;
    const next = commitDraft(names, draft);
    setDraft(next.draft);
    if (next.names !== names) onChange(next.names);
  }

  return (
    <div ref={wrapRef} onKeyDown={onKeyDown} onBlur={onBlur} className="flex min-w-0 flex-wrap items-center gap-1.5">
      {names.map((name, i) => (
        <span
          key={`${name}-${i}`}
          className="inline-flex items-center gap-0.5 rounded-full border border-white/15 bg-white/10 py-0.5 pl-2.5 pr-1 text-sm font-semibold text-text"
        >
          {name}
          {!readOnly && (
            <button
              type="button"
              aria-label={`Remove ${name}`}
              onClick={() => {
                onChange(removeFeatured(names, i));
                focusInput();
              }}
              className={`flex size-5 items-center justify-center rounded-full text-text-muted outline-none hover:bg-white/10 hover:text-text ${focusRing}`}
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </span>
      ))}
      <ArtistCombobox
        id={id}
        ariaLabel={ariaLabel}
        value={draft}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={setDraft}
        index={index}
        wrapperClassName="max-w-full"
        hintClassName="basis-full"
        inputClassName={inputClassName}
      />
    </div>
  );
}
