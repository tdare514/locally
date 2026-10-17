"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  didYouMean,
  didYouMeanButton,
  didYouMeanLine,
  matchRange,
  suggestArtists,
  trackCountLabel,
  type ArtistEntry,
} from "../lib/artist-index";
import { focusRing } from "./sidebar/controls";

const MAX_OPTIONS = 5;

/** Where the settled "Did you mean" hint shows: under the field, or as a footer inside an open list. */
export function hintPlacement(open: boolean, hint: unknown): "none" | "footer" | "line" {
  if (!hint) return "none";
  return open ? "footer" : "line";
}

export type ComboboxKeyAction =
  | { type: "none" }
  | { type: "move"; to: number }
  | { type: "open"; to: number }
  | { type: "pick"; index: number; preventDefault: boolean }
  | { type: "close" };

/**
 * What a key does in the combobox. Pure so it is testable without a DOM. A key pressed during
 * IME composition (Enter confirming a candidate, arrows moving through candidates) is never ours.
 */
export function comboboxKeyAction(
  key: string,
  isComposing: boolean,
  open: boolean,
  active: number,
  count: number,
  hasText = true
): ComboboxKeyAction {
  if (isComposing) return { type: "none" };
  if (key === "ArrowDown" || key === "ArrowUp") {
    if (count === 0 || !hasText) return { type: "none" };
    const down = key === "ArrowDown";
    if (!open) return { type: "open", to: down ? 0 : count - 1 };
    if (active === -1) return { type: "move", to: down ? 0 : count - 1 };
    return { type: "move", to: (active + (down ? 1 : -1) + count) % count };
  }
  if (open && key === "Enter" && active >= 0) return { type: "pick", index: active, preventDefault: true };
  // Takes the option and lets Tab carry on to the next field.
  if (open && key === "Tab" && active >= 0) return { type: "pick", index: active, preventDefault: false };
  if (open && key === "Escape") return { type: "close" };
  return { type: "none" };
}
/** How long typing must pause before the "Did you mean" line appears (#287). */
const HINT_PAUSE_MS = 600;

interface ArtistComboboxProps {
  value: string;
  onChange: (value: string) => void;
  /** Every artist the library holds, from AppShell; no fetch of its own. */
  index: ArtistEntry[];
  /** The input's own look, unchanged from before. */
  inputClassName: string;
  /** Where the field sits in its parent (margins, self-start); the list hangs off this box. */
  wrapperClassName?: string;
  /** The "Did you mean" line's spacing in its parent. */
  hintClassName?: string;
  ariaLabel?: string;
  id?: string;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
}

/**
 * The Artist input with suggestions from the library as you type, and one
 * "Did you mean" line under it (issue #287). An ARIA combobox: the input keeps
 * focus, the options are never tab stops.
 */
