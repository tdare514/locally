"use client";

import { useEffect, useRef, useState } from "react";
import {
  initialRect,
  panned,
  zoomed,
  type CoverRatio,
  type Rect,
  type Size,
} from "../lib/crop-geometry";
import { cropImage } from "../lib/crop-image";

interface CoverCropDialogProps {
  /** The freshly-chosen file to frame. The dialog is open exactly when this is non-null. */
  file: File | null;
  /** Called with the cropped output once the user confirms. */
  onDone: (file: File) => void;
  /** Called on Cancel or Escape; the caller should discard the pending file. */
  onCancel: () => void;
}

/** Side, in CSS pixels, of the longer edge of the crop viewport. */
const VIEWPORT_MAX = 320;

function segmentClass(active: boolean): string {
  return `rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
    active ? "bg-accent text-black" : "text-text-muted hover:text-text"
  }`;
}

/** Modal cover-crop step: shows the chosen image behind a fixed square (or original-ratio) frame,
 * with drag-to-pan and wheel/pinch-to-zoom, mirroring the iOS app's `CoverCropView` /
 * `CropGeometry` so both apps frame a cover the same way. */
export default function CoverCropDialog({
  file,
  onDone,
  onCancel,
}: CoverCropDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(
    null,
  );

  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<Size | null>(null);
  const [ratio, setRatio] = useState<CoverRatio>("square");
  const [rect, setRect] = useState<Rect | null>(null);
  const [cropping, setCropping] = useState(false);

  // Derives a revocable object URL from the `file` prop, and resets crop state for the new image.
  // Must run as an effect (cleanup on change/unmount), so it can't be expressed as render-time
  // derived state.
  useEffect(() => {
    if (!file) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setImgSrc(null);
      setImageSize(null);
      setRect(null);
      setRatio("square");
      return;
    }
    const url = URL.createObjectURL(file);
    setImgSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Imperatively keep the native <dialog> open state in sync with whether there's a pending file.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (file && !dialog.open) {
      dialog.showModal();
    } else if (!file && dialog.open) {
      dialog.close();
    }
  }, [file]);

  // Escape (and any other native dismissal) should go through onCancel rather than let the
  // dialog close itself, so the parent's pending-file state stays in sync with dialog.open.
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

  // Latest geometry, readable from the native (non-passive) wheel listener below without
  // re-subscribing it on every zoom/pan.
  const latestRef = useRef({ rect, imageSize, ratio });
  useEffect(() => {
    latestRef.current = { rect, imageSize, ratio };
  });

  // Wheel = zoom, centred on the cursor. Registered as a non-passive native listener (React's
  // synthetic wheel handler is passive) so we can preventDefault and stop the page/browser from
  // scrolling or pinch-zooming behind the modal.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      const { rect, imageSize, ratio } = latestRef.current;
      if (!rect || !imageSize) return;
      const scale = displayScaleFor(rect);
      if (scale <= 0) return;
      const bounds = viewport!.getBoundingClientRect();
      const point = {
        x: rect.x + (e.clientX - bounds.left) / scale,
        y: rect.y + (e.clientY - bounds.top) / scale,
      };
      // Trackpad pinch is delivered as a wheel event with ctrlKey set; give it a bit more
      // sensitivity than a physical mouse wheel notch.
      const sensitivity = e.ctrlKey ? 0.02 : 0.01;
      const factor = Math.exp(-e.deltaY * sensitivity);
      setRect(zoomed(rect, factor, point, ratio, imageSize));
    }
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, []);

  function handleImgLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    const size: Size = { width: img.naturalWidth, height: img.naturalHeight };
    setImageSize(size);
    setRatio("square");
    setRect(initialRect(size, "square"));
  }

  function handleRatioChange(next: CoverRatio) {
    setRatio(next);
    if (imageSize) setRect(initialRect(imageSize, next));
  }

  function displayScaleFor(r: Rect): number {
    if (r.width <= 0) return 0;
    const viewportWidth =
      r.width >= r.height ? VIEWPORT_MAX : (VIEWPORT_MAX * r.width) / r.height;
    return viewportWidth / r.width;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!rect) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !rect || !imageSize) return;
    const scale = displayScaleFor(rect);
    if (scale <= 0) return;
    const dxScreen = e.clientX - drag.x;
    const dyScreen = e.clientY - drag.y;
    dragRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    setRect(
      panned(rect, { dx: -dxScreen / scale, dy: -dyScreen / scale }, imageSize),
    );
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  }

  async function handleDone() {
    if (!file || !rect) return;
    setCropping(true);
    try {
      const cropped = await cropImage(file, rect, { maxSide: 1500 });
      onDone(cropped);
    } catch (err) {
      console.error("Failed to crop cover image", err);
    } finally {
      setCropping(false);
    }
  }

  let viewportWidth = VIEWPORT_MAX;
  let viewportHeight = VIEWPORT_MAX;
  let imageScale = 0;
  if (rect) {
    if (rect.width >= rect.height) {
      viewportWidth = VIEWPORT_MAX;
      viewportHeight = Math.round((VIEWPORT_MAX * rect.height) / rect.width);
    } else {
      viewportHeight = VIEWPORT_MAX;
      viewportWidth = Math.round((VIEWPORT_MAX * rect.width) / rect.height);
    }
    imageScale = viewportWidth / rect.width;
  }

  return (
    <dialog
      ref={dialogRef}
      className="m-auto max-w-none overflow-visible rounded-lg border border-border bg-panel p-0 text-text backdrop:bg-black/70"
    >
      <div className="flex w-[360px] flex-col gap-4 p-5">
        <h2 className="text-lg font-bold">Crop cover</h2>

        <div
          ref={viewportRef}
          className="relative mx-auto touch-none select-none overflow-hidden rounded-md bg-black"
          style={{
            width: viewportWidth,
            height: viewportHeight,
            cursor: "grab",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {imgSrc && (
            // Object URLs aren't compatible with next/image's optimizer.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgSrc}
              alt=""
              draggable={false}
              onLoad={handleImgLoad}
              className="absolute left-0 top-0 max-w-none select-none"
              style={
                rect && imageSize
                  ? {
                      width: imageSize.width * imageScale,
                      height: imageSize.height * imageScale,
                      transform: `translate(${-rect.x * imageScale}px, ${-rect.y * imageScale}px)`,
                    }
                  : { visibility: "hidden" }
              }
            />
          )}
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <div className="inline-flex rounded-full bg-elevated p-1">
            <button
              type="button"
              onClick={() => handleRatioChange("square")}
              className={segmentClass(ratio === "square")}
            >
              Square
            </button>
            <button
              type="button"
              onClick={() => handleRatioChange("original")}
              className={segmentClass(ratio === "original")}
            >
              Original
            </button>
          </div>
          <p className="text-center text-xs text-text-muted">
            Spotify shows covers as a square.
          </p>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-5 py-2 text-sm font-medium text-text-muted transition-colors hover:text-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDone}
            disabled={!rect || cropping}
            className="rounded-full bg-accent px-6 py-2 text-sm font-bold text-black transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {cropping ? "Cropping…" : "Done"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
