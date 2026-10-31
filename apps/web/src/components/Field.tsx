"use client";

import type { InputHTMLAttributes } from "react";

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: InputHTMLAttributes<HTMLInputElement>["type"];
  disabled?: boolean;
  /** Plain 14 px label in place of the 13 px semibold one. */
  plainLabel?: boolean;
}

/** A labelled text input, styled to match the rest of the app. */
export default function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
  plainLabel,
}: FieldProps) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      <span className={plainLabel ? "text-sm text-text-muted" : "text-[13px] font-semibold text-text-muted"}>
        {label}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg bg-elevated px-4 py-3 text-sm text-text outline-none placeholder:text-text-muted focus:ring-2 focus:ring-accent disabled:opacity-50"
      />
    </label>
  );
}
