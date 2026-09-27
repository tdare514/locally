"use client";

import { useEffect, useRef, useState } from "react";
import CoverCropDialog from "./CoverCropDialog";
import { ImagePlusIcon, PencilIcon } from "./Icons";

interface CoverPickerProps {
  /** A freshly-chosen (not yet uploaded) cover file, if any. */
  file: File | null;
  /** URL of an already-stored cover (e.g. from `coverUrl()`), shown when `file` is null. */
  existingUrl?: string | null;
  onChange: (file: File) => void;
  disabled?: boolean;
  /** Side of the square, in px. Import's drop zone uses the default 240; the release page's
   * cover uses 180. */
  size?: number;
}

/** Square cover art preview. Click to choose a file, or drag one in.
 * Empty: a dashed drop zone with an image-plus icon. Filled: the image with an "Edit"
 * pill overlay in the bottom-right corner (used both for a freshly-picked cover and an
 * already-stored one on the release page). */
export default function CoverPicker({
  file,
  existingUrl,
  onChange,
  disabled,
  size = 240,
}: CoverPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  // A freshly-chosen file awaiting confirmation in the crop dialog. `onChange` only fires once
  // the user hits Done there; Cancel drops this and leaves `file` (the prop) untouched.
  const [pendingFile, setPendingFile] = useState<File | null>(null);

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
        tabIndex={0}
        style={{ width: size, height: size }}
        className={`relative flex shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg bg-card text-center transition-colors ${
          previewUrl
            ? dragOver
              ? "ring-2 ring-accent"
              : ""
            : `border border-dashed ${dragOver ? "border-accent" : "border-border-dashed"}`
        } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      >
        {previewUrl ? (
          <>
            {/* Object URLs / local API image routes aren't compatible with next/image's optimizer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Cover art preview"
              className="h-full w-full object-cover"
            />
            <span className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full bg-black/80 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur-sm">
              <PencilIcon className="h-3.5 w-3.5" />
              Edit
            </span>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 px-4">
            <ImagePlusIcon
              className={`h-[30px] w-[30px] ${dragOver ? "text-accent" : "text-text-muted"}`}
            />
            <p className="text-sm font-medium text-[#D7D7D7]">Click or drop an image</p>
            <p className="text-xs text-text-hint">Square artwork works best</p>
          </div>
        )}
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
