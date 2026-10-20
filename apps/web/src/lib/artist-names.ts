/**
 * The artist-name rules (issue #286), specified once in
 * spec/artist-names.md and ported to iOS as `ArtistNames`. Every case in
 * spec/fixtures/artists/ runs against both.
 */

/** Same artist = same key. */
export function artistKey(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/[&+]/g, " and ")
    .replace(/[^\p{L}\p{N}\p{M} ]/gu, " ")
    .split(" ")
    .filter((word) => word !== "")
    .join(" ");
}

function stripThe(key: string): string {
  return key.startsWith("the ") ? key.slice(4) : key;
}

function editDistance(a: string[], b: string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

const JOINING_WORDS = ["feat", "ft", "featuring", "and", "with"];

function isKeyPlusJoiningPart(shorter: string, longer: string): boolean {
  if (!longer.startsWith(`${shorter} `)) return false;
  const rest = longer.slice(shorter.length + 1).split(" ");
  return JOINING_WORDS.includes(rest[0]) && rest.length > 1;
}

/** True when two different names might be the same artist. */
export function looksLike(a: string, b: string): boolean {
  const keyA = artistKey(a);
  const keyB = artistKey(b);
  if (keyA === keyB) return false;
  const bareA = stripThe(keyA);
  if (bareA !== "" && bareA === stripThe(keyB)) return true;
  const charsA = Array.from(keyA);
  const charsB = Array.from(keyB);
  const shortest = Math.min(charsA.length, charsB.length);
  if (shortest >= 5) {
    const distance = editDistance(charsA, charsB);
    if (distance <= 1) return true;
    if (shortest >= 10 && distance <= 2) return true;
  }
  return isKeyPlusJoiningPart(keyA, keyB) || isKeyPlusJoiningPart(keyB, keyA);
}

/** The one whitespace set both apps use: U+0009 to U+000D and U+0020. */
function isWhitespace(char: string): boolean {
  return char === " " || (char >= "\t" && char <= "\r");
}

function trimWhitespace(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isWhitespace(text.charAt(start))) start++;
  while (end > start && isWhitespace(text.charAt(end - 1))) end--;
  return text.slice(start, end);
}

function splitNames(text: string): string[] {
  return text
    .split(" & ")
    .join(", ")
    .split(", ")
    .map(trimWhitespace)
    .filter((name) => name !== "");
}

const FEATURING_MARKERS = ["featuring", "feat", "ft"];

function asciiLower(char: string): string {
  return char >= "A" && char <= "Z" ? char.toLowerCase() : char;
}

/** The length of the marker (ASCII, any case) that starts at `index`, or 0. */
function markerAt(text: string, index: number, markers: string[]): number {
  for (const marker of markers) {
    const slice = text.slice(index, index + marker.length);
    if (slice.length === marker.length && Array.from(slice, asciiLower).join("") === marker) {
      return marker.length;
    }
  }
  return 0;
}

function skipWhitespace(text: string, index: number): number {
  let i = index;
  while (i < text.length && isWhitespace(text.charAt(i))) i++;
  return i;
}

/** True when the text holds a closer, whitespace, then an opener, of either kind: ") [". */
function hasSeparateGroup(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charAt(i) !== ")" && text.charAt(i) !== "]") continue;
    const next = skipWhitespace(text, i + 1);
    const char = text.charAt(next);
    if (next > i + 1 && (char === "(" || char === "[")) return true;
  }
  return false;
}

type Split = { rest: string; featuring: string[] };

/**
 * A trailing "(feat. ...)" or "[feat. ...]", anchored on its last opener: the
 * text ends with ")" or "]", and the last matching "(" or "[" that starts the
 * text or follows whitespace and is followed by feat, ft or featuring (then
 * ".", a space or the closer) opens it. The names are everything up to the
 * final closer, so "(G)I-DLE" and "Sunn O)))" survive. A candidate whose names
 * hold a separate later group, ") (", is skipped.
 */
function splitBracketFeaturing(text: string): Split | null {
  const trimmed = trimWhitespace(text);
  const closer = trimmed.charAt(trimmed.length - 1);
  if (closer !== ")" && closer !== "]") return null;
  const opener = closer === ")" ? "(" : "[";
  const end = trimmed.length - 1;
  for (let i = end - 1; i >= 0; i--) {
    if (trimmed.charAt(i) !== opener) continue;
    if (i > 0 && !isWhitespace(trimmed.charAt(i - 1))) continue;
    const start = skipWhitespace(trimmed, i + 1);
    const length = markerAt(trimmed, start, FEATURING_MARKERS);
    if (length === 0) continue;
    const afterMarker = start + length;
    if (afterMarker < end && trimmed.charAt(afterMarker) !== "." && trimmed.charAt(afterMarker) !== " ") continue;
    const namesText = trimmed.slice(afterMarker, end).replace(/^\./, "");
    if (hasSeparateGroup(namesText)) continue;
    const names = splitNames(namesText);
    const rest = trimWhitespace(trimmed.slice(0, i));
    return rest !== "" && names.length > 0 ? { rest, featuring: names } : null;
  }
  return null;
}

/**
 * The bare form: whitespace, a marker, then names to the end. `dotRequired`
 * is the title form (" feat. X"); otherwise a dot or whitespace may follow.
 */
function splitBareFeaturing(text: string, markers: string[], dotRequired: boolean): Split {
  for (let i = 0; i < text.length; i++) {
    if (!isWhitespace(text.charAt(i)) || (i > 0 && isWhitespace(text.charAt(i - 1)))) continue;
    const start = skipWhitespace(text, i);
    const length = markerAt(text, start, markers);
    if (length === 0) continue;
    let after = start + length;
    if (text.charAt(after) === ".") {
      const next = skipWhitespace(text, after + 1);
      if (dotRequired && next === after + 1) continue;
      after = next;
    } else if (dotRequired || !isWhitespace(text.charAt(after))) {
      continue;
    } else {
      after = skipWhitespace(text, after);
    }
    const rest = trimWhitespace(text.slice(0, i));
    const featuring = splitNames(text.slice(after));
    if (rest !== "" && featuring.length > 0) return { rest, featuring };
    break;
  }
  return { rest: text, featuring: [] };
}

/** "Song (feat. B & C)" becomes title "Song" with featuring ["B", "C"]. */
export function splitFeaturing(title: string): { title: string; featuring: string[] } {
  const { rest, featuring } = splitBracketFeaturing(title) ?? splitBareFeaturing(title, ["feat", "ft"], true);
  return { title: rest, featuring };
}

/** The inverse of `splitFeaturing`: "Song (feat. B & C)". */
export function joinFeaturing(title: string, names: string[]): string {
  if (names.length === 0) return title;
  const joined =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
  return `${title} (feat. ${joined})`;
}

/** An imported artist tag "A feat. B" becomes artist "A" featuring ["B"]. Never splits on "&" alone. */
export function splitArtistFeaturing(artist: string): { artist: string; featuring: string[] } {
  const { rest, featuring } = splitBracketFeaturing(artist) ?? splitBareFeaturing(artist, FEATURING_MARKERS, false);
  return { artist: rest, featuring };
}
