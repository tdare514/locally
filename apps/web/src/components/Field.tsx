"use client";

import type { InputHTMLAttributes } from "react";

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: InputHTMLAttributes<HTMLInputElement>["type"];
  disabled?: boolean;
}

/** A labelled text input, styled to match the rest of the app. */
export default function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
}: FieldProps) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      <span className="text-xs font-bold uppercase tracking-[0.14em] text-text-muted">
        {label}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md bg-elevated px-4 py-3 text-sm text-text outline-none placeholder:text-text-muted/60 focus:ring-2 focus:ring-accent disabled:opacity-50"
      />
    </label>
  );
}
