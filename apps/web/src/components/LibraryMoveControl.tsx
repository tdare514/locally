"use client";

import { useEffect, useState } from "react";
import { getLibraryMovePreview, moveLibrary, type LibraryMovePreview } from "../lib/api-client";
import { IS_DEMO } from "../lib/demo";
import Field from "./Field";

interface LibraryMoveControlProps {
  onToast: (kind: "success" | "error", text: string) => void;
  /** The new library folder, so the path field above can follow. */
  onMoved: (libraryDir: string) => void;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Settings > Library folder > "Move into a Locally folder" (#335): on request only, never automatic. */
export default function LibraryMoveControl({ onToast, onMoved }: LibraryMoveControlProps) {
  const [preview, setPreview] = useState<LibraryMovePreview | null>(null);
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState("");
  const [moving, setMoving] = useState(false);
  const [oldPath, setOldPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (IS_DEMO) return;
    let cancelled = false;
    getLibraryMovePreview()
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleMove() {
    setMoving(true);
    try {
      const result = await moveLibrary(destination.trim());
      setOldPath(result.from);
      setOpen(false);
      setPreview(null);
      onMoved(result.to);
      onToast("success", "Library moved");
      getLibraryMovePreview().then(setPreview).catch(() => undefined);
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Couldn't move the library");
    } finally {
      setMoving(false);
    }
  }

  async function copyOld() {
    if (!oldPath) return;
    try {
      await navigator.clipboard.writeText(oldPath);
      setCopied(true);
    } catch {
      onToast("error", "Couldn't copy the path");
    }
  }

  if (IS_DEMO) return null;
  return (
    <div className="flex flex-col gap-3">
      {oldPath && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-elevated p-3">
          <p className="text-sm text-text">In Spotify, remove the old folder from Local Files sources.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-xs text-text-muted" title={oldPath}>
              {oldPath}
            </code>
            <button type="button" onClick={copyOld} className="btn-save">
              {copied ? "Copied" : "Copy path"}
            </button>
          </div>
        </div>
      )}
      {preview?.needsMove && !preview.movable && preview.reason && (
        <p className="text-xs text-text-dim">{preview.reason}</p>
      )}
      {preview?.needsMove && preview.movable && !open && (
        <div>
          <button
            type="button"
            onClick={() => {
              setDestination(preview.destination);
              setOpen(true);
            }}
            className="btn-save"
          >
            Move into a {preview.folderName} folder
          </button>
        </div>
      )}
      {preview && open && (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-elevated p-3">
          <Field label="Move to" value={destination} onChange={setDestination} disabled={moving} />
          <p className="text-sm text-text-muted">
            This moves {plural(preview.songs, "song", "songs")} in {plural(preview.releases, "release", "releases")} to the
            folder above. Nothing is changed until you confirm.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={handleMove} disabled={moving || destination.trim().length === 0} className="btn-save">
              {moving ? "Moving…" : "Move library"}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={moving} className="btn-save">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
