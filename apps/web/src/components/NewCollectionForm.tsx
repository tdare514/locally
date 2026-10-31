"use client";

import { useEffect, useRef, useState } from "react";
import { COLLECTION_NAME_MAX, cleanCollectionName } from "../shared/collections";

/** A name field and its Create button (#349): used inside the Add to collection list and the Collections page. */
export default function NewCollectionForm({
  onCreate,
  onCancel,
  submitLabel = "Create",
  autoFocus = true,
}: {
  onCreate: (name: string) => Promise<unknown> | void;
  onCancel?: () => void;
  submitLabel?: string;
  autoFocus?: boolean;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const clean = cleanCollectionName(name);
  return (
    <form
      className="flex flex-wrap items-center gap-2 p-1"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!clean || busy) return;
        setBusy(true);
        try {
          await onCreate(clean);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        ref={ref}
        type="text"
        value={name}
        maxLength={COLLECTION_NAME_MAX}
        aria-label="Collection name"
        placeholder="Name your collection"
        onChange={(e) => setName(e.target.value)}
        className="min-h-11 min-w-0 flex-1 rounded-lg bg-elevated px-3 text-sm text-text outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-accent"
      />
      <button type="submit" disabled={!clean || busy} className="btn-ink min-h-11 min-w-11">
        {busy ? "Making…" : submitLabel}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} className="btn-ink min-h-11 min-w-11">
          Cancel
        </button>
      )}
    </form>
  );
}
