"use client";

import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import AmbientBackdrop from "../../../components/AmbientBackdrop";
import { CloudDownIcon, CoverGridIcon, ListViewIcon } from "../../../components/Icons";
import { NEUTRAL_PALETTE, type AmbientPalette } from "../../../lib/artwork-palette";

/** Button specimen for #155. The styles live in globals.css (`.btn-a-*`, `.btn-b-*`, `.btn-c-*`). */

type Direction = "a" | "b" | "c";
type Pin = "rest" | "hover" | "press" | "focus" | "disabled";
type Kind = "save" | "select" | "secondary" | "delete" | "icon" | "toggle";

const PINS: { id: Pin; label: string }[] = [
  { id: "rest", label: "Rest" },
  { id: "hover", label: "Hover" },
  { id: "press", label: "Pressed" },
  { id: "focus", label: "Focus" },
  { id: "disabled", label: "Disabled" },
];

const KINDS: { id: Kind; label: string }[] = [
  { id: "save", label: "Primary" },
  { id: "select", label: "Short primary" },
  { id: "secondary", label: "Secondary" },
  { id: "delete", label: "Destructive" },
  { id: "icon", label: "Icon" },
  { id: "toggle", label: "Toggle" },
];

/** Cover palettes in the shape the release page extracts: dark enough for white text. */
const WARM: AmbientPalette = { primary: "#8a431f", secondary: "#7b2f45", deep: "#2c140c" };
const COOL: AmbientPalette = { primary: "#1f6283", secondary: "#2d3f94", deep: "#0a1626" };

/** Pins a state on a button. The CSS targets data-state next to :hover, :active and
 * :focus-visible, and a disabled button is simply disabled. */
function pin(state: Pin) {
  return {
    "data-state": state === "hover" || state === "press" || state === "focus" ? state : undefined,
    disabled: state === "disabled",
  };
}

function Toggle({ dir, state }: { dir: Direction; state: Pin }) {
  const [value, setValue] = useState<"list" | "grid">("list");
  const options = [
    { value: "list", label: "List view", text: "List", Icon: ListViewIcon },
    { value: "grid", label: "Cover view", text: "Grid", Icon: CoverGridIcon },
  ] as const;
  return (
    <div
      role="group"
      aria-label="Library layout"
      className={`btn-${dir}-seg`}
      data-value={value}
      data-state={state === "rest" ? undefined : state}
    >
      {dir === "a" && <span aria-hidden className="btn-a-seg-thumb" />}
      {dir === "b" && (
        <span aria-hidden className="btn-b-seg-line">
          <span />
        </span>
      )}
      {dir === "c" && (
        <span aria-hidden className="btn-c-seg-dot">
          <span />
        </span>
      )}
      {options.map(({ value: v, label, text, Icon }) => (
        <button
          key={v}
          type="button"
          className={`btn-${dir}-seg-opt`}
          aria-pressed={value === v}
          aria-label={label}
          title={label}
          disabled={state === "disabled"}
          onClick={() => setValue(v)}
        >
          {dir === "c" ? text : <Icon className="h-4 w-4" />}
        </button>
      ))}
    </div>
  );
}

function Cell({ dir, kind, state }: { dir: Direction; kind: Kind; state: Pin }) {
  const p = pin(state);
  switch (kind) {
    case "save":
    case "select": {
      const text = kind === "save" ? "Save to library" : "Select";
      const chip = dir === "b" && kind === "save";
      return (
        <button type="button" className={`btn-${dir}-primary`} {...p}>
          {chip && <span aria-hidden className="btn-b-chip" />}
          <span>{text}</span>
        </button>
      );
    }
    case "secondary":
      if (dir === "c") {
        return (
          <button type="button" className="btn-c-text" {...p}>
            <span className="btn-c-label">Show in Finder</span>
          </button>
        );
      }
      return (
        <button type="button" className={dir === "a" ? "btn-a-glass" : "btn-b-ghost"} {...p}>
          Show in Finder
        </button>
      );
    case "delete":
      if (dir === "c") {
        return (
          <button type="button" className="btn-c-text btn-c-danger" {...p}>
            <span className="btn-c-label">Delete</span>
          </button>
        );
      }
      return (
        <button type="button" className={dir === "a" ? "btn-a-danger" : "btn-b-danger"} {...p}>
          Delete
        </button>
      );
    case "icon":
      return (
        <button
          type="button"
          className={`btn-${dir}-icon`}
          aria-label="From your phone"
          title="From your phone"
          {...p}
        >
          <CloudDownIcon className="h-[18px] w-[18px]" />
        </button>
      );
    case "toggle":
      return <Toggle dir={dir} state={state} />;
  }
}

