# 365: a song page (plan and prototype)

Status: three layouts as real SwiftUI screenshots, for the owner to pick. Nothing ships from this branch.
Prototype: `apps/ios/Locally/Views/Library/SongPageVariants.swift` (DEBUG only), gallery names
`song-{a,b,c}`, `-bottom`, `-ax3`, `-adopted` (12 screens). Strings are in `Copy.SongPage`, metrics in `Theme.SongPage`.

## The three variants (390 pt; top, bottom, AX3, adopted for each)

- **A, Sleeve**: the cover's colours wash the page, the cover is a record sleeve with the vinyl half out, big title,
  linked artist line, a Play glow button over Add to collection and Edit, then glass cards: Plays (big total,
  last played, bars by period), In collections (mini sleeves), On the album, File.
  `docs/design-previews/365/a-top.png`, `a-bottom.png`, `a-ax3.png`, `a-adopted.png`
- **B, Liner notes**: compact header (tilted sleeve beside title and artist), actions, then one large glass panel set
  like the back of an LP: serif label/value pairs in two columns (one at AX sizes), tags as cover-tinted glass chips,
  a plays sparkline (12 weeks), collections as tiny sleeves, file and location as small print.
  `b-top.png`, `b-bottom.png`, `b-ax3.png`, `b-adopted.png`
- **C, On the platter**: a large vinyl with the cover as its centre label, title and artists under it, actions,
  a 2-column grid of glass tiles (Plays, Last played, Length, Released, Genre, In N collections), then the file card.
  The disc is still; it turns slowly only while this song plays and never under Reduce Motion (`isPlaying` is wired,
  the gallery shows it still). `c-top.png`, `c-bottom.png`, `c-ax3.png`, `c-adopted.png`
  (all under `docs/design-previews/365/`)

Adopted (details-only) songs: location reads "On your Mac", Play is disabled and Edit is replaced by one quiet line
saying why; the file size reads "Only on your Mac".

## Owner's direction (24 Oct)

- Keep A's layout: cover wash, sleeve with the disc half out, big title, linked artist line, then glass cards.
- No Play button. The record is the play control: tap the sleeve to play, tap again to pause; the disc spins only while playing and stops on pause, reusing the collection page's sleeve behaviour from #369 in the build.
- "In collections" comes from B (the row of tiny sleeves), in the house sans fonts only; no serif anywhere.
- The chunky full-width pills go. Two sleeker action rows, both with Collection, Play next, Share, Edit:
  - **a2, Glass circles** (recommended): four 56 pt glass circles with captions under them. `a2-top.png`, `a2-bottom.png`, `a2-ax3.png` (2 x 2 grid), `a2-adopted.png`
  - **a3, One glass bar**: one content-hugging 52 pt capsule with hairline-separated segments; rows in one glass panel at AX3. `a3-top.png`, `a3-ax3.png`
- Adopted: the sleeve is dimmed and disabled ("Paper Moon, only on your Mac"), Edit is removed, and "Edit it on your Mac" sits under the actions.
- **a4, Actions on the wash** (round 3, owner: "buttons that are just like a part of the screen ... a whole other section right below"): Collection, Play next, Share, Edit are bare 24 pt glyphs with labels straight on the cover wash, with no shape, rim or fill; pressed, they go full white and a soft glow in the cover's accent blooms behind the glyph. Plays, In collections, On the album and File sit on their own opaque near-black panel with 28 pt rounded top corners, a 1 pt highlight and a grabber line, rising over the bottom of the wash; no glass cards inside, hairlines between rows. AX3 makes the actions a 2 x 2 grid.
  - Screenshots: `a4-top.png`, `a4-bottom.png`, `a4-ax3.png`, `a4-adopted.png` (gallery `song-a4`, `song-a4-bottom`, `song-a4-ax3`, `song-a4-adopted`).

## Where each field comes from

