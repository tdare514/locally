"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type SVGProps,
} from "react";
import { PencilIcon, PlusIcon } from "../../Icons";
import { PinIcon } from "./icons";
import { WIDGETS, type WidgetKey } from "./sample-data";

/** Class prefix of a variant. Shared pieces build their class names from it, so each variant's
 * CSS in globals.css can be lifted out on its own. */
export type Ns = "sb1" | "sb2" | "sb3";

export const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** The sidebar's Import pill, same markup and motion classes as components/Sidebar.tsx. */
export function ImportButton({ compact = false }: { compact?: boolean }) {
  return (
    <button
      type="button"
      className={`import-pill flex shrink-0 items-center justify-center gap-2 rounded-full bg-accent text-sm font-semibold hover:bg-accent-hover ${focusRing} ${
        compact ? "h-9 px-3.5" : "h-10 px-4"
      }`}
    >
      <PlusIcon className="import-plus h-4 w-4" />
      <span className="import-label">Import</span>
    </button>
  );
}

/** A Library or Settings item, styled like the existing sidebar's quiet nav items. */
export function NavItem({
  icon: Icon,
  active = false,
  className = "",
  children,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  active?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${focusRing} ${
        active ? "bg-white/[0.09] text-text" : "text-text-muted hover:bg-white/[0.06] hover:text-text"
      } ${className}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {children}
    </button>
  );
}

interface ChoiceProps<T extends string> {
  ns: Ns;
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
  ns,
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
      className={`${ns}-${kind} ${className}`}
      style={{ "--n": options.length, "--i": index } as CSSProperties}
    >
      <span aria-hidden className={`${ns}-${kind}-thumb`} />
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
  ns,
  checked,
  onChange,
  trackFirst = false,
  className = "",
  children,
}: {
  ns: Ns;
  checked: boolean;
  onChange: (next: boolean) => void;
  trackFirst?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const track = (
    <span aria-hidden className={`${ns}-switch-track`}>
      <span className={`${ns}-switch-knob`} />
    </span>
  );
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`${ns}-switch flex items-center gap-2 rounded-full text-xs font-medium text-text-muted transition-colors hover:text-text ${focusRing} ${className}`}
    >
      {trackFirst && track}
      {children}
      {!trackFirst && track}
    </button>
  );
}

/** "Edit widgets": a small popover with a switch per widget (prototype state only). */
export function EditWidgets({
  ns,
  enabled,
  onToggle,
  placement = "below",
}: {
  ns: Ns;
  enabled: Record<WidgetKey, boolean>;
  onToggle: (key: WidgetKey) => void;
  placement?: "below" | "above";
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

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
        data-placement={placement}
        className={`${ns}-pop ${placement === "below" ? "right-0 top-full mt-2" : "bottom-full left-0 mb-2"}`}
      >
        <p className="px-2.5 pb-1 pt-1.5 text-xs text-text-dim">Show in this panel</p>
        {WIDGETS.map((w) => (
          <Switch
            key={w.key}
            ns={ns}
            checked={enabled[w.key]}
            onChange={() => onToggle(w.key)}
            className="w-full justify-between rounded-xl px-2.5 py-2 text-[13px] hover:bg-white/[0.06]"
          >
            {w.title}
          </Switch>
        ))}
      </div>
    </div>
  );
}

/** The panel footer: pin it open, or stop it opening on hover (keep it closed). */
export function PanelControls({
  ns,
  pinned,
  onPinChange,
  hoverReveal,
  onHoverRevealChange,
}: {
  ns: Ns;
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
        className={`${ns}-pin flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${focusRing} ${
          pinned ? "bg-white/[0.14] text-text" : "text-text-muted hover:bg-white/[0.08] hover:text-text"
        }`}
      >
        <PinIcon className={`h-3.5 w-3.5 ${pinned ? "text-accent-hover" : ""}`} />
        {pinned ? "Pinned" : "Pin open"}
      </button>
      <Switch ns={ns} checked={hoverReveal} onChange={onHoverRevealChange} className="py-1 pl-2 pr-1">
        Open on hover
      </Switch>
    </div>
  );
}
