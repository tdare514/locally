/**
 * Disc numbers for multi-disc releases (issue #113). Pure helpers shared by the tag writer on the
 * server and the track list on the client.
 *
 * `trackNumber` stays the release-wide position (the file key); `discNumber` is optional. The number
 * written into a file's track tag is derived per disc, and no helper here changes `trackNumber`.
 */

/** Highest disc number a record may carry. */
export const MAX_DISC_NUMBER = 99;

/** True for an integer from 1 to `MAX_DISC_NUMBER`: what a tag or a record may hold as a disc. */
export function isDiscNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_DISC_NUMBER;
}

export interface DiscTrack {
  trackNumber: number;
  discNumber?: number;
}

/** What to write into one file's tags: TRCK/trkn as `trackNumber/trackTotal`, TPOS/disk as
 * `discNumber/discTotal` when set. */
export interface TagNumbers {
  trackNumber: number;
  trackTotal: number;
  discNumber?: number;
  discTotal?: number;
}

/**
 * The tag numbers for every track, in the order `tracks` gives.
 *
 * With no `discNumber` anywhere this is exactly what the tags held before discs existed: the
 * track's own `trackNumber` over the release's track count, and no disc. Once any track has a disc,
 * a track without one counts as disc 1; each track's number becomes its 1-based position among the
 * tracks of the same disc (ordered by `trackNumber`), the total is that disc's track count, and
 * `discTotal` is the highest disc number in the release.
 */
export function deriveTagNumbers(tracks: readonly DiscTrack[]): TagNumbers[] {
  if (!tracks.some((t) => t.discNumber !== undefined)) {
    return tracks.map((t) => ({ trackNumber: t.trackNumber, trackTotal: tracks.length }));
  }

  const discOf = (t: DiscTrack) => t.discNumber ?? 1;
  const discTotal = tracks.reduce((max, t) => Math.max(max, discOf(t)), 1);
  const indicesByDisc = new Map<number, number[]>();
  tracks.forEach((t, i) => {
    const indices = indicesByDisc.get(discOf(t));
    if (indices) indices.push(i);
    else indicesByDisc.set(discOf(t), [i]);
  });

  const out: TagNumbers[] = new Array<TagNumbers>(tracks.length);
  for (const [discNumber, indices] of indicesByDisc) {
    const ordered = [...indices].sort((a, b) => tracks[a].trackNumber - tracks[b].trackNumber || a - b);
    ordered.forEach((index, rank) => {
      out[index] = { trackNumber: rank + 1, trackTotal: ordered.length, discNumber, discTotal };
    });
  }
  return out;
}

/**
 * For each row, the disc whose heading goes above it, or null for no heading. Headings appear only
 * when the rows span more than one distinct disc, and one goes above each row whose disc differs
 * from the row before it (a row with no disc counts as disc 1). Presentational: the order of the
 * rows is never changed.
 */
export function discHeadings(discs: readonly (number | undefined)[]): (number | null)[] {
  const resolved = discs.map((d) => d ?? 1);
  if (new Set(resolved).size < 2) return resolved.map(() => null);
  return resolved.map((d, i) => (i === 0 || d !== resolved[i - 1] ? d : null));
}

/**
 * `tracks` as they stand after a move, with the moved track (at `movedIndex`) joined to the disc it
 * now sits in: the disc of the track directly above it, or of the track below when it is now first.
 * Only a release that has discs is touched, and a neighbour with no disc counts as disc 1, so a
 * moved track always ends up with a number. Because a track only ever joins its neighbour's disc,
 * `discHeadings` never repeats a heading after a move. Returns a new array; the input and the
 * tracks other than the moved one are left as they are.
 */
export function adoptDiscAfterMove<T extends { discNumber?: number }>(tracks: readonly T[], movedIndex: number): T[] {
  const out = tracks.slice();
  if (!tracks.some((t) => t.discNumber !== undefined)) return out;
  const neighbour = movedIndex > 0 ? tracks[movedIndex - 1] : tracks[movedIndex + 1];
  if (!neighbour || movedIndex < 0 || movedIndex >= tracks.length) return out;
  const disc = neighbour.discNumber ?? 1;
  if (tracks[movedIndex].discNumber !== disc) out[movedIndex] = { ...tracks[movedIndex], discNumber: disc };
  return out;
}

/** An imported file as far as ordering cares: the disc and track number its own tags carry. */
export interface TaggedForOrder {
  discNumber?: number;
  tagTrackNumber?: number;
}

/**
 * The files in (disc, the file's own track number) order, for an import whose files carry disc
 * tags. The sort is stable, so files that tie keep the order they came in, and a file with no
 * track tag sorts after the numbered files of its disc. When no file has a disc tag the order is
 * returned untouched ("files without disc tags behave as today"). The caller then assigns
 * continuous `trackNumber` values from the new positions.
 */
export function orderByDisc<T extends TaggedForOrder>(files: readonly T[]): T[] {
  if (!files.some((f) => f.discNumber !== undefined)) return files.slice();
  const last = Number.MAX_SAFE_INTEGER;
  return files
    .map((file, index) => ({ file, index }))
    .sort(
      (a, b) =>
        (a.file.discNumber ?? 1) - (b.file.discNumber ?? 1) ||
        (a.file.tagTrackNumber ?? last) - (b.file.tagTrackNumber ?? last) ||
        a.index - b.index,
    )
    .map((e) => e.file);
}
