import { MusicNoteIcon } from "./Icons";

/**
 * The cover of a release with no art (#294): the `card` square with the double note centred in
 * `text-dim`, about a third of the square. Fills its parent; the parent sets the size and radius
 * through `className`. Decoration only: the release's title and artist sit beside it.
 */
export default function NoCover({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`flex items-center justify-center bg-card text-text-dim ${className}`}>
      <MusicNoteIcon className="size-1/3" />
    </span>
  );
}
