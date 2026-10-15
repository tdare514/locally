/** Pure helpers behind the track list's drag and keyboard reorder (#118). No DOM, no React. */

/** `items` with the element at `from` moved to index `to`; the others keep their order. Returns
 * the same array when the move is a no-op or either index is out of range, so callers can
 * skip a state update. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const inRange = (i: number) => Number.isInteger(i) && i >= 0 && i < items.length;
  if (!inRange(from) || !inRange(to) || from === to) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The index a keyboard step from `index` lands on (`dir` -1 = up, 1 = down), or null when the
 * row is already at that end of the list. */
export function stepTarget(index: number, dir: -1 | 1, count: number): number | null {
  const target = index + dir;
  return target < 0 || target >= count ? null : target;
}

/** The slot whose centre is nearest `y`, given the slot centres top to bottom. */
export function nearestSlot(centers: readonly number[], y: number): number {
  let best = 0;
  let bestDistance = Infinity;
  centers.forEach((c, i) => {
    const distance = Math.abs(c - y);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}

/** Where the row at `index` ends up when the row at `from` is moved to `to`. */
export function slotAfterMove(index: number, from: number, to: number): number {
  if (index === from) return to;
  if (from < to && index > from && index <= to) return index - 1;
  if (from > to && index >= to && index < from) return index + 1;
  return index;
}

/** How far row `index` slides, in px, while the row at `from` is held over slot `to`. Rows
 * between the two make room by one `stride` (a row's height plus its gap) in the direction the
 * held row came from; every other row stays put. The held row itself is positioned by the
 * pointer, so it is not handled here. */
export function makeRoom(index: number, from: number, to: number, stride: number): number {
  if (index === from) return 0;
  return (slotAfterMove(index, from, to) - index) * stride;
}

/** Live-region text for a move, e.g. "Moved Intro to position 3 of 8". */
export function moveAnnouncement(title: string, position: number, count: number): string {
  return `Moved ${title.trim() || "track"} to position ${position} of ${count}`;
}

/** The rows the editor shows, in the order `tracks` gives, each keeping its own file and the
 * title the editor holds. Rows the editor no longer lists are dropped. Import uses this so the
 * files go up in the dragged order and track numbers follow position. */
export function applyTrackEdits<E extends { key: string; title: string }>(
  entries: readonly E[],
  tracks: readonly { key: string; title: string }[],
): E[] {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const next: E[] = [];
  for (const t of tracks) {
    const original = byKey.get(t.key);
    if (original) next.push({ ...original, title: t.title });
  }
  return next;
}
