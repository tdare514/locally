# 366: build a collection on one screen (plan, two variants)

Status: prototype only. The owner picks a variant before anything ships. The prototype is
`apps/ios/Locally/Views/Collections/CollectionBuilderVariants.swift` (DEBUG, over the gallery's
sample library, including one adopted details-only release). Gallery names start `builder-`.

## Today

"New collection" asks for a name in an alert and opens an empty collection. You then go back to the
Library and long-press songs one at a time.

## Variant 1: One screen

The sleeve is at the top with the name typed on it (as the Import record does). Its art is a mosaic
of the first picks and grows as you pick (one cover, two halves, one tall and two stacked, then a 2x2).
Under it a pinned bar holds the picks as small sleeves leaning in a crate and "3 songs · 7 min", then a glass
search box. Below are the library's Releases and Songs with cover thumbnails. A tap adds or removes and a
cover-tinted glass check shows on the cover. A floating cover-tinted Done pill sits at the bottom.

| State | Screenshot |
|---|---|
| Just opened | `docs/design-previews/366/builder-1-empty.png` |
| Three picks | `docs/design-previews/366/builder-1-picks.png` |
| Searching "night" | `docs/design-previews/366/builder-1-search.png` |
| Three picks, accessibility3 | `docs/design-previews/366/builder-1-ax3.png` |
| Add music on "Late drives" | `docs/design-previews/366/builder-1-add-music.png` |

## Variant 2: Name, then pick

Step 1 is a naming moment: the empty sleeve centre stage, the name typed large on it, a Next pill.
Step 2 is the picker as a sheet: "Add to <name>", a glass search box, a Songs / Releases glass switch
(`GlowSwitch`), rows with a round add control that turns into a check, and the picks strip pinned above Done.

| State | Screenshot |
|---|---|
| Step 1, naming | `docs/design-previews/366/builder-2-name.png` |
| Picker, empty | `docs/design-previews/366/builder-2-empty.png` |
| Three picks | `docs/design-previews/366/builder-2-picks.png` |
| Searching "night" | `docs/design-previews/366/builder-2-search.png` |
| Three picks, accessibility3 | `docs/design-previews/366/builder-2-ax3.png` |
| Add music, over the collection's real page | `docs/design-previews/366/builder-2-add-music.png` |

## Variant 1b: One screen, sleek (owner, 24 Oct)

The owner chose variant 1 but found it boxy and old-iPhone. Same screen and data; only the chrome changes.

- One continuous wash: the cover colours run down the page and fade to near-black by about 60% of the height, so the hard edge under the hero is gone.
- The picks crate has no panel: overlapping mini sleeves tilted -4 and +4 degrees, with "3 songs · 7 min" as small secondary text.
- Releases are a horizontal shelf of 132 pt covers (112 pt at accessibility sizes). A tap adds the whole release: an accent check dot and a cover-tinted glow ring.
- Songs are a borderless list on the backdrop: spacing instead of cards and separators, a round add control at the end, and a faint cover-tinted wash behind a picked row.
- Search and Done float at the bottom: a frosted search pill with a hairline, and a round cover-tinted Done (disabled at 0 picks). At large text they stack, with a Done capsule under the pill.
- Each shelf cover and song row is one button that reads "Night Bus to Nowhere, Mira Valdane, added" with the selected trait.

| State | Screenshot |
|---|---|
| Empty | `docs/design-previews/366/builder-1b-empty.png` |
| Picks (three songs and one whole release) | `docs/design-previews/366/builder-1b-picks.png` |
| Searching "night" | `docs/design-previews/366/builder-1b-search.png` |
| Three picks, accessibility3 | `docs/design-previews/366/builder-1b-ax3.png` |
| Add music | `docs/design-previews/366/builder-1b-add-music.png` |

## Trade-off

Variant 1 never leaves one page, so the cover is visible while you pick, and it is closest to Import.
It is a busy screen on a phone, and the name field and the library share the same scroll.
Variant 2 asks for the name first (a clear start, a calmer picker, more room for rows) at the cost of one extra step.

## What each reuses

- `LibrarySearch.filter` and `normalize` for the Releases list and the query words (songs match title or artist on the same rule).
- `CollectionsModel.create(name:items:)` and `add(_:to:)` on Done. Nothing new in the model: `create` already
  takes the items and `CollectionEdit.appended` skips duplicates.
- The sleeve parts: `RecordSleeve` (the name overlays it), `CollectionCoverView`'s first-four-covers rule (the mosaic follows
  `coverReleaseIDs`), `ArtworkPalette` and `ArtworkBackdrop` for the wash, `Theme.coverGlowColors` for the tint.
- Glass: `GlowGlass`, `GlowRim`, `GlowSwitch`, `CoverGlowButtonStyle`, `Theme.Immersive.panelFill`.
- New strings in `Copy.CollectionBuilder`, sizes in `Theme.Builder`.

## What Done does

Done calls `CollectionsModel.create(name:items:)` with the picks in order (a release pick is `.release`, a song is
`.track`). The cover is not stored: it is computed from the first picks, as `CollectionCoverView` does today. The new collection then
opens in the record player (`onOpen(id)`, as the alert path does now). A save that fails keeps the builder open with the existing
"Try again" message (`Copy.Collections.createFailed`). Done is off until the name is valid
(`MusicCollection.validName`). The close X asks nothing when no name is typed and no song is picked; otherwise it
confirms "Discard this collection?".

## Add music on an existing collection

The collection's page gets an "Add music" button (also in its empty state). It opens the same picker with the name fixed:
variant 1 as a full screen with the sleeve showing the collection's current cover, variant 2 as the sheet over the page.
Songs already in the collection show a dimmed check and "Already in this collection". Done calls `add(_:to:)` and the page
refreshes. Same picks logic, one `BuilderDraft` with `existing` set.

## Adopted songs

Adopted (details-only) songs and releases can be picked. They carry a small "On your Mac" mark (the existing
`Copy.Collections.onYourMac`), count in "songs" but not in the minutes (the model's `playableDuration` counts only what this phone holds),
and stay dimmed in the queue as they are today.

## Sync

Unchanged. Collections already sync (`/v1/collections`) through the model's hook; the builder only calls the same
create and add.

## The UI test the build must add

In `LocallyUITests`, over the gallery's seeded library: open the builder, type a name, tap three songs, tap Done. Expect
the new collection open with three tracks, and no visit to the Library tab at any point (the test never leaves the builder
until Done). A second test: "Add music" on a seeded collection adds two and the count grows. Unit tests: the draft's toggle
rules (a release replaces its songs, an existing item cannot be toggled) and the summary line.

## Session brief

```
Model: sonnet (a written plan, existing parts; no judgement calls once the owner has picked a variant)
Read only: docs/plans/366-collection-builder.md, apps/ios/Locally/Views/Collections/CollectionBuilderVariants.swift, CollectionsView.swift, CollectionDetailView.swift, CollectionsModel.swift, apps/ios/Locally/Domain/LibrarySearch.swift
Do not touch: sync code, apps/api, apps/web, spec/, RecordWheelView.swift
Verify: cd apps/ios && xcodegen generate && xcodebuild test -scheme Locally (plus the on-demand LocallyUITests scheme for the new builder test)
Done when: New collection opens the chosen builder; a collection of three songs is made without leaving it; Add music on a collection's page uses the same picker; the DEBUG variants file is reduced to the chosen variant
```
