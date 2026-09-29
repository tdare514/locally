# Locally design language

Shared by the Mac app (`apps/web`) and the iOS app (`apps/ios`). Version 2, 27 Sep 2026: the
first version was distilled from the web app; this one folds in the owner's MagicPath designs
("Desktop Dashboard", "Desktop Crop Overlay", "Mobile Library", "Mobile Editor"), except the
desktop sidebar, which is deliberately not adopted because its icon set reads as Spotify's. The
web app keeps its own sidebar. When the design session changes anything, this file changes first
and both apps follow.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| bg | #000000 | page background |
| card | #121212 | cards, list containers, drop zones, dialogs, cover placeholder, web sidebar |
| elevated | #282828 | inputs, segmented control track, secondary buttons, badges, icon tiles |
| elevated-hover | #3A3A3A | hover on elevated surfaces (web) |
| row-hover | #1C1C1C | pressed/hovered list rows |
| border | #282828 | 1 px borders on cards, rows, inputs (mobile), footers |
| border-dashed | #3E3E3E | dashed borders on drop zones (accent on hover) |
| dialog-border | #303030 | the crop dialog's border |
| text | #FFFFFF | primary text |
| text-muted | #B3B3B3 | secondary text, metadata on the right of headers |
| text-dim | #777777 | chevrons, footnotes, breadcrumb eyebrows |
| text-hint | #888888 | hint lines under drop zones |
| text-soft | #D7D7D7 | the line inside a drop zone ("Click or drop an image", "Drop audio files here") |
| danger | #F15E6C | errors, delete |
| accent | #1E7DF0 (hover #3B8EF5) on both platforms, decided 27 Sep 2026 | eyebrows, primary buttons, selected segment, focus ring, accent icons, the shimmer on the app icon |

The accent is the same on both platforms. It replaced the web app's Spotify green and the iOS
orange placeholder; never reintroduce a green near #1DB954 (App Store branding rule in
`docs/ios-plan.md`).

## Mark and app icon

The app icon is the listener mark (next section) on a black ground, decided 27 Sep 2026 over
the earlier metallic plus. Two icons ship, both rendered by `scripts/make-listener-icons.py`
from the same geometry as the brand marks:

- **AppIcon** (main): "Solid, plus in the cup". White silhouette, accent band with a thin black
  outline where it crosses the hair, accent cup with the plus cut out in black.
- **AppIcon-Line** (alternate, user-selectable): "Line art, profile". White line work, white
  headphones, white cup with an accent plus.

The web app uses the main icon for `icon.png` and `apple-icon.png`. In the tab bar the mark is a
plain plus in a circle, accent when selected. The metallic plus studies remain in
`scripts/make-app-icons.py` for reference but are no longer in the asset catalog.

## Listener mark

The app's character, from the owner's sketches: a scalloped cloud of hair, the headphone band
over the crown, the cup with its inner ring where the ear sits, a soft profile with a small nose
and a round cartoon chin (no mouth), and the neck running out of the frame. Two versions,
rendered by `scripts/make-brand-marks.py` from the geometry settled on the "Locally Mark
Studies" page: **solid** (white silhouette, accent cup, negative-space band) for the iOS welcome
screen and the web sidebar's empty state; **line** (white line, accent cup) for the iOS empty
library and the web sidebar's brand mark. A later design session may revise the shape; only the
script changes.

## Type

System font. Sizes are points on iOS, px on web. Tight tracking on titles, wide on eyebrows.

| Role | Size | Weight | Colour | Tracking |
| --- | --- | --- | --- | --- |
| Page title, desktop | 36 | bold | text | -0.02em |
| Page title, mobile | 24 | bold | text | -0.03em |
| Page subtitle (desktop, under the title) | 16 | regular | text-muted | |
| Section title (Metadata, Tracks) | 22 / 18 | bold | text | -0.03em |
| Eyebrow (LOCAL LIBRARY, YOUR COLLECTION, DETAILS) | 11 (12 desktop) | bold | accent | 0.18em, uppercase |
| Breadcrumb eyebrow (LIBRARY / SINGLE) | 12 | semibold | text-dim | 0.17em, uppercase |
| Header meta, right-aligned (7 tracks, Tap to edit) | 12 to 14 | regular | text-muted | |
| Field label | 11 (12 desktop) | bold | text-muted | 0.14em, uppercase |
| Input text | 16 mobile, 14 desktop | regular | text | |
| Row title | 15 mobile, 14 desktop | semibold | text | |
| Row subtitle | 14 mobile, 12 desktop | regular | text-muted | |
| Drop-zone line / hint | 14 medium / 12 | | text-soft / text-hint | |
| Nav title (mobile top bar) | 18 | bold | text | |
| Badge | 10 | semibold | text-muted | 0.1em, uppercase |
| Primary button | 15 mobile, 14 desktop | bold | black on accent | |

## Shape and spacing

