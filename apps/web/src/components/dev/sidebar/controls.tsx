"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { PencilIcon } from "../../Icons";
import { PinIcon } from "./icons";
import { WIDGETS, type WidgetKey } from "./sample-data";

export const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** A full-width row in the column's stack (Library, Import, Settings, Stats), styled like the
 * existing sidebar's quiet nav items: a label and a soft pill on the active one. No icon: each row
 * sits level with its icon on the rail beside it, so the rail is the compact view of the same
 * list. `end` is a quiet note at the right, inside the same hit area. Every row has the same
 * height, hover and focus ring; the active page also gets `aria-current="page"`. */
export function NavItem({
  active = false,
  onClick,
  end,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  end?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors ${focusRing} ${
        active ? "bg-white/[0.1] text-text" : "text-text-muted hover:bg-white/[0.07] hover:text-text"
      }`}
    >
      <span className="flex-1">{children}</span>
      {end}
    </button>
  );
}

interface ChoiceProps<T extends string> {
  /** `seg` is a segmented control (a radio group); `tabs` is a row of text tabs. */
  kind: "seg" | "tabs";
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}

/** One choice out of a few, with a thumb that slides on transform. Arrow keys move the choice. */
export function Choice<T extends string>({
  kind,
  label,
  value,
  options,
  onChange,
  className = "",
}: ChoiceProps<T>) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const dir =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (index + dir + options.length) % options.length;
    onChange(options[next].value);
    e.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  }

  return (
    <div
      role={kind === "seg" ? "radiogroup" : "tablist"}
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`sb-${kind} ${className}`}
      style={{ "--n": options.length, "--i": index } as CSSProperties}
    >
      <span aria-hidden className={`sb-${kind}-thumb`} />
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role={kind === "seg" ? "radio" : "tab"}
            {...(kind === "seg" ? { "aria-checked": selected } : { "aria-selected": selected })}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={`relative z-10 whitespace-nowrap text-xs font-semibold transition-colors ${focusRing} ${
              kind === "seg" ? "rounded-full py-1.5" : "rounded-md py-1.5"
            } ${selected ? "text-text" : "text-text-muted hover:text-text-soft"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** An on/off switch with its label. The knob slides on transform. */
export function Switch({
  checked,
  onChange,
  locked = false,
  className = "",
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Stays focusable and announced, but a click does nothing (the last widget cannot go off). */
  locked?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={locked || undefined}
      onClick={() => {
        if (!locked) onChange(!checked);
      }}
      className={`sb-switch flex items-center gap-2 rounded-full text-xs font-medium text-text-muted transition-colors ${
        locked ? "opacity-60" : "hover:text-text"
      } ${focusRing} ${className}`}
    >
      {children}
      <span aria-hidden className="sb-switch-track">
        <span className="sb-switch-knob" />
      </span>
    </button>
  );
}

/** "Edit widgets": a small popover with a switch per widget (prototype state only). The one widget
 * left on is locked, so at least one always shows. */
export function EditWidgets({
  enabled,
  onToggle,
}: {
  enabled: Record<WidgetKey, boolean>;
  onToggle: (key: WidgetKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const onCount = WIDGETS.filter((w) => enabled[w.key]).length;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: globalThis.PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    // Escape closes the popover first. Listening in the capture phase and marking the event handled
    // means the panel's own Escape handler (see use-floating-panel) leaves the panel open.
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${focusRing} ${
          open ? "bg-white/[0.12] text-text" : "text-text-muted hover:bg-white/[0.08] hover:text-text"
        }`}
      >
        <PencilIcon className="h-3 w-3" />
        Edit widgets
      </button>
      <div
        id={id}
        role="group"
        aria-label="Widgets to show"
        data-state={open ? "open" : "closed"}
        className="sb-pop right-0 top-full mt-2"
      >
        <p className="px-2.5 pb-1 pt-1.5 text-xs text-text-dim">Show in this panel</p>
        {WIDGETS.map((w) => (
          <Switch
            key={w.key}
            checked={enabled[w.key]}
            onChange={() => onToggle(w.key)}
            locked={enabled[w.key] && onCount === 1}
            className="w-full justify-between rounded-xl px-2.5 py-2 text-[13px] hover:bg-white/[0.06]"
          >
            {w.title}
          </Switch>
        ))}
        {onCount === 1 && <p className="px-2.5 pb-1.5 pt-1 text-xs text-text-dim">At least one stays on.</p>}
      </div>
    </div>
  );
}

/** The panel footer: pin it open, or stop it opening on hover (keep it closed). */
export function PanelControls({
  pinned,
  onPinChange,
  hoverReveal,
  onHoverRevealChange,
}: {
  pinned: boolean;
  onPinChange: (next: boolean) => void;
  hoverReveal: boolean;
  onHoverRevealChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        aria-pressed={pinned}
        onClick={() => onPinChange(!pinned)}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${focusRing} ${
          pinned ? "bg-white/[0.14] text-text" : "text-text-muted hover:bg-white/[0.08] hover:text-text"
        }`}
      >
        <PinIcon className={`h-3.5 w-3.5 ${pinned ? "text-accent-hover" : ""}`} />
        {pinned ? "Pinned" : "Pin open"}
      </button>
      <Switch checked={hoverReveal} onChange={onHoverRevealChange} className="py-1 pl-2 pr-1">
        Open on hover
      </Switch>
    </div>
  );
}
