# Artist names

The rules for "same artist", "might be the same artist" and featured artists, stated once. Both apps implement them as pure functions with the same names (Mac: `apps/web/src/lib/artist-names.ts`; iPhone: `apps/ios/Locally/Domain/ArtistNames.swift`, `enum ArtistNames`) and run every case in `spec/fixtures/artists/`. Plan: `docs/plans/224-artist-list.md`.

A "character" below is a Unicode code point. "Whitespace", wherever trimming or splitting is described, means exactly U+0009 to U+000D and U+0020. No other character (NBSP, U+0085, U+FEFF and so on) is trimmed.

## `artistKey(name)`

Two names are the same artist when their keys are equal. In order:

1. Unicode NFKD, then lowercase.
2. Remove the combining accents U+0300 to U+036F ("Beyoncé" is "beyonce"). Other combining marks (for example the Japanese voicing marks) stay.
3. "&" and "+" become " and ". The whole word "and" is already "and".
4. Keep letters, digits, combining marks and spaces from any script. Every other character (punctuation, symbols, tabs) becomes a space, so "Jay-Z", "Jay Z" and "JAY Z" are one key, "jay z".
5. Collapse runs of spaces to one and trim.

A leading "the " stays in the key: "The The" is "the the".

## `looksLike(a, b)`

Takes two names, computes both keys. False when the keys are equal. Otherwise true when any of these hold:

- The keys are equal after removing a leading "the " from each ("The Weeknd" and "Weeknd").
- The Levenshtein distance (over characters) is at most 1, and both keys have at least 5 characters.
- The distance is at most 2, and both keys have at least 10 characters.
- One key is the other followed by a space and a featuring or joining part: the rest starts with the word "feat", "ft", "featuring", "and" or "with" and has something after it.

## `splitFeaturing(title)`

Returns `{ title, featuring }`. Case-insensitive. Matches one trailing part:

- A bracket form: the text ends with ")" or "]", and the last matching opener "(" or "[" that starts the text or follows whitespace, followed by optional whitespace and `feat`, `ft` or `featuring` (any ASCII case), then ".", a space or the closer, opens it. The names are everything up to the final closer, so brackets inside a name survive: "Song (feat. (G)I-DLE)" and "Song (feat. Sunn O))))". An opener whose names hold a later separate group (a ")" or "]", whitespace, then a "(" or "[") is skipped, so "Song (feat. B) (Live)" does not split. A closer that does not match the opener does not split.
- A bare form at the very end: " feat. X" or " ft. X", with whitespace, the marker, a dot and whitespace.

The marker is a whole word (the next character must be as above, so "featé" is not a marker), so "Defeat" and "Soft Touch" never split. Names are split on ", " and " & ", trimmed, and empty names dropped. The title is trimmed. No marker, no names, or an empty remaining title returns the input unchanged with `featuring: []`.

## `joinFeaturing(title, names)`

No names returns the title. Otherwise `title + " (feat. " + names + ")"`, the names joined with ", " except the last pair, joined with " & ": "B", "B & C", "B, C & D". For canonical input, `joinFeaturing(splitFeaturing(x))` is `x`.

## `splitArtistFeaturing(artist)`

For an imported artist tag. Returns `{ artist, featuring }`. Splits only on an explicit marker, never on "&" alone: "Simon & Garfunkel" stays whole. Accepts the title bracket form at the end, or a word marker `feat`, `ft` or `featuring` (dot optional) between the artist and the names: "A feat. B" is artist "A" featuring ["B"]. Names split as for titles. No marker returns the input unchanged with `featuring: []`.

## Fixtures

`spec/fixtures/artists/*.json`, each an array of cases with a `name`:

- `keys.json`: `inputs` (all must give) `key`.
- `looks-like.json`: `a`, `b`, `expected`.
- `title-split.json`: `input`, `title`, `featuring`.
- `title-join.json`: `title`, `featuring`, `expected`. Tests also check the round trip.
- `artist-split.json`: `input`, `artist`, `featuring`.
