"use client";

/** Import opens here (#159): a bare disc, one action and one quiet line. No form and no drop box;
 * the whole pane takes a dropped file (ImportView owns the drop). Fades in behind the accent wash
 * (`.imp-invite`, #122). */
export default function ImportInvitation({
  over,
  onAdd,
}: {
  /** Audio is being dragged over the pane. */
  over: boolean;
  onAdd: () => void;
}) {
  return (
    <section
      aria-label="Import"
      className="relative mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center text-center"
    >
      <h1 className="sr-only">Import</h1>
      <div className="imp-invite flex flex-col items-center gap-9">
        {/* The default record: the disc on its own, accent house label, nothing printed yet. */}
        <div
          aria-hidden
          className={`relative size-44 transition-opacity duration-300 ${over ? "opacity-100" : "opacity-70"}`}
        >
          <div className="record-face">
            <div className="record-label" />
          </div>
          <div className="record-sheen" />
        </div>
        <div className="flex flex-col items-center gap-3">
          <button type="button" onClick={onAdd} className="btn-save btn-glow">
            Add a track
          </button>
          <p className={`text-sm transition-colors duration-300 ${over ? "text-text" : "text-text-muted"}`}>
            or drop audio files here
          </p>
        </div>
      </div>
    </section>
  );
}
