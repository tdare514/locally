import type { ReactNode, SVGProps } from "react";

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

/** Cover drop zone: a picture frame with a "+" — click or drop an image. */
export function ImagePlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="2" y="4" width="14" height="14" rx="2" />
      <circle cx="7" cy="9" r="1.5" />
      <path d="M2.5 15.5 6 12a1 1 0 0 1 1.4 0L11 15.5" />
      <path d="M19 3v6M16 6h6" />
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
