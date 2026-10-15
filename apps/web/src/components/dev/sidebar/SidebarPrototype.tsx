"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import type { PendingFromPhone } from "../../../shared/types";
import AmbientBackdrop from "../../AmbientBackdrop";
import PhoneInbox from "../../PhoneInbox";
import { SAMPLE_PALETTE } from "./sample-data";
import { CoverProvider } from "./use-stats";
import type { PanelStart } from "./use-floating-panel";
import Variant1 from "./Variant1";
import Variant2 from "./Variant2";
import Variant3 from "./Variant3";

export type VariantNumber = 1 | 2 | 3;

const VARIANTS: { n: VariantNumber; label: string }[] = [
  { n: 1, label: "Floating panel" },
  { n: 2, label: "Rail and bloom" },
  { n: 3, label: "Stats shelf" },
];

const STATES: { value: PanelStart; label: string }[] = [
  { value: "closed", label: "Closed" },
  { value: "open", label: "Open" },
  { value: "pinned", label: "Pinned" },
];

/** Sample "From your phone" items, so the tray button shows its badge and is not just a ghost. */
const SAMPLE_PENDING: PendingFromPhone[] = [
  { id: "p1", title: "Harbour Demo", artist: "Okoro & the Tidemarks", kind: "single", trackCount: 1 },
  { id: "p2", title: "Late Trains", artist: "Juno Kessler", kind: "album", trackCount: 5 },
];

/**
 * The #154 mock app frame: a library-like pane on the cover colour wash, the variant's sidebar
 * floating over it, and the real phone tray button at the top right (to prove nothing collides
 * with it). The bar at the bottom switches variant and forced state through the URL.
 */
export default function SidebarPrototype({
  variant,
  start,
  covers,
}: {
  variant: VariantNumber;
  start: PanelStart;
  covers: Record<string, string>;
}) {
  const [pending, setPending] = useState(SAMPLE_PENDING);
  // The cover palette also feeds the glass surfaces, which tint themselves from --ambient-*.
  const ambient = {
    "--ambient-primary": SAMPLE_PALETTE.primary,
    "--ambient-secondary": SAMPLE_PALETTE.secondary,
    "--ambient-deep": SAMPLE_PALETTE.deep,
  } as CSSProperties;
  // Keyed so a new variant or forced state starts from a clean slate.
  const key = `${variant}-${start}`;

  return (
    <CoverProvider covers={covers}>
      <div className="relative isolate h-screen w-screen overflow-hidden" style={ambient}>
        <AmbientBackdrop palette={SAMPLE_PALETTE} />

        {variant === 1 && <Variant1 key={key} start={start} />}
        {variant === 2 && <Variant2 key={key} start={start} />}
        {variant === 3 && <Variant3 key={key} start={start} />}

        <div className="absolute right-4 top-4 z-20 md:right-6 md:top-6">
          <PhoneInbox
            pending={pending}
            onAccept={async (id) => {
              setPending((prev) => prev.filter((p) => p.id !== id));
              return true;
            }}
          />
        </div>

        <nav
          aria-label="Prototype controls"
          className="absolute bottom-4 right-4 z-40 flex items-center gap-1 whitespace-nowrap rounded-full bg-black/70 p-1 text-xs shadow-[0_10px_30px_-10px_rgb(0_0_0/0.9)] ring-1 ring-white/10"
        >
          <span className="px-3 text-text-dim">Sidebar prototype (#154)</span>
          {VARIANTS.map(({ n, label }) => (
            <Link
              key={n}
              href={`/dev/sidebar?v=${n}&state=${start}`}
              aria-current={n === variant ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 font-medium ${
                n === variant ? "bg-white/[0.16] text-text" : "text-text-muted hover:text-text"
              }`}
            >
              {n} {label}
            </Link>
          ))}
          <span aria-hidden className="mx-1 h-4 w-px bg-white/15" />
          {STATES.map(({ value, label }) => (
            <Link
              key={value}
              href={`/dev/sidebar?v=${variant}&state=${value}`}
              aria-current={value === start ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 font-medium ${
                value === start ? "bg-white/[0.16] text-text" : "text-text-muted hover:text-text"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </CoverProvider>
  );
}
