/**
 * The 20 px tick of the review page (#249): the library selection's checkbox shape, a circle.
 * `accent` with a black check when ticked, a bar when some of a group is ticked, a 1.5 px white 30 %
 * ring when not. The check scales 0.6 to 1 with opacity (see `.tick-mark` in globals.css).
 * Presentational: the row or button around it carries the checkbox role.
 */
export default function Tick({ state }: { state: "all" | "none" | "mixed" }) {
  const filled = state !== "none";
  return (
    <span
      aria-hidden="true"
      className={`flex size-5 shrink-0 items-center justify-center rounded-full ${
        filled ? "bg-accent" : "ring-[1.5px] ring-inset ring-white/30"
      }`}
    >
      {state === "all" && (
        <svg viewBox="0 0 16 16" className="tick-mark size-3" fill="none">
          <path d="M3.5 8.5l3 3 6-7" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {state === "mixed" && (
        <svg viewBox="0 0 16 16" className="tick-mark size-3" fill="none">
          <path d="M4 8h8" stroke="black" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}
