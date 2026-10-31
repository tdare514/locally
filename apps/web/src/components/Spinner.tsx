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
