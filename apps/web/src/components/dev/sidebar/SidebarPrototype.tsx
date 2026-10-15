"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import type { PendingFromPhone } from "../../../shared/types";
import AmbientBackdrop from "../../AmbientBackdrop";
import PhoneInbox from "../../PhoneInbox";
import { Switch } from "./controls";
import RailSidebar from "./RailSidebar";
import { SAMPLE_PALETTE } from "./sample-data";
import { CoverProvider } from "./use-stats";
import type { PanelStart } from "./use-floating-panel";

const STATES: { value: PanelStart; label: string }[] = [
  { value: "closed", label: "Closed" },
  { value: "open", label: "Open" },
  { value: "pinned", label: "Pinned" },
];

/** Sample "From your devices" items, so the tray button shows its badge and is not just a ghost. */
const SAMPLE_PENDING: PendingFromPhone[] = [
  { id: "p1", origin: "ios", title: "Harbour Demo", artist: "Okoro & the Tidemarks", kind: "single", trackCount: 1 },
  { id: "p2", origin: "web", title: "Late Trains", artist: "Juno Kessler", kind: "album", trackCount: 5 },
];

/**
 * The #154 mock app frame: a library-like pane on the cover colour wash, the rail and bloom sidebar
 * over it, and the real phone tray button at the top right (to prove nothing collides with it).
 * The bar at the bottom forces the starting state through the URL and switches Open on hover.
 */
export default function SidebarPrototype({
  start,
  covers,
}: {
  start: PanelStart;
  covers: Record<string, string>;
}) {
  const [pending, setPending] = useState(SAMPLE_PENDING);
  const [hoverReveal, setHoverReveal] = useState(true);
  // The cover palette also feeds the glass surfaces, which tint themselves from --ambient-*.
  const ambient = {
    "--ambient-primary": SAMPLE_PALETTE.primary,
    "--ambient-secondary": SAMPLE_PALETTE.secondary,
    "--ambient-deep": SAMPLE_PALETTE.deep,
  } as CSSProperties;

  return (
    <CoverProvider covers={covers}>
      <div className="relative isolate h-screen w-screen overflow-hidden" style={ambient}>
        <AmbientBackdrop palette={SAMPLE_PALETTE} />

        {/* Keyed so a forced state starts from a clean slate. */}
        <RailSidebar key={start} start={start} hoverReveal={hoverReveal} onHoverRevealChange={setHoverReveal} />

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
          {STATES.map(({ value, label }) => (
            <Link
              key={value}
              href={`/dev/sidebar?state=${value}`}
              aria-current={value === start ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 font-medium ${
                value === start ? "bg-white/[0.16] text-text" : "text-text-muted hover:text-text"
              }`}
            >
              {label}
            </Link>
          ))}
          <span aria-hidden className="mx-1 h-4 w-px bg-white/15" />
          <Switch checked={hoverReveal} onChange={setHoverReveal} className="py-1.5 pl-3 pr-2">
            Open on hover
          </Switch>
        </nav>
      </div>
    </CoverProvider>
  );
}
