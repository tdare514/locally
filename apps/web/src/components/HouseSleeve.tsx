/**
 * The cover of a release with no art (#249): a neutral sleeve with the accent record label in the
 * middle, like the release page's disc before it has a cover. Fills its parent; the parent sets the
 * size and radius through `className`. Decoration only.
 */
export default function HouseSleeve({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`relative flex items-center justify-center bg-elevated ${className}`}
    >
      <span className="relative block size-[46%] rounded-full bg-accent shadow-[0_0_0_2px_rgb(0_0_0/0.35)]">
        <span className="absolute inset-[42%] rounded-full bg-bg" />
      </span>
    </span>
  );
}
