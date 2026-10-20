// Pure logic for the "Your Spotify folders" review page (#249): grouping, ticks, batching, copy.
// No DOM and no fetch, so it is tested in node.
import type { AdoptProposal, ProposedGroup } from "../server/adopt/types";
import type { Release } from "../shared/types";

/** Groups sent to POST /api/adopt per request. */
export const ADOPT_BATCH_SIZE = 20;

/** Shown under a failed row when the whole batch got no answer. */
export const NO_ANSWER_MESSAGE = "Couldn't reach Locally.";
/** Shown under a row the server no longer has in its findings. */
export const UNKNOWN_KEY_MESSAGE = "Locally no longer has this in its findings.";

export interface ReviewRow {
  group: ProposedGroup;
  /** The folder below the review group ("Summer EP"), "" when the files sit straight in it. */
  subfolder: string;
}

export interface ReviewGroup {
  /** Stable id: the root and the first folder under it. */
  id: string;
  /** "Masters", or the Spotify folder's own name for files straight in it. */
  name: string;
  rows: ReviewRow[];
}

const collator = { sensitivity: "base", numeric: true } as const;
const compare = (a: string, b: string) => a.localeCompare(b, undefined, collator);

// Paths are absolute and normalised by the server (path.resolve), so plain "/" string work is enough here;
// node:path is not available in the browser bundle.
function trimSlash(p: string): string {
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

/** `folder` relative to `root` ("" for the root itself), or null when it is not inside. */
function relativeTo(root: string, folder: string): string | null {
  const r = trimSlash(root);
  const f = trimSlash(folder);
  if (f === r) return "";
  const prefix = r === "/" ? "/" : `${r}/`;
  return f.startsWith(prefix) ? f.slice(prefix.length) : null;
}

function baseName(p: string): string {
  const t = trimSlash(p);
  return t.slice(t.lastIndexOf("/") + 1) || t;
}

/** The longest root that holds `folder`, or null. */
function rootOf(roots: readonly string[], folder: string): string | null {
  let best: string | null = null;
  for (const root of roots) {
    if (relativeTo(root, folder) === null) continue;
    if (best === null || root.length > best.length) best = root;
  }
  return best;
}

/**
 * Releases grouped by the first folder under each Spotify folder, in the order of `roots` then by name.
 * Files straight in a Spotify folder group under that folder's own name. A group outside every root
 * (a root removed since the scan) is grouped under its own folder's name.
 */
export function groupForReview(roots: readonly string[], groups: readonly ProposedGroup[]): ReviewGroup[] {
  const byId = new Map<string, ReviewGroup & { order: number }>();
  for (const group of groups) {
    const root = rootOf(roots, group.folder) ?? group.folder;
    const rel = relativeTo(root, group.folder) ?? "";
    const segments = rel === "" ? [] : rel.split("/");
    const first = segments[0];
    const id = `${root}\u0000${first ?? ""}`;
    let entry = byId.get(id);
    if (!entry) {
      const rootIndex = roots.indexOf(root);
      entry = { id, name: first ?? baseName(root), rows: [], order: rootIndex === -1 ? roots.length : rootIndex };
      byId.set(id, entry);
    }
    entry.rows.push({ group, subfolder: segments.slice(1).join("/") });
  }
  const out = [...byId.values()].sort((a, b) => a.order - b.order || compare(a.name, b.name));
  for (const g of out) {
    g.rows.sort(
      (a, b) =>
        compare(a.subfolder, b.subfolder) ||
        compare(a.group.title, b.group.title) ||
        compare(a.group.key, b.group.key)
    );
  }
  return out.map(({ id, name, rows }) => ({ id, name, rows }));
}

/** Drops the groups already in the library (a release whose `adoptKey` matches). */
export function hideAdded(groups: readonly ProposedGroup[], releases: readonly Release[]): ProposedGroup[] {
  const added = new Set(releases.flatMap((r) => (r.adoptKey ? [r.adoptKey] : [])));
  return groups.filter((g) => !added.has(g.key));
}

export type TickState = "all" | "none" | "mixed";

export function groupTickState(keys: readonly string[], ticked: ReadonlySet<string>): TickState {
  const n = keys.filter((k) => ticked.has(k)).length;
  if (n === 0) return "none";
  return n === keys.length ? "all" : "mixed";
}

/** The group tick from mixed or unticked ticks all; from all it unticks all. */
export function toggleGroupTicks(keys: readonly string[], ticked: ReadonlySet<string>): Set<string> {
  const next = new Set(ticked);
  if (groupTickState(keys, ticked) === "all") for (const k of keys) next.delete(k);
  else for (const k of keys) next.add(k);
  return next;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** What POST /api/adopt answers, as far as the page needs it. */
export interface AdoptBatchResponse {
  releases: { adoptKey?: string }[];
  alreadyAdopted: string[];
  unknown: string[];
  failed: { key: string; message: string }[];
}

export interface AdoptRun {
  /** Keys now in the library, including those that already were. */
  added: Set<string>;
  /** Keys that stay ticked, with the message shown under them. */
  failed: Map<string, string>;
  /** True when the run stopped early because the page went away. */
  stopped: boolean;
}

/**
 * Sends `keys` in batches, one after another. `alreadyAdopted` counts as added. A batch with no answer
 * (the request threw) fails all its keys with NO_ANSWER_MESSAGE and the run goes on. Before each batch,
 * `shouldContinue()` is asked: once it says no, nothing more is sent.
 */
export async function runAdoption(opts: {
  keys: readonly string[];
  send: (keys: string[]) => Promise<AdoptBatchResponse>;
  shouldContinue?: () => boolean;
  onProgress?: (done: number, total: number) => void;
  batchSize?: number;
}): Promise<AdoptRun> {
  const { keys, send, shouldContinue = () => true, onProgress, batchSize = ADOPT_BATCH_SIZE } = opts;
  const run: AdoptRun = { added: new Set(), failed: new Map(), stopped: false };
  let done = 0;
  for (const batch of chunk(keys, batchSize)) {
    if (!shouldContinue()) {
      run.stopped = true;
      break;
    }
    onProgress?.(done, keys.length);
    try {
      const res = await send(batch);
      for (const release of res.releases) if (release.adoptKey && batch.includes(release.adoptKey)) run.added.add(release.adoptKey);
      for (const key of res.alreadyAdopted) run.added.add(key);
      for (const key of res.unknown) run.failed.set(key, UNKNOWN_KEY_MESSAGE);
      for (const f of res.failed) run.failed.set(f.key, f.message);
      // A key the answer does not mention at all is not claimed as added.
      for (const key of batch) {
        if (!run.added.has(key) && !run.failed.has(key)) run.failed.set(key, NO_ANSWER_MESSAGE);
      }
    } catch {
      for (const key of batch) run.failed.set(key, NO_ANSWER_MESSAGE);
    }
    done += batch.length;
  }
  onProgress?.(done, keys.length);
  return run;
}

// --- copy -------------------------------------------------------------------------------------

const count = new Intl.NumberFormat("en-US");

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${count.format(n)} ${n === 1 ? one : many}`;
}

export function foundTitle(releases: number): string {
  return `Found ${plural(releases, "release")}`;
}

/** "1,567 tracks in 3 folders. Locally adds their details and leaves the files where they are." */
export function foundLine(groups: readonly ProposedGroup[], folders: number): string {
  const tracks = groups.reduce((n, g) => n + g.tracks.length, 0);
  return `${plural(tracks, "track")} in ${plural(folders, "folder")}. Locally adds their details and leaves the files where they are.`;
}

export function selectedLine(selected: number, total: number): string {
  return `${count.format(selected)} of ${count.format(total)} selected`;
}

export function addLabel(n: number): string {
  return `Add ${count.format(n)} to your library`;
}

export function addingLabel(done: number, total: number): string {
  return `Adding ${count.format(done)} of ${count.format(total)}…`;
}

export function addedAllToast(n: number): string {
  return `Added ${plural(n, "release")} to your library`;
}

/** The header line after a partly failed add: "Added 210 of 212. 2 couldn't be added." */
export function partialLine(added: number, total: number, failed: number): string {
  return `Added ${count.format(added)} of ${count.format(total)}. ${count.format(failed)} couldn't be added.`;
}

/** "Album, 12 tracks" or "Single". */
export function kindLabel(group: Pick<ProposedGroup, "kind" | "tracks">): string {
  return group.kind === "single" ? "Single" : `Album, ${plural(group.tracks.length, "track")}`;
}

export function skippedTotal(skipped: Record<string, number>): number {
  return Object.values(skipped).reduce((n, v) => n + v, 0);
}

/** "3 files skipped". */
export function skippedTitle(skipped: Record<string, number>): string {
  const n = skippedTotal(skipped);
  return `${count.format(n)} ${n === 1 ? "file" : "files"} skipped`;
}

/** One line per type, most first: "2 .flac files", "1 .wav file". */
export function skippedLines(skipped: Record<string, number>): string[] {
  return Object.entries(skipped)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))
    .map(([ext, n]) => `${count.format(n)} ${ext} ${n === 1 ? "file" : "files"}`);
}

