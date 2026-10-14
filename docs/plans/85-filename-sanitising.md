# 85 — One filename-sanitising rule for web and iOS

Issue #85. Blocks #87 (sync name rules), which touches the same spec and `ReleaseLayout.swift`.

## Problem

The Mac app (`apps/web/src/server/releases/ReleaseLayout.ts`, `sanitizeSegment`) and iOS
(`apps/ios/Locally/Domain/ReleaseLayout.swift`, `sanitizeSegment`) turn the same tag into
different path segments. iOS keeps leading dots (an artist `.x` makes a hidden file), keeps
control and bidi characters, and has no length cap. `spec/metadata.md` documents only the
shorter iOS rule, and nothing compares the two apps' output.

## Contract: the canonical segment rule

`spec/metadata.md` states this rule, replacing the current one-line rule. Both apps implement it
exactly, in this order:

1. Missing input is the empty string.
2. Remove control characters: U+0000–U+001F and U+007F.
3. Remove invisible reordering characters: U+061C, U+200B–U+200F, U+202A–U+202E,
   U+2066–U+2069, U+FEFF.
4. Remove `/ \ : * ? " < > |`.
5. Strip leading and trailing dots and whitespace. Whitespace is the JavaScript `\s` set:
   U+0009–U+000D, U+0020, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F,
   U+3000, U+FEFF.
6. Cap the length: keep whole grapheme clusters from the start while the result stays within
   **200 Unicode code points** and **239 UTF-8 bytes** (255, the filename limit, less 16 bytes
   reserved for an extension or a ` (n)` suffix). A cluster that would cross either limit is
   dropped with everything after it, so a cut never splits a code point or a grapheme (a flag,
   a skin-tone emoji, a letter with combining marks). ZWJ (U+200D) is already gone after step 3,
   so a ZWJ emoji sequence reaches this step as separate emoji; that is the web's existing
   behaviour and is kept, since ZWJ is one of the invisible characters the rule exists to strip.
7. Strip trailing dots and whitespace again (the cut may expose some).
8. An empty result becomes `Unknown`.

Change from today's web rule: step 6 cut on code points; it now cuts on grapheme boundaries.
This only differs when a cut lands inside a multi-code-point grapheme, and only for names
longer than the cap. iOS gains steps 2, 3, the leading half of 5, and 6.

Grapheme boundaries: web uses `Intl.Segmenter` with `granularity: "grapheme"`; iOS iterates
Swift `Character`s. Both follow UAX #29 extended grapheme clusters. Fixtures stick to clusters
whose segmentation has been stable across Unicode versions (flags, skin-tone modifiers,
combining accents), so a runtime Unicode-version difference cannot fail them.

## Files already on disk

Nothing is migrated or renamed. Release edits re-tag in place and never rename (STATUS), so an
existing file keeps the name it was written with. Nothing looks a file up by recomputing its
name from tags: web stores the release folder and track files in its index and only calls
`folderFor`/`trackFileName` to choose the destination of a new write; iOS stores each track's
`filePath` and reads `lastPathComponent` from it. The new rule therefore applies only to files
written after the change. A re-import of the same tags on iOS can now produce a different name
than an old copy (for example `.x` becomes `x`); that is a new file, as any import is today.

## Shared fixtures

`spec/fixtures/filenames/*.json`, one file per category, each a JSON array of
`{ "name": string, "input": string | null, "expected": string }`:

- `illegal-characters.json` — each of `/ \ : * ? " < > |`, mixed with text, only illegal.
- `dots.json` — leading (`.x`, `..`, `...hidden`), trailing, both, dots only → `Unknown`.
- `control-and-bidi.json` — NUL, newline, tab, DEL, U+202E inside a name, U+200B, U+FEFF,
  U+2066–U+2069, U+061C.
- `whitespace.json` — empty, null, spaces only, NBSP only, ideographic space only → `Unknown`;
  inner spaces kept; leading/trailing trimmed.
- `length.json` — ASCII over 200 code points (cut at 200); CJK long enough to hit the 239-byte
  cap first (79 three-byte characters fit, 80th dropped); emoji (4 bytes) hitting the byte cap;
  a flag and a skin-tone emoji straddling the byte cap (whole cluster dropped); a ZWJ family
  emoji near the cap (ZWJs removed, the three emoji kept separately); a combining
  accent straddling the code-point cap; a cut that exposes a trailing space or dot.

Non-ASCII inputs are written with `\u` escapes so the fixtures are readable and unambiguous.

## Tests

- Web: `apps/web/tests/unit/filenameFixtures.test.ts` loads every fixture file the way
  `syncFixtures.test.ts` does and asserts `new ReleaseLayout().sanitizeSegment(input) ===
  expected` per case, plus a guard that each category file exists and is non-empty.
- iOS: `apps/ios/LocallyTests/FilenameFixtureTests.swift` loads the same directory the way
  `SyncFixtureTests.swift` does and asserts the same equality per case.
- Existing `ReleaseLayoutTests` in both apps keep passing.

## Affected components

- `spec/metadata.md` — the rule above.
- `spec/fixtures/filenames/` — new.
- `apps/web/src/server/releases/ReleaseLayout.ts` — step 6 cuts on grapheme boundaries.
- `apps/ios/Locally/Domain/ReleaseLayout.swift` — `sanitizeSegment` implements the rule.
- Tests in both apps as above. `apps/api` is untouched: it never builds filenames from tags.

## Security

Strictly tighter on iOS: no hidden or traversal-looking (`..`) segments, no invisible characters
that can disguise a name, no segment that alone breaks the filename limit. The inside-check on
every write is unchanged.

## Out of scope (follow-up)

The iOS flat name `<Artist> - <Album> - <NN> - <Title>.<ext>` joins three segments, each up to
239 bytes, so a long artist, album and title together can still pass 255 bytes and fail the
write. Capping the joined name (for example by budgeting bytes across segments) changes the
naming contract and gets its own issue.
