"use client";

export interface EditableTrack {
  /** Stable identifier for this row — a release track's `id`, or a locally-generated key
   * for a not-yet-imported file. Travels with the row when the list is reordered. */
  key: string;
  title: string;
}

interface TrackListProps {
  tracks: EditableTrack[];
  onChange: (tracks: EditableTrack[]) => void;
  /** When provided, each row gets a remove button (used while importing, before upload). */
  onRemove?: (index: number) => void;
}

/** A reorderable (up/down buttons, no drag library) list of editable track titles.
 * Track numbers are implicit: they always equal the row's position (1-based). */
export default function TrackList({ tracks, onChange, onRemove }: TrackListProps) {
  function updateTitle(index: number, title: string) {
    const next = tracks.slice();
    next[index] = { ...next[index], title };
    onChange(next);
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= tracks.length) return;
    const next = tracks.slice();
    const tmp = next[index];
    next[index] = next[target];
    next[target] = tmp;
    onChange(next);
  }

  if (tracks.length === 0) {
    return <p className="text-sm text-text-muted">No tracks yet.</p>;
  }

  return (
    <ol className="flex flex-col gap-1">
      {tracks.map((track, index) => (
        <li
          key={track.key}
          className="flex items-center gap-2 rounded-md bg-elevated px-3 py-2"
        >
          <span className="w-6 shrink-0 text-right text-sm tabular-nums text-text-muted">
            {index + 1}
          </span>
          <input
            type="text"
            value={track.title}
            onChange={(e) => updateTitle(index, e.target.value)}
            placeholder="Track title"
            className="min-w-0 flex-1 rounded bg-transparent px-2 py-1 text-sm text-text outline-none focus:bg-panel"
          />
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => move(index, -1)}
              disabled={index === 0}
              className="rounded px-1.5 py-1 text-text-muted hover:text-text disabled:opacity-30"
              aria-label="Move track up"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(index, 1)}
              disabled={index === tracks.length - 1}
              className="rounded px-1.5 py-1 text-text-muted hover:text-text disabled:opacity-30"
              aria-label="Move track down"
            >
              ↓
            </button>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(index)}
                className="rounded px-1.5 py-1 text-text-muted hover:text-danger"
                aria-label="Remove track"
              >
                ✕
              </button>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
