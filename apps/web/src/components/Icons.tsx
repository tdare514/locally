import { useId, type ReactNode, type SVGProps } from "react";

/** Shared attributes for every icon: a 24-unit viewBox, stroked (not filled) paths,
 * round caps/joins — matches the app's design-language icon spec so we don't need to
 * pull in an icon package for five glyphs. */
function IconBase({
  children,
  ...props
}: { children: ReactNode } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Cover drop zone: a photo (frame, sun, hill) with a circled "+" badge on its corner. The mask
 * knocks the frame out under the badge, as there is no fill colour to paint over it. */
export function ImagePlusIcon(props: SVGProps<SVGSVGElement>) {
  const maskId = useId();
  return (
    <IconBase {...props}>
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" />
        <circle cx="18" cy="18" r="5.5" fill="black" />
      </mask>
      <g mask={`url(#${maskId})`}>
        <rect x="2" y="4" width="16" height="14" rx="2" />
        <circle cx="7" cy="9" r="1.5" />
        <path d="m2 15.5 4.5-4.5a1.5 1.5 0 0 1 2 0L14 16.5" />
      </g>
      <circle cx="18" cy="18" r="4" />
      <path d="M18 16.2v3.6M16.2 18h3.6" />
    </IconBase>
  );
}

/** Audio drop zone: a cloud with an upload arrow. */
export function UploadCloudIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M17.5 19H7a5 5 0 0 1-1-9.9A6 6 0 0 1 17.6 8.2 4.5 4.5 0 0 1 17.5 19Z" />
      <path d="M12 12v7" />
      <path d="m9.5 14.5 2.5-2.5 2.5 2.5" />
    </IconBase>
  );
}

/** Row / breadcrumb affordance. */
export function ChevronRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="m9 6 6 6-6 6" />
    </IconBase>
  );
}

/** Library search field affordance. */
export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </IconBase>
  );
}

/** "Edit" pill overlay on a chosen cover. */
export function PencilIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </IconBase>
  );
}

/** "Copy" button on the release page's playlist steps. */
export function CopyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </IconBase>
  );
}

/** Track-row tile icon. */
export function MusicNoteIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </IconBase>
  );
}

/** Library list view: three rows, each a dot and a line. */
export function ListViewIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
      <path d="M9 6h11M9 12h11M9 18h11" />
    </IconBase>
  );
}

/** Library cover view: four rounded squares in a 2x2 grid, no frame. */
export function CoverGridIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </IconBase>
  );
}

/** Cover size slider, small end. */
export function CoverSmallIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="8" y="8" width="8" height="8" rx="1.5" />
    </IconBase>
  );
}

/** Cover size slider, large end. */
export function CoverLargeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
    </IconBase>
  );
}

/** Close glyph: two crossing strokes. */
export function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </IconBase>
  );
}

/** Phone inbox trigger (#115): a cloud with a down arrow. */
export function CloudDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M17.5 19H7a5 5 0 0 1-1-9.9A6 6 0 0 1 17.6 8.2 4.5 4.5 0 0 1 17.5 19Z" />
      <path d="M12 19v-7" />
      <path d="m9.5 16.5 2.5 2.5 2.5-2.5" />
    </IconBase>
  );
}

/** Add glyph: a plus, as on Spotify's own add-to-library button. */
export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14M5 12h14" />
    </IconBase>
  );
}

/** Library glyph: three upright bars, the last one leaning like a record pulled from a shelf. */
export function LibraryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M4 4v16M9 4v16M14.5 5.5l4.5 14" />
    </IconBase>
  );
}

/** Settings glyph: two sliders. */
export function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
      <circle cx="15" cy="8" r="2" />
      <circle cx="9" cy="16" r="2" />
    </IconBase>
  );
}
