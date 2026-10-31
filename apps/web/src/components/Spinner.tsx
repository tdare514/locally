import type { ReactNode } from "react";

/** A small busy ring (docs/design.md, Buttons: a busy button keeps its label and shows a spinner in
 * place of its icon). A faint full circle with a quarter arc that turns, 14 px, in the text colour of
 * whatever holds it. The turn is `.spinner` in globals.css; under reduced motion it stands still and the
 * arc still reads as busy. Decorative: put the "busy" word in a live region next to it. */
export default function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 14 14"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      className={`spinner shrink-0 ${className}`.trim()}
    >
      <circle cx={7} cy={7} r={5.5} opacity={0.25} />
      <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" />
    </svg>
  );
}

/**
 * A busy button's content (#422; docs/design.md, Buttons): the label stays and the spinner shows before it while
 * busy. Two layers share one grid cell, so the button never changes width: the spinner layer sizes the cell and the
 * label-only layer sits centred. Set `disabled` and `aria-busy` on the button, and put a {@link BusyStatus} beside it.
 */
export function BusyLabel({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <span className="inline-grid">
      <span className={`inline-flex items-center justify-center gap-2 [grid-area:1/1] ${busy ? "" : "invisible"}`}>
        <Spinner />
        {children}
      </span>
      <span className={`self-center justify-self-center [grid-area:1/1] ${busy ? "invisible" : ""}`}>{children}</span>
    </span>
  );
}

/** The busy word for screen readers, outside the button so it isn't read as part of the button's name. */
export function BusyStatus({ busy, text }: { busy: boolean; text: string }) {
  return (
    <span role="status" className="sr-only">
      {busy ? text : ""}
    </span>
  );
}
