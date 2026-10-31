"use client";

/**
 * The one on/off switch (#409, the 30 Oct 2026 rules): the sidebar's knob switch (`.sb-switch-*`
 * in globals.css), an accent track and a white knob, in a 44 target. Settings and the share dialog
 * use it for every on/off choice; the caller names it with `labelledBy` (the id of its visible label).
 */
export default function KnobSwitch({
  checked,
  onChange,
  disabled,
  labelledBy,
  describedBy,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  labelledBy: string;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onClick={onChange}
      disabled={disabled}
      className="sb-switch group flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center outline-none disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        aria-hidden
        className="sb-switch-track group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-accent"
      >
        <span className="sb-switch-knob" />
      </span>
    </button>
  );
}
