import type { ReactNode, SVGProps } from "react";

/** The few glyphs the sidebar (#154) needs that components/Icons.tsx does not have. Same
 * conventions as that file: 24-unit viewBox, stroked paths, round caps. */
function IconBase({ children, ...props }: { children: ReactNode } & SVGProps<SVGSVGElement>) {
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

/** Three lines: opens the sidebar. */
export function MenuIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </IconBase>
  );
}

/** A thumbtack, upright. */
export function PinIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M9.5 3.5h5M10.5 3.5 10 10l-3 3.5h10L14 10l-.5-6.5M12 13.5V21" />
    </IconBase>
  );
}

/** Three bars of different heights: the stream stats. */
export function StatsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M5.5 19v-6M12 19V5M18.5 19v-9" />
    </IconBase>
  );
}
