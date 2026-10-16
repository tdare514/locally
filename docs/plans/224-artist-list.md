# #224: the artist list — suggestions, duplicate warnings, artist pages

## Why

The artist (TPE1 / ©ART) is the field Spotify shows under every local file, and it is typed by hand on both apps. One typo or a different spelling ("The Weeknd", "the weeknd", "Weeknd") splits an artist in two, in Locally's library, in Stats and in Spotify. The owner (16 Oct) asked for:
- suggestions from artists already used
- a warning when a new name looks like a duplicate
- sorting by artist
- a place to see everything by one artist

Spotify's artist database isn't an option. Development-mode apps are capped and some artist endpoints are cut, and Spotify never links a local file to an artist page anyway (see the issue). So the list comes from the user's own library.

## What exists today

- **Mac:**
  - The library sorts by "Artist A–Z" (`apps/web/src/lib/library-sections.ts`).
  - Search folds case and accents.
  - The Stats page opens the library filtered to an artist.
  - There is no artist page and no suggestions.
- **iPhone:**
  - Search folds case and diacritics (`LibrarySearch.swift`).
  - The library has no sort control.
  - There is no artist page and no suggestions.
- **Both:** the artist is a plain string on the release (and optionally per track). It already syncs. Adopted releases (#245) bring the owner's ~1,567 existing tracks and their artists into the library read-only.

## Decisions for the owner

Decided 16 Oct: 1 (an artist page) and 2 (featured artists as their own field). 3 and 4 stand as recommended unless the owner says otherwise.

1. **An artist page, not just a filter (recommended).** It's what Apple Music, SoundCloud and Deezer do: a header with the name, then the releases.
   - **Header:** the artist's name over the cover wash of their newest release.
   - **Sections:** Albums, then Singles (cover tiles), then "Most played" (the top five tracks from plays, if any).
   - **Opens from:** the artist name on a release page (now a link in view mode), an artist in Stats (replacing today's filtered library), and a new Artists view in the library.
   - The alternative is to keep the filtered library: simpler, but it shows no plays and has no place for a rename.
2. **Featured artists are their own field (owner, 16 Oct).** People enter the features separately in Locally, and Locally shows the main artist and the features apart. Written to the files, they go where Spotify's own catalogue puts them: in the title, like "Song (feat. B)" or "Song (feat. B & C)", with the artist tag left as the main artist. That keeps all of an artist's songs under one name in Spotify. See "Featuring" below. A featured artist's page lists those tracks under "Appears on".
3. **Renaming an artist everywhere is a separate, later step,** and needs your yes. It re-tags every file by that artist in place; files keep their names. The risk is Spotify playlists: a local file's playlist entry is keyed by its tags (`spotify:local:{artist}:{album}:{title}:{seconds}`, `docs/research/playlists.md`), so renamed tracks may drop out of playlists until re-added.
   - Before building it, one manual test: rename one artist on a track that's in a playlist, and see whether Spotify keeps it.
   - Adopted (read-only) releases are never renamed.
4. **MusicBrainz suggestions:** not now. They'd need network calls and a privacy note. The library alone covers the duplicate problem.

## Design

### One name key, the same on both apps

A pure `artistKey(name)` decides "same artist", and a pure `looksLike(a, b)` decides "might be the same". Both are specified once, in `spec/artist-names.md`, with shared cases in `spec/fixtures/artists/` that both apps' tests run (as `spec/fixtures/filenames/` does).

- **Key:**
  - Unicode NFKD, fold case and accents
  - "&", "+" and the word "and" become "and"
  - drop punctuation except letters, digits and spaces ("Jay-Z", "Jay Z" and "JAY Z" are one)
  - collapse spaces, trim
  - a leading "the " is kept in the key, so "The The" survives, but `looksLike` ignores it
- **Looks like:** two different keys look alike when any of these hold:
  - they are equal after dropping a leading "the "
  - their edit distance is 1 (keys of 5 or more characters) or 2 (keys of 10 or more characters)
  - one is the other plus a featuring or joining part
- **Featured names** come from the titles, by the Featuring rule below. Any track that features an artist is listed under "Appears on" on that artist's page. An artist string with " & " (a duo such as "Simon & Garfunkel") stays one artist.

### Suggestions as you type (both apps, every artist field)

- **Source:** the library's distinct artists (the display spelling most used for each key), each with its track count. Derived on demand; no new storage and no sync change.
- **Matching:** a prefix match on any word of the key, best first: exact prefix, then more tracks, then A–Z.
- **Mac (glass, under the field):** up to 5 matches, with the matched letters in full white and the rest dim (as Artsy does), plus "12 tracks" on the right.
  - Keyboard: ↑ and ↓ move, Enter or Tab takes the match, Escape closes.
  - ARIA combobox pattern (`role="combobox"`, `aria-autocomplete="list"`, `aria-activedescendant`).
  - No list for an empty field.
- **iPhone:** a row of up to 3 suggestion pills on the keyboard toolbar, like QuickType. Tapping one fills the field.
  - The row scrolls sideways if names are long.
  - Each pill has an accessibility label like "The Weeknd, 12 tracks".
- **Where:**
  - Mac: the import record and the release page
  - iPhone: the import record and the release page in edit mode
  - the Mac's bulk edit's Artist field

### "Did you mean" (both apps)

- **When:** the typed name doesn't match an existing key, but `looksLike` an artist already in the library.
- **What:** one quiet line under the field: "You have 12 tracks by The Weeknd." with a **Use The Weeknd** link.
  - It never blocks saving.
  - It appears after a pause in typing (600 ms) or when the field loses focus.
- **Case-only difference:** when the key matches but the spelling differs (for example "the weeknd" against "The Weeknd"), the line reads "Matches The Weeknd. Use that spelling?" with the same link.
- **On the iPhone review sheet** ("Check your changes"), a new artist that looks like an existing one gets the same line under the Artist row.

### Featuring (both apps)

**Storage.** No new stored field and no sync change. Each track's title keeps the features in Spotify's catalogue form, "Song (feat. B)" or "Song (feat. B & C)". Locally splits that into Title and Featuring when it shows or edits a track, and joins them again when it saves.
- **The split rule:** a trailing "(feat. …)", "[feat. …]", "(ft. …)", "(featuring …)", or a bare " feat. " or " ft. " at the end of a title. Names are separated by ", " and " & ".
- **Joining:** "(feat. " + the names joined with ", " and a final " & " + ")".
- **Shared spec:** both rules go in `spec/artist-names.md` with fixtures, so both apps agree.

**Editing.**
- **A single,** on the import record and the release page: a **Featuring** field under Artist. Each name is a pill, with artist suggestions as you type and a pill's ✕ to remove it.
- **An album:** each track row shows "feat. B" dimmed after the title. A small **feat.** button on the row (on hover or focus on the Mac, in edit mode on the iPhone) opens the same pill field for that track.

**Imported files.**
- A title in the form above already splits.
- An artist tag like "A feat. B" shows as artist A featuring B. Nothing is rewritten until the user saves an edit to that release.
  - On a brand-new import, before anything is in Spotify, the first save writes the title form.
  - Adopted, read-only releases are never rewritten, so their Spotify identity stays as it is.

**Display.** Wherever a track's artist line shows (track rows, Stats, the artist page), it reads "A, feat. B" with the feature dimmed, and the title shows without the "(feat. …)".

### Library by artist

- **iPhone:** gains the Mac's sort control: Recently updated, Title, Artist A–Z, Year. It's remembered, like list or grid.
- **New Artists view, both apps:** a third library view beside List and Grid. It shows every main artist A–Z (featured-only artists are included, with their "Appears on" count), with:
  - a small cover stack
  - the track count
  - the release count

  Tapping an artist opens the artist page. A typed search filters it.

### Artist page

- **Layout:** the decision 1 layout, in the #112 immersive look (the cover wash, glass, no caps labels).
- **Back:** the back button (#258) and the iPhone's navigation return to where you came from.
- **Empty state:** an artist with one release still gets a page, with no empty sections shown.

## Contract and compatibility

- **No sync or API change.** Artists, and features inside titles, already sync. Everything else is derived on each device.
- **Tags:** features are written into the title (TIT2 / ©nam), as above. The artist tag (TPE1 / ©ART) holds only the main artist for tracks saved after this change.
- **Old clients:** nothing changes for them.
- **Adopted releases:** they appear in lists and pages. Their artist fields are read-only, so they never show suggestions.

## Security and privacy

- Nothing leaves the device. There are no new network calls, and there is no new stored data.

## Speed

- The artist index is built from the library list in memory, in one pass: about 1,600 tracks, well under 10 ms.
- It's rebuilt when the library changes.
- Suggestions filter the index on each keystroke. No disk reads happen per keystroke.

## Tests

- **Shared fixtures** (`spec/fixtures/artists/`):
  - key equality: case, accents, "&" or "and", punctuation, spaces, Jay-Z
  - looks-like pairs, both true and false
  - primary-artist splits
  - "The The" kept

  Both apps' tests run every case.
- **Unit tests in both apps:**
  - suggestion ranking
  - the index: the most-used spelling wins, and track counts
  - the "Did you mean" decision
- **UI:**
  - Mac: combobox keyboard and ARIA tests
  - iPhone: view-model tests for the pills and the line
  - screenshots of the field with suggestions, the warning, the Artists view and an artist page, on both apps

## Rollout (each an issue with a session brief)

1. **The name key and the Featuring split and join rules** (spec and fixtures, then both apps' pure helpers and tests). No UI.
2. **Suggestions, "Did you mean" and the Featuring field** on both apps.
3. **Artists view and artist page** on both apps, the iPhone's sort control, and Stats and release-page links to the page.
4. **Later, only with your yes:** rename an artist everywhere, after the manual Spotify playlist test in decision 3.

Session briefs (for steps 1–3):

```
Step 1 — Model: sonnet (pure functions from a written spec)
Read only: docs/plans/224-artist-list.md, spec/fixtures/filenames/ (as the fixture pattern), apps/web/src/lib/library-sections.ts, apps/ios/Locally/Domain/LibrarySearch.swift
Do not touch: any UI, sync, apps/api
Verify: cd apps/web && npm run check; iOS xcodebuild test on a throwaway simulator
Done when: spec/artist-names.md and spec/fixtures/artists/ (keys, look-alikes, feat. split/join) exist and both apps pass every fixture
```

```
Step 2 — Model: sonnet (UI from this plan), design judged by the session model
Read only: this plan, the step 1 helpers, the Mac's inline field components and bulk edit, the iPhone's import record and release page fields
Do not touch: sync, tag writers, apps/api
Verify: npm run check; xcodebuild test; screenshots of suggestions and the warning on both apps
Done when: both apps suggest artists, warn on look-alikes, and edit features apart from the title, written as "Song (feat. B)"
```

```
Step 3 — Model: sonnet (UI from this plan), design judged by the session model
Read only: this plan, the step 1 helpers, both apps' library views, release page headers, the Mac Stats artist click, AppShell back stack
Do not touch: sync, tag writers, apps/api
Verify: npm run check; xcodebuild test; screenshots of the Artists view and an artist page on both apps
Done when: an artist page opens from the release page, Stats and the Artists view on both apps, and the iPhone library sorts
```
