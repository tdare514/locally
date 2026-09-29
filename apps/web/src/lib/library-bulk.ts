/**
 * Pure helpers for Mac library bulk actions (issue #7): build the shared
 * details patch, run an operation over many releases without stopping at the
 * first failure, and word the resulting toast.
 */
import type { Release, UpdateReleaseMeta } from "../shared/types";

/** Raw field text from the bulk edit dialog; "" means leave unchanged. */
export interface BulkDetails {
  artist: string;
  year: string;
  genre: string;
}

/** Trimmed non-empty fields become the patch; returns null when nothing would change. */
export function bulkDetailsPatch(
  details: BulkDetails,
): UpdateReleaseMeta | null {
  const patch: UpdateReleaseMeta = {};
  const artist = details.artist.trim();
  const year = details.year.trim();
  const genre = details.genre.trim();
  if (artist !== "") patch.artist = artist;
  if (year !== "") patch.year = year;
  if (genre !== "") patch.genre = genre;
  return Object.keys(patch).length === 0 ? null : patch;
}

export interface BulkOutcome {
  done: number;
  failed: { id: string; title: string; error: string }[];
}

/** Runs `op` on each release in order, never throwing; collects per-item failures. */
export async function runBulk(
  releases: Release[],
  op: (release: Release) => Promise<unknown>,
): Promise<BulkOutcome> {
  const outcome: BulkOutcome = { done: 0, failed: [] };
  for (const release of releases) {
    try {
      await op(release);
      outcome.done += 1;
    } catch (e) {
      outcome.failed.push({
        id: release.id,
        title: release.title || release.artist,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }
  return outcome;
}

const MAX_LISTED_TITLES = 3;

function plural(n: number): string {
  return `${n} release${n === 1 ? "" : "s"}`;
}

/**
 * Toast copy: "Deleted 3 releases" / "Updated 1 release" /
 * "Deleted 2 of 3 releases; failed: Title A". `verb` is the past participle.
 */
export function bulkSummary(
  verb: string,
  outcome: BulkOutcome,
  total: number,
): { kind: "success" | "error"; text: string } {
  if (outcome.failed.length === 0) {
    return { kind: "success", text: `${verb} ${plural(outcome.done)}` };
  }
  const titles = outcome.failed.slice(0, MAX_LISTED_TITLES).map((f) => f.title);
  const extra = outcome.failed.length - titles.length;
  const listed =
    extra > 0 ? `${titles.join(", ")} and ${extra} more` : titles.join(", ");
  return {
    kind: "error",
    text: `${verb} ${outcome.done} of ${plural(total)}; failed: ${listed}`,
  };
}
