"use client";

import { useEffect, useRef, useState } from "react";
import { bulkDetailsPatch, type BulkDetails } from "../lib/library-bulk";
import Field from "./Field";
import ReleaseDateField from "./ReleaseDateField";
import { releaseDateTextBlocks } from "../lib/release-date-input";
import ArtistCombobox from "./ArtistCombobox";
import type { ArtistEntry } from "../lib/artist-index";

interface BulkEditDialogProps {
  open: boolean;
  count: number;
  busy: boolean;
  onCancel: () => void;
  onApply: (details: BulkDetails) => void;
  /** Every artist in the library, for the Artist field's suggestions (#287). */
  artistIndex: ArtistEntry[];
}

/**
 * Modal for editing Artist, Release date and Genre on several releases at once
 * (issue #7). Blank fields are left unchanged. Native <dialog>, same pattern
 * as CoverCropDialog.
 */
export default function BulkEditDialog({
  open,
  count,
  busy,
  onCancel,
  onApply,
  artistIndex,
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
      className="m-auto max-w-none glass-fake glass-frost isolate dialog-in rounded-2xl p-0 text-text backdrop:bg-black/70"
    >
      {/* Mounted only while open, so the fields start empty on every open. */}
      {open && (
        <BulkEditForm
          count={count}
          busy={busy}
          onCancel={onCancel}
          onApply={onApply}
          artistIndex={artistIndex}
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
  artistIndex,
}: Omit<BulkEditDialogProps, "open">) {
  const [artist, setArtist] = useState("");
  const [year, setYear] = useState("");
  const [genre, setGenre] = useState("");
  const [showError, setShowError] = useState(false);
  // Text that is not a date holds Apply; the field says why.
  const dateBlocked = releaseDateTextBlocks(year);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || dateBlocked) return;
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
      <div className="flex flex-col gap-2 text-sm">
        <label htmlFor="bulk-artist" className="text-xs font-bold uppercase tracking-[0.14em] text-text-muted">
          Artist
        </label>
        <ArtistCombobox
          id="bulk-artist"
          value={artist}
          onChange={setArtist}
          index={artistIndex}
          placeholder="Leave unchanged"
          disabled={busy}
          wrapperClassName="flex flex-col"
          inputClassName="rounded-md bg-elevated px-4 py-3 text-sm text-text outline-none placeholder:text-text-muted/60 focus:ring-2 focus:ring-accent disabled:opacity-50"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <ReleaseDateField
          variant="form"
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
          className="btn-ink"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || dateBlocked}
          className="btn-save"
        >
          {busy ? "Applying…" : `Apply to ${count}`}
        </button>
      </div>
    </form>
  );
}
