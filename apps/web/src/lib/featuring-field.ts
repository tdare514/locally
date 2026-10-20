/**
 * The Featuring field's state (issue #287, PR B). Pure, so it is testable without a DOM.
 * A track's stored title keeps the Spotify catalogue form, "Song (feat. B & C)"; the editors
 * show the plain title and the names apart (`splitFeaturing`) and join them again on save.
 */
import { artistKey, joinFeaturing, splitArtistFeaturing, splitFeaturing } from "./artist-names";

/** `names` plus `typed` (trimmed), or `names` itself when it is empty or the same artist is there. */
export function addFeatured(names: string[], typed: string): string[] {
  const name = typed.trim();
  if (name === "") return names;
  const key = artistKey(name);
  if (key === "" || names.some((n) => artistKey(n) === key)) return names;
  return [...names, name];
}

/** Typed text still in the input when it loses focus or its popover closes: it joins the names, never lost. */
export function commitDraft(names: string[], draft: string): { names: string[]; draft: string } {
  return { names: addFeatured(names, draft), draft: "" };
}

export function removeFeatured(names: string[], index: number): string[] {
  return names.filter((_, i) => i !== index);
}

export function removeLastFeatured(names: string[]): string[] {
  return names.slice(0, -1);
}

/** What a key does in the pill field's input: Enter or "," adds, Backspace in an empty input removes the last pill. */
export type FeaturedKeyAction = "add" | "removeLast" | "none";

export function featuredKeyAction(key: string, draft: string, hasNames: boolean, isComposing = false): FeaturedKeyAction {
  if (isComposing) return "none";
  if (key === "Enter" || key === ",") return "add";
  if (key === "Backspace" && draft === "" && hasNames) return "removeLast";
  return "none";
}

/** "feat. B & C": what `joinFeaturing` puts inside the brackets, so the row and the stored title agree. */
export function featuringText(names: string[]): string {
  return names.length === 0 ? "" : joinFeaturing("x", names).slice("x (".length, -1);
}

/** Both lists, de-duplicated by key, first spelling kept. */
export function mergeFeatured(first: string[], second: string[]): string[] {
  return second.reduce(addFeatured, first.reduce(addFeatured, [] as string[]));
}

/** The editor's two fields for a stored track title. */
export function toEditor(storedTitle: string): { title: string; featuring: string[] } {
  return splitFeaturing(storedTitle);
}

/** The title to store for the editor's two fields. */
export function fromEditor(title: string, featuring: string[]): string {
  return joinFeaturing(title, featuring);
}

/** Exact, NFC-normalised equality: a re-capitalised or re-spelled name is a change. */
function sameNames(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((name, i) => name.normalize("NFC") === b[i].normalize("NFC"));
}

/**
 * The title to save for a track whose stored title was `original`. When the editor still holds what
 * `original` splits into, `original` is kept as it is, so opening and saving a release never rewrites
 * a title the user did not touch ("Song feat. B" stays); otherwise the catalogue form is written.
 */
export function titleForSave(original: string | undefined, title: string, featuring: string[]): string {
  if (original !== undefined) {
    const was = splitFeaturing(original);
    if (was.title.normalize("NFC") === title.normalize("NFC") && sameNames(was.featuring, featuring)) return original;
  }
  return fromEditor(title, featuring);
}

/** A single's release title as the editor shows it: the plain part, the names being in the Featuring field. */
export function releaseTitleShown(storedTitle: string): string {
  return splitFeaturing(storedTitle).title;
}

/**
 * The release title to save for a single whose stored title was `original`: the original while the
 * Title input still holds what it splits into (a legacy "Song (feat. B)" is not rewritten), else the
 * edited plain title. Albums never use this.
 */
export function releaseTitleForSave(original: string, editedPlain: string): string {
  return releaseTitleShown(original).normalize("NFC") === editedPlain.normalize("NFC") ? original : editedPlain;
}

/** What an inspected file fills into an import row. */
export function fromInspected(info: { title?: string | null; artist?: string | null }, fallbackTitle: string): {
  artist: string;
  title: string;
  featuring: string[];
} {
  const fromTitle = splitFeaturing((info.title && info.title.trim()) || fallbackTitle);
  const fromArtist = splitArtistFeaturing(info.artist ?? "");
  return {
    artist: fromArtist.artist,
    title: fromTitle.title,
    featuring: mergeFeatured(fromTitle.featuring, fromArtist.featuring),
  };
}