/** The home folder written as ~, for a path in a message. */
export function tildePath(p: string): string {
  return p.replace(/^\/Users\/[^/]+(?=\/|$)/, "~");
}

export function unreadableLine(folder: string): string {
  return `Couldn't read ${tildePath(folder)}. Check it's still there and that Locally may open it.`;
}

/** The folder's own name, for toasts and rows. */
export function folderName(p: string): string {
  return baseName(p);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "16 Oct" in the person's locale. */
export function shortDate(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(iso));
}

/** "Last checked today at 14:02", "... yesterday at 14:02", "... on 16 Oct at 14:02". Time in the locale's format. */
export function lastCheckedLine(iso: string, now: Date = new Date(), locale?: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(at);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const day = sameDay(at, now) ? "today" : sameDay(at, yesterday) ? "yesterday" : `on ${shortDate(iso, locale)}`;
  return `Last checked ${day} at ${time}`;
}

/** The artist shown for an empty tag (a row or release with no cover shows the `NoCover` note). */
export function displayArtist(artist: string, unknownArtist: string): string {
  return artist.trim() === "" ? unknownArtist : artist;
}

/** Folder of an added release after its Spotify folder: "Masters/Summer EP", or the folder's own name. */
export function folderAfterRoot(roots: readonly string[], folderPath: string): string | null {
  const root = rootOf(roots, folderPath);
  if (root === null) return null;
  const rel = relativeTo(root, folderPath);
  return rel === "" || rel === null ? baseName(root) : rel;
}

/** "3:07" or "1:02:09". */
export function formatLength(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export type { AdoptProposal };
