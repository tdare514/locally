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

function splitNames(text: string): string[] {
  return text
    .split(" & ")
    .join(", ")
    .split(", ")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

const BRACKET_FEATURING = /\s*[(\[]\s*(?:feat|ft|featuring)\b\.?\s*([^)\]]*?)\s*[)\]]\s*$/i;
const BARE_TITLE_FEATURING = /\s+(?:feat|ft)\.\s+(.+)$/i;
const WORD_ARTIST_FEATURING = /\s+(?:feat|ft|featuring)\b\.?\s+(.+)$/i;

function splitWith(
  text: string,
  patterns: RegExp[],
): { rest: string; featuring: string[] } {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const rest = text.slice(0, match.index).trim();
    const featuring = splitNames(match[1]);
    if (rest !== "" && featuring.length > 0) return { rest, featuring };
  }
  return { rest: text, featuring: [] };
}

/** "Song (feat. B & C)" becomes title "Song" with featuring ["B", "C"]. */
export function splitFeaturing(title: string): { title: string; featuring: string[] } {
  const { rest, featuring } = splitWith(title, [BRACKET_FEATURING, BARE_TITLE_FEATURING]);
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
  const { rest, featuring } = splitWith(artist, [BRACKET_FEATURING, WORD_ARTIST_FEATURING]);
  return { artist: rest, featuring };
}