export default function ArtistCombobox({
  value,
  onChange,
  index,
  inputClassName,
  wrapperClassName = "",
  hintClassName = "",
  ariaLabel,
  id,
  placeholder,
  readOnly,
  disabled,
}: ArtistComboboxProps) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  // The text the hint was last asked about: after a pause in typing, or on blur.
  const [settled, setSettled] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const editable = !readOnly && !disabled;
  const suggestions = useMemo(() => suggestArtists(index, value, MAX_OPTIONS), [index, value]);
  const open = editable && focused && !dismissed && value.trim() !== "" && suggestions.length > 0;
  const hint = useMemo(
    () => (editable && settled === value ? didYouMean(index, value) : null),
    [editable, settled, value, index]
  );
  const placement = hintPlacement(open, hint);
  const optionId = (i: number) => `${listId}-${i}`;

  function change(next: string) {
    setDismissed(false);
    setActive(-1);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSettled(next), HINT_PAUSE_MS);
    onChange(next);
  }

  /** The footer's button: the same as taking an option, with the hint's artist. */
  function takeHint(artist: string) {
    if (timer.current) clearTimeout(timer.current);
    setDismissed(true);
    setActive(-1);
    onChange(artist);
  }

  function pick(entry: ArtistEntry) {
    if (timer.current) clearTimeout(timer.current);
    setDismissed(true);
    setActive(-1);
    onChange(entry.display);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!editable) return;
    const action = comboboxKeyAction(
      e.key,
      e.nativeEvent.isComposing || e.keyCode === 229,
      open,
      active,
      suggestions.length,
      value.trim() !== ""
    );
    switch (action.type) {
      case "open":
        e.preventDefault();
        setDismissed(false);
        setActive(action.to);
        break;
      case "move":
        e.preventDefault();
        setActive(action.to);
        break;
      case "pick":
        if (action.preventDefault) e.preventDefault();
        pick(suggestions[action.index]);
        break;
      case "close":
        e.preventDefault();
        e.stopPropagation();
        setDismissed(true);
        setActive(-1);
        break;
    }
  }

  return (
    <>
      <div className={`relative ${wrapperClassName}`}>
        <input
          id={id}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          readOnly={readOnly}
          disabled={disabled}
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setActive(-1);
            if (timer.current) clearTimeout(timer.current);
            setSettled(value);
          }}
          className={inputClassName}
        />
        {open && (
          <div className="playlist-pop glass-fake glass-frost absolute left-0 top-full z-30 isolate mt-1 w-full min-w-56 max-w-80 rounded-2xl p-1.5">
          <ul id={listId} role="listbox" aria-label="Artists in your library">
            {suggestions.map((entry, i) => {
              const range = matchRange(entry.display, value);
              return (
                <li
                  key={entry.key}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  // mousedown, not click: the input keeps focus and its text.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(entry);
                  }}
                  onMouseMove={() => setActive(i)}
                  className={`flex cursor-pointer items-baseline justify-between gap-3 rounded-lg px-3 py-1.5 text-sm ${
                    i === active ? "bg-white/[0.12]" : ""
                  }`}
                >
                  <span className="min-w-0 truncate">
                    {range ? (
                      <>
                        <span className="text-text-muted">{entry.display.slice(0, range.start)}</span>
                        <span className="text-text">{entry.display.slice(range.start, range.end)}</span>
                        <span className="text-text-muted">{entry.display.slice(range.end)}</span>
                      </>
                    ) : (
                      <span className="text-text">{entry.display}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-text-dim">{trackCountLabel(entry.trackCount)}</span>
                </li>
              );
            })}
          </ul>
          {placement === "footer" && hint && (
            // The live region below speaks for this; it is only for eyes.
            <div aria-hidden="true" className="mt-1 border-t border-white/10 px-3 pt-2 pb-1.5 text-[13px] leading-snug text-text-dim">
              {didYouMeanLine(hint)}{" "}
              <button
                type="button"
                tabIndex={-1}
                // mousedown, not click: the input keeps focus and the list closes with the pick.
                onMouseDown={(e) => {
                  e.preventDefault();
                  takeHint(hint.artist);
                }}
                className="rounded font-medium text-text-muted underline underline-offset-2 transition-colors hover:text-text"
              >
                {didYouMeanButton(hint)}
              </button>
            </div>
          )}
          </div>
        )}
      </div>
      {/* Always in the page so a screen reader hears the settled hint after the pause, open list or
          not; never blocks saving. The line shows under the field when the list is closed, and as
          a footer inside the list when it is open (the live region is then sr-only, text only). */}
      <p
        aria-live="polite"
        className={placement === "line" ? `text-[13px] leading-snug text-text-dim ${hintClassName}` : "sr-only"}
      >
        {hint && (
          <>
            {didYouMeanLine(hint)}
            {placement === "line" && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => change(hint.artist)}
                  className={`rounded font-medium text-text-muted underline underline-offset-2 transition-colors hover:text-text ${focusRing}`}
                >
                  {didYouMeanButton(hint)}
                </button>
              </>
            )}
          </>
        )}
      </p>
    </>
  );
}
