"use client";

import { useEffect, useRef, useState } from "react";
import CoverCropDialog from "./CoverCropDialog";
import { ImagePlusIcon, MusicNoteIcon, PencilIcon } from "./Icons";

/** How the square is drawn. Sizes match `docs/design.md`: the full import drop
 * zone is 240, the compact import square beside title and artist is 120, and
 * the release-header thumb is 112. */
export type CoverPresentation = "drop" | "compact" | "thumb";

interface CoverPickerProps {
  /** A freshly-chosen (not yet uploaded) cover file, if any. */
  file: File | null;
  /** URL of an already-stored cover (e.g. from `coverUrl()`), shown when `file` is null. */
  existingUrl?: string | null;
  onChange: (file: File) => void;
  disabled?: boolean;
  /**
   * Side of the square, in px. Defaults from `presentation`: 240 drop, 120
   * compact, 112 thumb.
   */
  size?: number;
  /** `drop` is the full zone. `compact` sits beside title and artist on import.
   * `thumb` is the release-page header cover. */
  presentation?: CoverPresentation;
}

function defaultSize(presentation: CoverPresentation): number {
  if (presentation === "thumb") return 112;
  if (presentation === "compact") return 120;
  return 240;
}

function frameClass(
  presentation: CoverPresentation,
  hasPreview: boolean,
  dragOver: boolean
): string {
  const radius = presentation === "thumb" ? "rounded-[10px]" : "rounded-lg";
  if (presentation === "thumb") {
    return `${radius} border border-border bg-card ${dragOver ? "ring-2 ring-accent" : ""}`;
  }
  const dashed = dragOver ? "border-accent" : "border-border-dashed";
  if (!hasPreview || presentation === "compact") {
    return `${radius} border border-dashed bg-card ${dashed}`;
  }
  return `${radius} bg-card ${dragOver ? "ring-2 ring-accent" : ""}`;
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
 * Empty drop zone: dashed card, image-plus icon, caption. Filled drop zone: the
 * image with an "Edit" pill. Compact and thumb are the smaller header squares. */
export default function CoverPicker({
  file,
  existingUrl,
  onChange,
  disabled,
  size,
  presentation = "drop",
}: CoverPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  // A freshly-chosen file awaiting confirmation in the crop dialog. `onChange` only fires once
  // the user hits Done there; Cancel drops this and leaves `file` (the prop) untouched.
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const side = size ?? defaultSize(presentation);

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

  function acceptFiles(files: FileList | null) {
    if (disabled || !files || files.length === 0) return;
    const first = files[0];
    if (!first.type.startsWith("image/")) return;
    setPendingFile(first);
  }

  return (
    <>
      <div
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          acceptFiles(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={previewUrl ? "Edit cover" : "Choose cover image"}
        style={{ width: side, height: side }}
        className={`relative flex shrink-0 cursor-pointer items-center justify-center overflow-hidden text-center transition-colors ${frameClass(
          presentation,
          previewUrl !== null,
          dragOver
        )} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      >
        {previewUrl ? (
          // Object URLs / local API image routes aren't compatible with next/image's optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        ) : presentation === "thumb" ? (
          <MusicNoteIcon className="h-7 w-7 text-text-muted" />
        ) : presentation === "compact" ? (
          <div className="flex flex-col items-center gap-1 px-2">
            <ImagePlusIcon
              className={`h-6 w-6 ${dragOver ? "text-accent" : "text-text-muted"}`}
            />
            <p className="text-center text-[11px] font-medium leading-tight text-[#D7D7D7]">
              Click or drop an image
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 px-4">
            <ImagePlusIcon
              className={`h-[30px] w-[30px] ${dragOver ? "text-accent" : "text-text-muted"}`}
            />
            <p className="text-sm font-medium text-[#D7D7D7]">Click or drop an image</p>
            <p className="text-xs text-text-hint">Square artwork works best</p>
          </div>
        )}
        {presentation === "thumb" || (previewUrl && presentation === "compact") ? (
          <PencilBadge />
        ) : null}
        {previewUrl && presentation === "drop" ? (
          <span className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full bg-black/80 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur-sm">
            <PencilIcon className="h-3.5 w-3.5" />
            Edit
          </span>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          disabled={disabled}
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
