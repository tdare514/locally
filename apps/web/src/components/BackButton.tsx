"use client";

import { ChevronLeftIcon } from "./Icons";

/** The twin of PhoneInbox's cloud button, in the pane's top-left corner (#258): a bare chevron, no glass (#409). */
export default function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="btn-icon group"
    >
      <span className="flex motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-hover:-translate-x-0.5">
        <ChevronLeftIcon className="h-5 w-5" />
      </span>
    </button>
  );
}
