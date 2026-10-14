"use client";

import { useEffect, useRef, useState } from "react";
import CoverCropDialog from "./CoverCropDialog";
import { ImagePlusIcon, MusicNoteIcon, PencilIcon } from "./Icons";

/** How the square is drawn. Sizes match `docs/design.md`: the compact import
 * square beside title and artist is 120, the release-header thumb is 112, and the
 * release page's record sleeve is 200 (248 from `sm`). */
export type CoverPresentation = "compact" | "thumb" | "sleeve";

interface CoverPickerProps {
  /** A freshly-chosen (not yet uploaded) cover file, if any. */
  file: File | null;
  /** URL of an already-stored cover (e.g. from `coverUrl()`), shown when `file` is null. */
  existingUrl?: string | null;
  onChange: (file: File) => void;
  disabled?: boolean;
  /** Demo: no editing and no pencil badge, but the cover is not dimmed. */
  readOnly?: boolean;
  /** `compact` sits beside title and artist on import. `thumb` is a small
   * header cover. `sleeve` is the release page's hero cover (#112). */
  presentation: CoverPresentation;
}

/** Fixed side in px, or null when the size is responsive (set by `frameClass`). */
function sideFor(presentation: CoverPresentation): number | null {
  if (presentation === "sleeve") return null;
  return presentation === "thumb" ? 112 : 120;
}

function frameClass(presentation: CoverPresentation, dragOver: boolean): string {
  if (presentation === "sleeve") {
    return `record-sleeve size-[200px] rounded-[4px] bg-card sm:size-[248px] ${
      dragOver ? "ring-2 ring-accent" : ""
    }`;
  }
  const radius = presentation === "thumb" ? "rounded-[10px]" : "rounded-lg";
  if (presentation === "thumb") {
    return `${radius} border border-border bg-card ${dragOver ? "ring-2 ring-accent" : ""}`;
  }
  const dashed = dragOver ? "border-accent" : "border-border-dashed";
  return `${radius} border border-dashed bg-card ${dashed}`;
}

/** 28 px circular pencil, inset on the thumb (and on a filled compact square). */
function PencilBadge() {
  return (
    <span className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/80 text-white backdrop-blur-sm">
      <PencilIcon className="h-3 w-3" />
    </span>
  );
}

/** Square cover art preview. Click to choose a file, or drag one in.
 * `compact` (import): a dashed 120 square with an image-plus icon and "Click or
 * drop an image", plus a pencil badge once filled. `thumb` (release header): a
 * 112 square with a pencil badge. `sleeve` (release page hero): a printed-sleeve
 * square that cross-fades to a new cover, "Add cover art" when empty. */
export default function CoverPicker({
  file,
  existingUrl,
  onChange,
  disabled,
  readOnly,
  presentation,
}: CoverPickerProps) {
  const inert = disabled || readOnly;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  // A freshly-chosen file awaiting confirmation in the crop dialog. `onChange` only fires once
  // the user hits Done there; Cancel drops this and leaves `file` (the prop) untouched.
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const side = sideFor(presentation);

  useEffect(() => {
    // Derives a revocable object URL from the `file` prop and must clean it up on change/unmount,
    // so it can't be expressed as plain render-time derived state.
    if (!file) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const previewUrl = objectUrl ?? existingUrl ?? null;

  // Sleeve only: the outgoing cover stays underneath while the new one fades in, so a swap
  // reads as one sleeve replacing another rather than a hard cut.
  const [layers, setLayers] = useState({ current: previewUrl, previous: null as string | null });
  if (layers.current !== previewUrl) {
    setLayers({ current: previewUrl, previous: layers.current });
  }

  function acceptFiles(files: FileList | null) {
    if (inert || !files || files.length === 0) return;
    const first = files[0];
    if (!first.type.startsWith("image/")) return;
    setPendingFile(first);
  }

  return (
    <>
      <div
        onClick={() => !inert && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!inert) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          acceptFiles(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={inert ? -1 : 0}
        title={readOnly ? "Not available in the demo" : undefined}
        aria-label={previewUrl ? "Edit cover" : "Choose cover image"}
        style={side === null ? undefined : { width: side, height: side }}
        className={`relative flex shrink-0 cursor-pointer items-center justify-center overflow-hidden text-center transition-colors ${frameClass(
          presentation,
          dragOver
        )} ${disabled ? "cursor-not-allowed opacity-60" : ""} ${readOnly ? "!cursor-default" : ""}`}
      >
        {/* Object URLs / local API image routes aren't compatible with next/image's optimizer. */}
        {presentation === "sleeve" && previewUrl ? (
          <>
            {layers.previous && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={layers.previous}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={previewUrl}
              src={previewUrl}
              alt=""
              onAnimationEnd={() => setLayers((l) => ({ ...l, previous: null }))}
              className="cover-in relative h-full w-full object-cover"
            />
          </>
        ) : previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        ) : presentation === "sleeve" ? (
          <div className="flex flex-col items-center gap-2 px-6">
            <ImagePlusIcon
              className={`h-8 w-8 ${dragOver ? "text-accent" : "text-text-muted"}`}
            />
            <p className="text-sm font-semibold text-text">Add cover art</p>
            <p className="text-xs leading-snug text-text-muted">Drop an image or click to choose</p>
          </div>
        ) : presentation === "thumb" ? (
          <MusicNoteIcon className="h-7 w-7 text-text-muted" />
        ) : (
          <div className="flex flex-col items-center gap-1 px-2">
            <ImagePlusIcon
              className={`h-6 w-6 ${dragOver ? "text-accent" : "text-text-muted"}`}
            />
            <p className="text-center text-[11px] font-medium leading-tight text-text-soft">
              Click or drop an image
            </p>
          </div>
        )}
        {!readOnly && (presentation === "thumb" || previewUrl) ? (
          <PencilBadge />
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          disabled={inert}
          onChange={(e) => {
            acceptFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <CoverCropDialog
        file={pendingFile}
        onCancel={() => setPendingFile(null)}
        onDone={(cropped) => {
          setPendingFile(null);
          onChange(cropped);
        }}
      />
    </>
  );
}