- Radius: inputs and thumbnails 6; drop zones, cards and file rows 8; list containers 12; the
  editor's big cover 10; dialogs 9; buttons, pills and badges fully rounded.
- Page padding: mobile 16 (list) to 20 (forms); desktop 40 to 64, content max width 896 (desktop
  form) or 920 (desktop release page).
- Section gap 32 (mobile editor sections 28). Label to input 8. Between fields 16. List rows
  have no gap; a 1 px `border` separates them inside the container.
- Inputs: padding 16 horizontal, 12 vertical; mobile min height 48. Focus shows a 2 px `accent`
  ring, no border colour change. Mobile inputs also carry a 1 px `border`; desktop inputs none.
- Primary button padding 32 horizontal, 12 vertical; on mobile it is full width, 48 tall, in a
  sticky footer. Press feedback: scale to 0.95. Disabled: 50 % opacity.
- Big cover on the mobile editor has a soft shadow (0 12 36, black at 45 %).

## Components

- **Page header**: eyebrow in `accent`, then the title; on desktop a `text-muted` subtitle under
  it ("Add a song or album to your Spotify library."). Section headers use the same eyebrow +
  title on the left with a `text-muted` meta on the right ("7 tracks", "Tap to edit", "1 file").
- **Segmented pill** (Single | Album): `elevated` track with 4 padding, selected segment an
  `accent` pill with black semibold text and a faint shadow, others `text-muted` (white on hover).
- **Primary button**: `accent` pill, black bold text. **Secondary**: `elevated` pill, white text.
  **Outline**: transparent with a `text-dim` border, white text. **Text button** (Cancel):
  `text-muted`, white on hover, no background.
- **Sticky footer CTA (mobile)**: fixed to the bottom, `bg` at 95 % with blur, 1 px `border` on
  top, padding 16 horizontal and 12 to 16 vertical plus the safe-area inset, containing one
  full-width primary button. Library: "+ New Import" (Locally: "Add a song"). Editor: the send or
  save action. Content scrolls under it with bottom padding so nothing hides behind it.
- **Mobile top bar**: 64 tall, `bg` at 90 % with blur, sticky; back chevron (28) at the left when
  there is a parent; title 18 bold; an optional trailing icon button (search, more). iOS keeps the
  system navigation bar and tab bar and styles them to match.
- **Text field**: `elevated`, radius 6, label above in field-label style, placeholder at
  `text-muted` 60 %. Year and Genre sit side by side in a two-column grid.
- **Library toolbar (desktop)**: under the "All music" header, a search field (magnifier at the
  left, placeholder "Search titles, artists, genres…", ⌘F focuses it, Escape clears it) beside a
  sort menu (Recently updated, Title A–Z, Artist A–Z, Year, newest first). Both use the text-field
  style. The sidebar list follows the same query and sort and shows "Showing matches for …" with a
  Clear link while a query is active. No matches shows "No matches for …" with a Clear search
  pill; an empty library keeps the onboarding state.
- **Library selection (desktop)**: a "Select" pill on the toolbar swaps it for a selection bar
  ("{n} selected", Select all / Deselect all, "Edit details…", "Delete…" in `danger`, Done;
  Escape also leaves). Rows show a 20 checkbox (`accent` when ticked) in place of the chevron and
  toggle on click. Delete confirms inline in the bar, in the release page's confirm style. Edit
  details opens a `card` dialog with Artist, Year and Genre; blank fields stay unchanged and
  tracks are re-tagged in place. Both run per release through the existing endpoints and report
  "Deleted 2 of 3 releases; failed: …" in a toast.
