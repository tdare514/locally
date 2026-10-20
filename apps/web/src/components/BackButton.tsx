"use client";

import { ChevronLeftIcon } from "./Icons";

/** The twin of PhoneInbox's cloud button, in the pane's top-left corner (#258). */
export default function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="group glass-fake relative isolate flex h-[var(--tray-size)] w-[var(--tray-size)] items-center justify-center rounded-full text-text transition-[filter] hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-safe:active:scale-95"
    >
      <span className="flex motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-hover:-translate-x-0.5">
        <ChevronLeftIcon className="h-5 w-5" />
      </span>
    </button>
  );
}
