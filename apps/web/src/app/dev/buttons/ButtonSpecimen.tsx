"use client";

import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import AmbientBackdrop from "../../../components/AmbientBackdrop";
import { CloudDownIcon } from "../../../components/Icons";
import type { AmbientPalette } from "../../../lib/artwork-palette";

/** Gallery of the final button set for #155. The styles live in globals.css (`.btn-save`,
 * `.btn-ink`, `.btn-ink-danger`, `.btn-icon`, `.btn-seg`). */

type Pin = "rest" | "hover" | "press" | "focus" | "disabled";
type Kind = "save" | "secondary" | "delete" | "icon" | "toggle";

const PINS: { id: Pin; label: string }[] = [
  { id: "rest", label: "Rest" },
  { id: "hover", label: "Hover" },
  { id: "press", label: "Pressed" },
  { id: "focus", label: "Focus" },
  { id: "disabled", label: "Disabled" },
];

const KINDS: { id: Kind; label: string }[] = [
  { id: "save", label: "Primary" },
  { id: "secondary", label: "Secondary" },
  { id: "delete", label: "Destructive" },
  { id: "icon", label: "Icon" },
  { id: "toggle", label: "Toggle" },
];

/** A cover palette in the shape the release page extracts: dark enough for white text. */
const WARM: AmbientPalette = { primary: "#8a431f", secondary: "#7b2f45", deep: "#2c140c" };

/** Pins a state on a button. The CSS targets data-state next to :hover, :active and
 * :focus-visible, and a disabled button is simply disabled. */
function pin(state: Pin) {
  return {
    "data-state": state === "hover" || state === "press" || state === "focus" ? state : undefined,
    disabled: state === "disabled",
  };
}

function Toggle({ state }: { state: Pin }) {
  const [value, setValue] = useState<"list" | "grid">("list");
  return (
    <div
      role="group"
      aria-label="Library layout"
      className="btn-seg"
      data-state={state === "rest" ? undefined : state}
    >
      <span aria-hidden className="btn-seg-dot">
        <span />
      </span>
      {(
        [
          { value: "list", label: "List" },
          { value: "grid", label: "Grid" },
        ] as const
      ).map(({ value: v, label }) => (
        <button
          key={v}
          type="button"
          className="btn-seg-opt"
          aria-pressed={value === v}
          disabled={state === "disabled"}
          onClick={() => setValue(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Cell({ kind, state }: { kind: Kind; state: Pin }) {
  const p = pin(state);
  switch (kind) {
    case "save":
      return (
        <button type="button" className="btn-save" {...p}>
          Save to library
        </button>
      );
    case "secondary":
      return (
        <button type="button" className="btn-ink" {...p}>
          <span className="btn-ink-label">Cancel</span>
        </button>
      );
    case "delete":
      return (
        <button type="button" className="btn-ink-danger" {...p}>
          <span className="btn-ink-label">Delete</span>
        </button>
      );
    case "icon":
      return (
        <button
          type="button"
          className="btn-icon"
          aria-label="From your devices"
          title="From your devices"
          {...p}
        >
          <CloudDownIcon className="h-[18px] w-[18px]" />
        </button>
      );
    case "toggle":
      return <Toggle state={state} />;
  }
}

/** Every kind (columns) in every pinned state (rows). */
function Sheet() {
  return (
    <div
      className="grid items-center gap-x-4 gap-y-3"
      style={{ gridTemplateColumns: "4rem repeat(5, auto)", justifyContent: "space-between" }}
    >
      <span />
      {KINDS.map((k) => (
        <span key={k.id} className="text-center text-xs text-white/60">
          {k.label}
        </span>
      ))}
      {PINS.map((s) => (
        <Fragment key={s.id}>
          <span className="text-xs text-white/60">{s.label}</span>
          {KINDS.map((k) => (
            <div key={k.id} className="flex min-h-11 items-center justify-center">
              <Cell kind={k.id} state={s.id} />
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

/** A backdrop with the sheet on top. With a palette it is the cover-colour wash the release
 * page uses, drawn twice as tall as the stage so its fade to black falls below the fold and the
 * colour carries to the last row. Without one it is the flat dark panel the dock and the Settings
 * cards sit on. */
function Stage({
  title,
  palette,
  children,
}: {
  title: string;
  palette?: AmbientPalette;
  children: ReactNode;
}) {
  const style = palette
    ? ({
        "--ambient-primary": palette.primary,
        "--ambient-secondary": palette.secondary,
        "--ambient-deep": palette.deep,
        // As the release dock does: the Save glow takes the cover's colour.
        "--btn-tint": palette.primary,
      } as CSSProperties)
    : undefined;
  return (
    <div
      className={`relative isolate overflow-hidden rounded-3xl px-6 pb-6 pt-4 ${
        palette ? "bg-black" : "border border-white/10 bg-[#0e0e12]"
      }`}
      style={style}
    >
      {palette && (
        <div aria-hidden className="absolute inset-x-0 top-0 h-[210%]">
          <AmbientBackdrop palette={palette} />
        </div>
      )}
      <p className="mb-3 text-sm text-white/70">{title}</p>
      {children}
    </div>
  );
}

export default function ButtonSpecimen() {
  return (
    <main className="mx-auto max-w-[1400px] px-8 pb-24 pt-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Buttons</h1>
        <p className="mt-2 max-w-3xl text-sm text-text-muted">
          Issue #155, the final set. Each button is shown at rest and in forced hover (the shimmer
          frozen mid-sweep), pressed, focus and disabled, on the dark panel the release dock and
          Settings cards sit on and on a cover-colour wash. The pinned states are forced so they
          can sit side by side; every button is also live, so hover, press and tab through them.
        </p>
      </header>
      <div className="mt-8 grid grid-cols-2 gap-5">
        <Stage title="Dark panel">
          <Sheet />
        </Stage>
        <Stage title="Warm cover wash" palette={WARM}>
          <Sheet />
        </Stage>
      </div>
    </main>
  );
}