- **Cover drop zone** (import): the desktop import shows only the 120 compact square, a `card`
  block with a 1 px dashed `border-dashed` (accent on hover), an image-plus icon (24, `text-muted`,
  accent on hover) and "Click or drop an image" at 11 pt in `text-soft` (iOS: "Tap to choose a
  cover"); a 28 pencil badge appears once filled. The hint "Square artwork works best" is rendered
  once by the import layout under that row (see the Desktop import layout bullet).
- **Audio drop zone**: a `card` block, min height 128, dashed border as above, an upload-cloud
  icon (26), "Drop audio files here, or click to choose" (iOS: "Tap to choose a file") and the
  hint "Singles are one file. Switch to Album for multiple." Below it, before any track exists,
  a faint silhouette of empty `FileRow`-shaped blocks (`card` at 50% opacity, a `border` stroke,
  no text or icon) stands in for the Tracks list, with a centred `text-muted` blurb ("No tracks
  yet" / "Add audio files above and they'll appear here."): three rows in the album builder, one
  row in the single-track flow while no file is chosen. Placeholder cards are spaced `2 ×` the
  usual row gap so the empty state matches the gap between live file rows in the plain list.
  Once there are 2 or more tracks, a
  `text-dim` 12 pt line under the Tracks header reads "Hold and drag a track to reorder." — the
  album builder's list supports long-press drag-to-reorder without an Edit mode on iOS 16+, so
  there is no toolbar Edit button any more (it only mismatched the Single/Album layouts).
- **Desktop import layout**: cover first — a 120 compact square beside Title and Artist, so the
  cover stays in view while those are typed — then the hint "Square artwork works best", then
  Year and Genre in a two-column grid. The audio drop zone is full width and tracks follow. A
  footer row with a 1 px `border` on top holds a `text-dim` note "Your files stay on this device."
  on the left and the primary button on the right.
- **Library list (mobile)**: one `card` container, radius 12, 1 px `border`; rows 78 min height
  with 12 padding, 56 square art radius 6 (or an `elevated` tile with a muted note icon), title
  and subtitle (albums: "artist · N tracks"), a `text-dim` chevron at the right; rows separated by
  1 px `border`; press background `row-hover`. Header above: eyebrow "YOUR COLLECTION", title
  "All music", meta "N tracks". The list is split into two sections, **Singles** then
  **Albums**, each with an 18 bold label and its count in `text-dim`, separated by a 1 px
  `border-dashed` rule (dash 4/4). A section with nothing in it is not shown. Desktop mirrors the
  same sectioning in the main Library view (and in the sidebar list).
- **Editor / release detail (mobile)**: a slim, sleek layout rather than a full-width hero. Top
  bar with back and the release title. Below it a header row: a 112 pt square cover, radius 10,
  1 px `border`, with a 28 pt circular pencil badge bottom-right (`bg` at 80 % with blur, icon
  12 semibold) that opens the Photos/Files menu, beside a column holding the kind badge, the title in page-title style (2 lines max) and the
  artist in row-subtitle muted text. Then the DETAILS eyebrow + "Tap to edit" (no "Metadata"
  title); Title and Artist fields full width, Year and Genre side by side. Then "Tracks" (18
  bold) + "N files", a `text-dim` 12 pt hint "Hold and drag a track to reorder." when there are
  2+ tracks, and one compact file row per track: `card` with 1 px `border`, radius 8, min height
  52, a 30 pt `elevated` tile holding an accent file-music icon, filename 14 medium, "Audio file"
  12 muted, chevron. No Edit-mode toolbar button; reordering is a plain long-press drag. Sticky
  footer with the save action.
- **Desktop release page**: the same compact header as the mobile editor, on the 920-wide page.
  A 112 cover thumb (radius 10, 1 px `border`, 28 circular pencil badge) sits beside the kind
  badge, the title (page title, 2 lines) and the artist in `text-muted`. Under that, the DETAILS
  eyebrow and "Tap to edit" (no separate Metadata title), then Title, Artist, and Year/Genre.
  Tracks, the playlist disclosure, and the action row follow.
- **Make it a playlist (album release pages, both apps)**: a disclosure between the Tracks
  section and the action row, `card` with 1 px `border`, radius 9, padding 20, title "Make it a
  playlist" with a chevron that rotates open. Body: the album title beside a small secondary /
  outline "Copy" button (copy icon, reads "Copied" for two seconds after a click), the
  per-platform steps in `text-muted` 14, and the fallback line "If Add to playlist is missing,
  update Spotify and open it again." in `text-dim` 12. Open by default on the release page an
  album import lands on; collapsed when opened from the library. iOS renders the same body in
  the existing `DisclosureGroup` and on the done screen after an album send.
- **Crop dialog**: `card` with `dialog-border`, radius 9, padding 20 to 24, title "Crop cover"
  19 bold; the preview on #050505 with the image, an outer white 25 % border, centre lines at
  white 10 %, and an inner frame inset 12 at white 60 %; under it a centred Square | Original
  segmented pill (padding 2, segments 20 by 6, 14 pt), the hint "Spotify shows covers as a
  square." centred in `text-muted`, and a right-aligned row of Cancel (text button) and Done
  (primary, 24 by 10).
- **Kind badge** (SINGLE / ALBUM): `elevated` pill, badge type.
- **Errors**: `danger` 12 text under the field or button that failed.
- **Empty state (library home, both apps)**: doubles as onboarding. A diagram of two 68 pt
  `elevated` tiles, radius 16, 1 px `border`: the app icon / solid listener mark (captioned
  "Locally"), three accent dots and a chevron, a note icon (captioned "Spotify"; never Spotify's
  logo). Below: eyebrow "YOUR LIBRARY", title "Nothing here yet" (24 bold mobile / 36 desktop),
  one line of `text-muted` 14 body, then a primary "Add your first single" and a secondary "Make
  an album" pinned low. The web sidebar empty line stays the short `text-muted` hint; the full
  empty state lives in the main Library view.
- **Web sidebar**: nav pills (Library, + Import, Settings), Singles then Albums section labels
  with counts, rows, brand mark, on `card`. The MagicPath sidebar is not used.
- **Library list (desktop main)**: same sectioning as mobile — YOUR COLLECTION / All music
  header with track-count meta, Singles then Albums in `card` containers (radius 12), "Add a
  song" primary below. Sidebar rows stay compact (40 art) for quick jump.