| Field | Source today | Missing |
|---|---|---|
| Cover | `CoverStore` via the release's `coverPath`; wash from `ArtworkPalette.palette(forCover:)` | nothing |
| Title | `Track.title` minus its "(feat. ...)" part (`FeaturingNames`) | nothing |
| Artist line, featured names | `Release.artist` and `FeaturingNames` split of the title; `ArtistLineText` links each name | a per-track artist is not stored; the album artist is used |
| Album | `Release.title` (a single's album is its title) | nothing |
| Track number, disc number | `Track.trackNumber` (release-wide), `Track.discNumber` (nil on one disc) | "of N": count tracks in the release; disc total = highest `discNumber` |
| Genre | `Release.genre` | nothing |
| Release date | `Release.date` (`ReleaseDate`, year, month or day), formatted by the existing date text helper | nothing |
| Length | `Track.durationSec` through `TrackLength.format`; `ReleaseDetailViewModel.readLengths` for older tracks | adopted tracks may have none |
| Plays total | `PlayStatsService` all-time `PlayCount.plays` per `trackId` (`ReleaseDetailViewModel.playTotals`) | signed-out or offline: no plays, hide the card |
| Last played | `PlayCount.lastPlayedDay` of a ranged `summary` call (the all-time rows carry none) | one extra ranged read |
| Plays by period | `PlayStatsService.summary(from:to:)` per `PeriodSelection` (today, week, month, year, all), as Stats does | five reads, or reuse Stats' cache; the 12-week sparkline needs 12 ranged reads or a new server call (not built) |
| In collections | `CollectionsModel.collections` where an item is `.track(releaseId, trackId)` or `.release(releaseId)` | no "collections containing" helper: add one, pure and tested |
| File name | `Track.originalName` (the stored name is `Track.filePath`) | nothing |
| Format | extension of `Track.filePath` | a readable name ("AAC (m4a)") table |
| File size | read from the file at open (`FileManager` attributes, inside `SpotifyFolderAccess.withAccess`) | adopted: `SyncTrack.bytes` exists on the wire but `Track` does not keep it |
| Where it lives | `Release.isAdopted`: "This iPhone" or "On your Mac" | #332 adds devices ("On {device}") |

## Entry points

1. A tap on a track's title on the release page (the number stays the play button).
2. "Song info" in the long-press menu (#364).
3. A Stats track row.

All three wait on #360 to #363 merging (the row and menu work they change); build after that.

## Actions and Edit routing

- Play: the existing queue (`context: release` from this track).
- Add to collection: the existing `AddToCollectionSheet` for one track.
- Edit: opens the release in edit mode, scrolled to this song. Phone-held only until #285 and #332;
  for an adopted song the page shows a quiet line and no button. Adopted songs have no audio here, so Play
  is disabled too (open question: should Play hand off to the Mac?).

## Tests the build must add (Swift Testing)

- Pure `SongPageModel` built from Release, Track, play counts and collections: every field above, "3 of 10",
  disc total, missing length, no plays, adopted vs phone.
- "Collections containing a track" helper: a `.track` item, a `.release` item, both, none, unknown items skipped.
- Format name from extension; file size text; "On your Mac" for adopted; Edit available only when phone-held.
- Last played from a ranged summary; plays hidden when signed out.
- Gallery frames at 390 pt, AX3, adopted; a UI test that a track title tap opens the page.

## Open points

- Bar colours use the cover's brighter colours (the sample uses its seed colours); the real page needs a lightened
  version of the palette, since `AmbientPalette` is capped dark for the wash.
- Pushed pages need the system back button; the prototype shows only the page body.

## Session brief

```
Model: sonnet (implements the chosen variant from this plan)
Read only: docs/plans/365-song-page.md, apps/ios/Locally/Views/Library/SongPageVariants.swift, ReleaseDetailView.swift, ReleaseDetailViewModel.swift, apps/ios/Locally/Views/Components/ReleaseViewMode.swift, apps/ios/Locally/Domain/Models.swift, apps/ios/Locally/Services/PlayStatsService.swift, apps/ios/Locally/Views/Collections/CollectionsModel.swift
Do not touch: sync, tag writing, RecordWheelView.swift
Verify: xcodebuild test; gallery screenshots at 390 pt, AX3 and adopted
Done when: tapping a song's title opens its page with every field above, in the chosen variant
```