/** Every kind (columns) in every pinned state (rows). */
function Sheet({ dir, pins = PINS }: { dir: Direction; pins?: typeof PINS }) {
  return (
    <div
      className="grid items-center gap-x-2.5 gap-y-3"
      style={{ gridTemplateColumns: "3.75rem repeat(6, auto)", justifyContent: "space-between" }}
    >
      <span />
      {KINDS.map((k) => (
        <span key={k.id} className="text-center text-xs text-white/60">
          {k.label}
        </span>
      ))}
      {pins.map((s) => (
        <Fragment key={s.id}>
          <span className="text-xs text-white/60">{s.label}</span>
          {KINDS.map((k) => (
            <div key={k.id} className="flex min-h-11 items-center justify-center">
              <Cell dir={dir} kind={k.id} state={s.id} />
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

/** A cover-colour wash with the sheet on top. The palette goes to the backdrop and, as the same
 * custom properties, to the stage itself, so the buttons can read it: AmbientBackdrop only sets
 * them on its own element. The backdrop is drawn twice as tall as the stage so its fade to black
 * falls below the fold and the colour carries to the last row. */
function Stage({
  title,
  palette,
  cover = true,
  className = "",
  children,
}: {
  title: string;
  palette: AmbientPalette;
  cover?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const style = {
    "--ambient-primary": palette.primary,
    "--ambient-secondary": palette.secondary,
    "--ambient-deep": palette.deep,
  } as CSSProperties;
  return (
    <div
      className={`btn-b-scope relative isolate overflow-hidden rounded-3xl bg-black px-6 pb-6 pt-4 ${className}`}
      style={style}
      data-cover={cover ? "on" : undefined}
    >
      <div aria-hidden className="absolute inset-x-0 top-0 h-[210%]">
        <AmbientBackdrop palette={palette} />
      </div>
      <p className="mb-3 text-sm text-white/70">{title}</p>
      {children}
    </div>
  );
}

function DirectionSection({
  id,
  dir,
  title,
  blurb,
  withFallback = false,
}: {
  id: string;
  dir: Direction;
  title: string;
  blurb: string;
  withFallback?: boolean;
}) {
  return (
    <section id={id} className="mt-14 scroll-mt-6">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 max-w-3xl text-sm text-text-muted">{blurb}</p>
      <div className="mt-5 grid grid-cols-2 gap-5">
        <Stage title="Warm cover" palette={WARM}>
          <Sheet dir={dir} />
        </Stage>
        <Stage title="Cool cover" palette={COOL}>
          <Sheet dir={dir} />
        </Stage>
        {withFallback && (
          <Stage
            title="No cover: the fills fall back to the accent blue"
            palette={NEUTRAL_PALETTE}
            cover={false}
            className="col-span-2"
          >
            <Sheet dir={dir} pins={PINS.slice(0, 2)} />
          </Stage>
        )}
      </div>
    </section>
  );
}

export default function ButtonSpecimen() {
  return (
    <main className="mx-auto max-w-[1600px] px-8 pb-24 pt-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Button directions</h1>
        <p className="mt-2 max-w-3xl text-sm text-text-muted">
          Issue #155. Each direction is a full set in rest, hover, pressed, focus and disabled. The
          pinned states are forced so they can sit side by side; every button is also live, so hover,
          press and tab through them.
        </p>
        <nav className="mt-4 flex gap-6 text-sm">
          <a href="#a" className="text-accent hover:underline">
            Pressed vinyl
          </a>
          <a href="#b" className="text-accent hover:underline">
            Cover-tinted
          </a>
          <a href="#c" className="text-accent hover:underline">
            Soft ink
          </a>
        </nav>
      </header>
      <DirectionSection
        id="a"
        dir="a"
        title="Pressed vinyl"
        blurb="Depth on solid. A lit blue primary, clear glass for everything else, and a glass track with a sliding thumb."
      />
      <DirectionSection
        id="b"
        dir="b"
        withFallback
        title="Cover-tinted"
        blurb="Content-led. Fills, hairlines and glows come from the cover palette, and a small cover chip marks the save button."
      />
      <DirectionSection
        id="c"
        dir="c"
        title="Soft ink"
        blurb="Editorial and quiet. One matte, grainy primary; everything else is ink with a line that draws in."
      />
    </main>
  );
}
