"use client";

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import AmbientSpace from "../AmbientSpace";
import { INVITE_PALETTE } from "../../lib/import-flow";

/** "on" before there is a cover, "out" while the first cover's beat fades it away, "off" after. */
export type SkyState = "on" | "out" | "off";

/** The library's drifting colour sky (AmbientSpace), in calm accent tones, for the Import page
 * until its first cover (#159). The library's own sky lives in AppShell, outside the scrolling
 * pane, so it paints under the see-through sidebar too; this one is portalled into the same
 * element (the full-window shell, `[data-app-shell]`, found from where this renders) to sit exactly there. If the shell
 * is not found it renders nothing and the page simply has no sky. */
export default function ImportSky({ state }: { state: SkyState }) {
  const [shell, setShell] = useState<Element | null>(null);
  const anchor = useCallback((el: HTMLSpanElement | null) => {
    setShell(el ? el.closest("[data-app-shell]") : null);
  }, []);

  return (
    <>
      <span ref={anchor} hidden />
      {shell &&
        createPortal(
          <div aria-hidden className="imp-sky" data-sky={state}>
            <AmbientSpace palette={INVITE_PALETTE} />
          </div>,
          shell,
        )}
    </>
  );
}
