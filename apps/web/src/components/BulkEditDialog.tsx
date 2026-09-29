"use client";

import { useEffect, useRef, useState } from "react";
import { bulkDetailsPatch, type BulkDetails } from "../lib/library-bulk";
import Field from "./Field";

interface BulkEditDialogProps {
  open: boolean;
  count: number;
  busy: boolean;
  onCancel: () => void;
  onApply: (details: BulkDetails) => void;
}

/**
 * Modal for editing Artist, Year and Genre on several releases at once
 * (issue #7). Blank fields are left unchanged. Native <dialog>, same pattern
 * as CoverCropDialog.
 */
export default function BulkEditDialog({
  open,
  count,
  busy,
  onCancel,
  onApply,
}: BulkEditDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Keep the native dialog's open state in sync with the `open` prop.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Escape goes through onCancel so the parent's `editing` flag stays in sync.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    function handleCancelEvent(e: Event) {
      e.preventDefault();
      onCancel();
    }
    dialog.addEventListener("cancel", handleCancelEvent);
    return () => dialog.removeEventListener("cancel", handleCancelEvent);
  }, [onCancel]);

  return (
    <dialog
      ref={dialogRef}
      className="m-auto max-w-none rounded-[9px] border border-dialog-border bg-card p-0 text-text backdrop:bg-black/70"
    >
      {/* Mounted only while open, so the fields start empty on every open. */}
      {open && (
        <BulkEditForm
          count={count}
          busy={busy}
          onCancel={onCancel}
          onApply={onApply}
        />
      )}
    </dialog>
  );
}

function BulkEditForm({
  count,
  busy,
  onCancel,
  onApply,
}: Omit<BulkEditDialogProps, "open">) {
  const [artist, setArtist] = useState("");
  const [year, setYear] = useState("");
  const [genre, setGenre] = useState("");
  const [showError, setShowError] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const details = { artist, year, genre };
    if (bulkDetailsPatch(details) === null) {
      setShowError(true);
      return;
    }
    setShowError(false);
    onApply(details);
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-[420px] flex-col gap-4 p-6">
      <h2 className="text-lg font-bold">
        Edit {count} release{count === 1 ? "" : "s"}
      </h2>
      <p className="text-sm text-text-muted">
        Blank fields are left unchanged. Tracks are re-tagged in place; files
        keep their names.
      </p>
      <Field
        label="Artist"
        value={artist}
        onChange={setArtist}
        placeholder="Leave unchanged"
        disabled={busy}
      />
      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Year"
          value={year}
          onChange={setYear}
          placeholder="Leave unchanged"
          disabled={busy}
        />
        <Field
          label="Genre"
          value={genre}
          onChange={setGenre}
          placeholder="Leave unchanged"
          disabled={busy}
        />
      </div>
      {showError && (
        <p role="alert" className="text-xs text-danger">
          Fill in at least one field.
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-full px-4 py-2 text-sm text-text-muted transition-colors hover:text-text disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-accent px-6 py-2.5 text-sm font-bold text-black transition-colors hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Applying…" : `Apply to ${count}`}
        </button>
      </div>
    </form>
  );
}
