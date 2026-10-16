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
| card | #121212 | cards, list containers, drop zones, dialogs, cover placeholder |
| elevated | #282828 | inputs, segmented control track, secondary buttons, badges, icon tiles |
| elevated-hover | #3A3A3A | hover on elevated surfaces (web) |
| row-hover | #1C1C1C | pressed/hovered list rows |
| border | #282828 | 1 px borders on cards, rows, inputs (mobile) |
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

System font. Sizes are points on iOS, px on web. Tight tracking on titles, wide on eyebrows *(eyebrow tracking replaced 13 Oct 2026, see the note below the table)*.

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

**Replaced 13 Oct 2026 (sentence case).** Small uppercase tracked labels are no longer used, so the
eyebrow, breadcrumb eyebrow, field label and badge rows above are replaced. Labels are sentence
case, e.g. `text-sm font-semibold text-accent` on web. The `text-dim` and `accent` roles that name
eyebrows still apply to those labels.

## Shape and spacing

- Radius: inputs and thumbnails 6; drop zones, cards and file rows 8; list containers 12; the
  editor's big cover 10; dialogs 9; buttons, pills and badges fully rounded.
- Page padding: mobile 16 (list) to 20 (forms); desktop 40 to 64, content max width 896 (desktop
  form) or 920 (desktop release page). The desktop library has no max width by default: it fills
  the pane with about 24 px each side at `md` and 32 px from `lg` (Full width, #207); the
  Comfortable setting keeps a centred 920 column.
- Section gap 32 (mobile editor sections 28). Label to input 8. Between fields 16. List rows
  have no gap; a 1 px `border` separates them inside the container.
- Inputs: padding 16 horizontal, 12 vertical; mobile min height 48. Focus shows a 2 px `accent`
  ring, no border colour change. Mobile inputs also carry a 1 px `border`; desktop inputs none.
- Primary button padding 32 horizontal, 12 vertical; on mobile it is full width, 48 tall, in a
  sticky footer. Press feedback: scale to 0.95. Disabled: 50 % opacity.
- Big cover on the mobile editor has a soft shadow (0 12 36, black at 45 %).

## Components

- **Page header**: eyebrow in `accent` (replaced 13 Oct 2026: sentence case), then the title; on desktop a `text-muted` subtitle under
  it ("Add a song or album to your Spotify library."). Section headers use the same eyebrow +
  title on the left with a `text-muted` meta on the right ("7 tracks", "Tap to edit", "1 file").
- **Buttons on the Mac (#155, 15 Oct 2026; classes in `apps/web/src/app/globals.css`)**: no
  filled blue. **Main actions** (`.btn-save`: Save to library, Show in Finder, Add to library,
  Sign in, Sync now…) are just their bold white label at rest, no fill or border; on hover or press
  they light up into the phone-tray cloud button's glass (`.glass-fake`, unchanged) with a mild
  glow off the lower edge in the cover's colour (`--btn-tint`, set from the cover palette on the
  release dock) or a faint clear blue (`--btn-tint-default`) elsewhere, and one soft shimmer per
  hover. **Secondary** (`.btn-ink`: Cancel, Select, Sign out, Copy…) is underlined text whose line
  draws in on hover, with a soft white halo; **destructive triggers** (`.btn-ink-danger`) are the
  same in pink with a red halo, and final confirms stay a solid `danger` fill. **Toggles**
  (`.btn-seg`: List / Grid, Single / Album, library width) are words with a dot under the chosen
  one. **Glow** (`.btn-save.btn-glow`, the Import invitation's Add a track) is clear glass at rest
  that fills with drifting fluorescent blue light on hover. A choice among several periods
  (`.seg-glass`, the Stats page) puts the chosen option on the same glass as a hovered main
  button. Not 2000s gloss: no gel highlight, no saturated fills, no coloured outer glow.
- **Segmented pill and buttons on iOS** (until #160 carries the Mac set over): segmented pill is
  an `elevated` track with 4 padding, selected segment an `accent` pill with black semibold text;
  **Primary button**: `accent` pill, black bold text. **Secondary**: `elevated` pill, white text.
  **Outline**: transparent with a `text-dim` border, white text. **Text button** (Cancel):
  `text-muted`, white on hover, no background.
  On iPhone the record's Single / Album switch is replaced (16 Oct 2026, owner: the switch and
  the main buttons "look bland"; the library and crop sheet keep this pill). It is the **kind
  switch**: a faked-glass capsule track (the Glow pill's glass and 1 pt rim), each option an
  icon and a word (Single `music.note`, Album `rectangle.stack.fill`; subheadline semibold), the
  chosen one white on a glass thumb tinted with the cover's colour (the palette's primary at 55 %
  over black at 35 %, so the label keeps 4.5:1 on a bright colour; a brighter rim, a soft glow
  of that colour under it), the other white at 55 %. Each option is at least 44 pt tall. The
  thumb slides to the new option (spring, response 0.35, damping 0.85) with a selection haptic;
  Reduce Motion moves it without sliding. No cover: the thumb is tinted `accent`. Locked: 50 %.
  At the accessibility text sizes the switch takes its own line above the track count and drops
  its icons, so both words fit side by side.
- **Cover glow button** (iPhone, 16 Oct 2026, same owner request): **Send to Spotify** on the
  record and **Save changes** in the release page's dock. A dark base (black at 88 %, so the list
  scrolling under the footer never shows through), the Glow pill's faked glass and rim
  with a white bold label and a leading icon (Send `paperplane.fill`, Save `checkmark`), lit at
  rest by two soft clouds of the cover's colours (palette primary and secondary; `accent` and
  violet with no cover) rising from the lower edge inside the capsule (62 % at rest, 95 % pressed), and a soft halo of the
  primary colour under it, the Mac's main action in its lit state since a phone has no hover.
  Pressed: the clouds brighten, one shimmer (a soft white diagonal band) sweeps across once
  over 600 ms, scale 0.97, easing `cubic-bezier(0.16, 1, 0.3, 1)`. Reduce Motion: the brighten
  only, no shimmer and no scale. Disabled: glass only, no clouds or halo, the label at 50 %.
  While sending it keeps its progress line in white.
- **Sticky footer CTA (mobile)**: fixed to the bottom, padding 16 horizontal and 12 to 16
  vertical plus the safe-area inset, containing one full-width primary button. Library: "+ New
  Import" (Locally: "Add a song"). Editor: the send or save action. Content scrolls under it with
  bottom padding so nothing hides behind it. (Replaced 15 Oct 2026, from the #205 phone check: the
  95 % `bg` slab and its 1 px top `border` cut the page off in a hard band.) No border and no
  slab: the button floats over the page as in Oura or Insight Timer, on a faked-glass fade from
  clear, 48 above the bar, to `bg` at 85 % by the bar's top (however tall the bar grows) and 94 % at the bottom edge (no
  blur), so content scrolling under it fades out rather than being cut. With nothing to show (an empty library) there is no
  footer at all.
- **Mobile top bar**: 64 tall, `bg` at 90 % with blur, sticky; back chevron (28) at the left when
  there is a parent; title 18 bold; an optional trailing icon button (search, more). iOS keeps the
  system navigation bar and tab bar and styles them to match.
- **Text field**: `elevated`, radius 6, label above in field-label style, placeholder at
  `text-muted` 60 %. Year and Genre sit side by side in a two-column grid.
- **Library toolbar (desktop)**: under the "All music" header, a search field (magnifier at the
  left, placeholder "Search titles, artists, genres…", ⌘F focuses it, Escape clears it) beside a
  sort menu (Recently updated, Title A–Z, Artist A–Z, Year, newest first). Both use the text-field
  style. No matches shows "No matches for …" with a Clear search pill; an empty library keeps the
  onboarding state.
- **Library selection (desktop)**: a "Select" pill on the toolbar swaps it for a selection bar
  ("{n} selected", Select all / Deselect all, "Edit details…", "Delete…" in `danger`, Done;
  Escape also leaves). Rows show a 20 checkbox (`accent` when ticked) in place of the chevron and
  toggle on click. Delete confirms inline in the bar, in the release page's confirm style. Edit
  details opens a `card` dialog with Artist, Year and Genre; blank fields stay unchanged and
  tracks are re-tagged in place. Both run per release through the existing endpoints and report
  "Deleted 2 of 3 releases; failed: …" in a toast.
- **Cover drop zone** (import; the Mac import now uses the record sleeve, see **Desktop import**
  below, and keeps this square only as CoverPicker's `compact` presentation): a 120 compact square, a `card`
  block with a 1 px dashed `border-dashed` (accent on hover), an image-plus icon (24, `text-muted`,
  accent on hover) and "Click or drop an image" at 11 pt in `text-soft` (iOS: "Tap to choose a
  cover"); a 28 pencil badge appears once filled. The hint "Square artwork works best" is rendered
  once by the import layout under that row (see the Desktop import layout bullet).
- **Audio drop zone**: a `card` block, min height 128, dashed border as above, an upload-cloud
  icon (26), "Drop audio files here, or click to choose" and the
  hint "Singles are one file. Switch to Album for multiple." (The iPhone has no drop zone since
  #205: the import invitation and the record's Add a track replace it.) Below it, before any track exists,
  a faint silhouette of empty `FileRow`-shaped blocks (`card` at 50% opacity, a `border` stroke,
  no text or icon) stands in for the Tracks list, with a centred `text-muted` blurb ("No tracks
  yet" / "Add audio files above and they'll appear here."; on iPhone "Add audio files and
  they'll appear here."): three rows in the album builder, one
  row in the single-track flow while no file is chosen. Placeholder cards are spaced `2 ×` the
  usual row gap so the empty state matches the gap between live file rows in the plain list.
  Once there are 2 or more tracks, a
  `text-dim` 12 pt line under the Tracks header reads "Hold and drag a track to reorder." — the
  album builder's list supports long-press drag-to-reorder without an Edit mode on iOS 16+, so
  there is no toolbar Edit button any more (it only mismatched the Single/Album layouts).
- **Desktop import** (#159): importing is making a record. It is two screens on the library's drifting colour sky (`ImportSky`, the
  library's `AmbientSpace` in calm blue tones, under the see-through sidebar too).
  - *Invitation* (no tracks yet): the Import pill's accent sweeps left to right across the pane
    once (700 ms), then a bare disc (176, accent house label), "Add a track" and "or drop audio
    files here" fade in and rise 6 px. "Add a track" is `.btn-save btn-glow`: a clear glass pill
    that fills with a cloud of fluorescent blue light on hover, press or keyboard focus, the
    light drifting slowly while it is lit. Audio dropped anywhere on the pane is added.
  - *The record* (once a track is added; it stays if every track is removed): the release page's
    layout. The sleeve says "Add cover art" (click, or drop an image: the existing crop dialog),
    the disc peeks out, a meta line holds the Single | Album toggle and the track count, then the
    title (placeholder "Same as track title" for a single, "Album title"), artist, Year and Genre
    as inline fields that show a faint underline while empty, then the tracks (rename, remove,
    reorder as before; "Reading tags…" while the files are read). The dock is the release
    page's: "Add to library" (`.btn-save`, disabled until a file and an artist are in, "Adding…"
    while importing) and "Add a track" (`.btn-ink`).
  - *The cover beat*, whenever a cover is set: the new cover slides in from the right (0 to 420
    ms, 48 px and a fade); a warm-white flash swells over the sleeve to fully opaque (420 to
    720), holds (720 to 820) and fades (820 to 1300) while the pane's colours turn to the cover's
    (starting at 420, on the 900 ms backdrop fade); the disc then slides all the way into the
    sleeve with a 240 degree turn (1340 to 2290, `cubic-bezier(0.33, 0, 0.15, 1)`). Hovering the
    record brings the disc out again. Any click or key press mid-beat jumps to the end and still
    does its job (a typed character is typed). A cover that replaces another plays the beat
    again, the disc first easing out of the sleeve. Reduced motion: no flash, slide or turn, a
    160 ms fade, the disc already in, colours at once.
- **Library list (mobile)**: one `card` container, radius 12, 1 px `border`; rows 78 min height
  with 12 padding, 56 square art radius 6 (or an `elevated` tile with a muted note icon), title
  and subtitle (albums: "artist · N tracks"), a `text-dim` chevron at the right; rows separated by
  1 px `border`; press background `row-hover`. Header above: eyebrow "YOUR COLLECTION" (replaced 13 Oct 2026: sentence case), title
  "All music", meta "N tracks". The list is split into two sections, **Singles** then
  **Albums**, each with an 18 bold label and its count in `text-dim`, separated by a 1 px
  `border-dashed` rule (dash 4/4). A section with nothing in it is not shown. Desktop mirrors the
  same sectioning in the main Library view.
- **Editor / release detail (mobile)**: *Replaced by the immersive release page (#126).*
  Former layout: a slim, sleek layout rather than a full-width hero. Top
  bar with back and the release title. Below it a header row: a 112 pt square cover, radius 10,
  1 px `border`, with a 28 pt circular pencil badge bottom-right (`bg` at 80 % with blur, icon
  12 semibold) that opens the Photos/Files menu, beside a column holding the kind badge, the title in page-title style (2 lines max) and the
  artist in row-subtitle muted text. Then the DETAILS eyebrow (replaced 13 Oct 2026: sentence case) + "Tap to edit" (no "Metadata"
  title); Title and Artist fields full width, Year and Genre side by side. Then "Tracks" (18
  bold) + "N files", a `text-dim` 12 pt hint "Hold and drag a track to reorder." when there are
  2+ tracks, and one compact file row per track (replaced on iPhone 15 Oct 2026 by the Mac-style
  track row, see *Make a record* > *Tracks*): `card` with 1 px `border`, radius 8, min height
  52, a 30 pt `elevated` tile holding an accent file-music icon, filename 14 medium, "Audio file"
  12 muted, chevron. No Edit-mode toolbar button; reordering is a plain long-press drag. Sticky
  footer with the save action.
- **Desktop release page** (#112; the iOS side is in the entry below): editing should feel like
  putting a record together, not filling in a form.
  - *Artwork backdrop*: three colours read from the cover (`src/lib/artwork-palette.ts`) wash
    the main pane: `primary` top left, `secondary` top right, `deep` fading to `bg`. Every
    colour is capped on relative luminance (0.12 / 0.08 / 0.035), so white text keeps at least
    6:1. With no cover the wash is neutral grey (#262626 / #1a1a1a / #0d0d0d). A new cover
    cross-fades the wash over 900 ms.
  - *Record sleeve* (the hero): the cover at 248 (200 below `sm`), radius 4 like printed card,
    a soft two-layer shadow and a faint top-left sheen, with the 28 pencil badge. A vinyl disc
    (228 / 184) sits behind it and peeks out to the right; its centre label is the cover art,
    or `accent` as a house label before there is one. On load the disc slides out once; on
    hover it eases out 14 px more. A new cover fades and scales in (0.96 to 1) over the old one.
    An empty sleeve reads "Add cover art" / "Drop an image or click to choose".
  - *Details*, directly under the sleeve and left-aligned, with no field boxes: a quiet meta
    line ("Album · 5 tracks", white at 70 %), the title as a 44 bold (30 below `sm`) inline
    field, the artist as a 20 semibold one, then "Year" and "Genre" as small labels each beside
    an inline value. Inline fields look like text until hovered (white 7 % fill) or focused
    (white 10 % fill plus the 2 px `accent` ring). Enter in the title commits it.
  - *Dock*: Save to library (primary), "Unsaved changes" in `text-muted` while there are any,
    Show in Finder and Delete (text buttons) in one pill of black at 70 % with blur and a white
    10 % ring. It sits under the details and pins to the top of the pane as you scroll to the
    tracks. The toast for a save reads "Saved to your library".
  - *Saving*: the record tucks most of the way into the sleeve and comes back out spinning
    1.5 turns (1.3 s in all), whatever the request takes.
  - Reduced motion: no slide, spin, scale or colour fade; changes are instant.
  - Tracks and the playlist disclosure follow, unchanged.
- **iOS immersive screens (#112; release page #126, import #127, library home #128)**: the look
  above on iPhone, with values from `apps/ios/Locally/Resources/Theme.swift` (`Theme.Immersive`
  and `Theme.Library`). The colours come from `ArtworkPalette` (#124), a port of the web's
  extraction.
  - *Artwork backdrop* (`ArtworkBackdrop`): three colours from the cover wash the screen. The
    primary sits top left (`backdropPrimaryRadius` 1.10 x 0.80 of the screen, centre 0.08, 0), the
    secondary top right (`backdropSecondaryRadius` 0.70 x 0.60, centre 0.96, 0.06), and the deep
    colour runs down to black at 0.92 of the height (`backdropDeepEnd`). The gradients fade out at
    0.72 and 0.70 of their radius. Luminance caps (`luminanceCapPrimary`, `luminanceCapSecondary`,
    `luminanceCapDeep`) are 0.12, 0.08 and 0.035, as on the web. With no cover the wash is neutral
    grey; Theme.swift gives no grey value, so none is written here. A new cover cross-fades the
    wash over 900 ms (`backdropCrossFade` 0.9 s). The two glows also drift slowly: periods 40 s and
    52 s (`driftPeriodPrimary`, `driftPeriodSecondary`), rotating -3 to 4 and 3 to -4 degrees, scaling
    1 to 1.06 and 1.04 to 0.98.
  - *Record sleeve* (`RecordSleeve`): the cover at 248 pt (`sleeveSizeRegular`) or 200 pt
    (`sleeveSizeCompact`), radius 4, with a far and a near shadow, an edge at 10 % opacity and a
    135 degree sheen at 8 % that fades out by 40 % (`sleeveEdgeOpacity`, `sleeveSheenOpacity`,
    `sleeveSheenEnd`). The disc is 0.92 of the sleeve (228 / 184 pt,
    `discToSleeveRatio`) and half of it shows past the sleeve (`discPeekRatio`). The label is 36 %
    of the disc across, with a 3 pt ring at 50 % and a spindle at 8 % of the label.
  - *Ceremony* (save): 1.3 s in all. The disc goes 0.42 of its width into the sleeve over the first
    0.325 s (`ceremonyTuckFraction`, `ceremonyTuckDuration`), then eases back out. The spin starts
    at 0.28 s and runs two full turns (720 degrees, `ceremonySpinDegrees`) to the end. The web
    turns 1.5 times (540 degrees) and snaps back; iOS uses two turns so it ends on the same pose.
  - *Cover change*: a new cover fades in from opacity 0 and scale 0.96 over 0.52 s
    (`coverFadeDuration`, `coverFadeScale`), over the old one.
  - *Inline fields* (`InlineField`): they read as text. A focused field shows a 1 device-pixel
    underline at 60 % opacity, with a 4 pt gap (`inlineFieldUnderlineOpacity`,
    `inlineFieldUnderlineGap`); the focus fade is 0.15 (`inlineFieldFocusFade`). Year and Genre sit
    10 pt below the title and artist (`fieldsMetaGap`). Theme.swift has no hover fill, so the
    web's 7 % and 10 % fills are not written here.
  - *Library cover view*: a grid of covers kept in Singles and Albums, in three sizes with minimum
    tile widths of 96, 150 and 300 pt and gaps of 12, 16 and 20 pt (`Theme.Library.tileMinWidth`,
    `tileGap`); with the list page padding that gives 3, 2 and 1 columns on a 402 pt phone. Tiles
    have radius 8. A pressed tile grows to 1.03 with a shadow (radius 10, 35 %, y 4) over 0.15 s.
    List rows sit in a radius 16 panel, and the divider between Singles and Albums is white at 7 %.
  - *Library sky*: an `ArtworkBackdrop` fixed behind the library, coloured by the cover last
    pressed or else the first cover on screen. A pressed cover stops colouring it after 120 pt of
    scroll (`pressedSkyReleaseDistance`). As the library scrolls, the two glows turn 28 and 22
    degrees per screen scrolled (`scrollTurnPrimary`, `scrollTurnSecondary`), against each other.
  - *Reduced motion*: the cover change becomes a plain opacity change over 0.2 s
    (`reducedMotionFadeDuration`), with no scale. The library sky is held still (STATUS, #128).
    Theme.swift has no reduced-motion values for the save ceremony on the release page, so its
    behaviour under Reduce Motion is not written here and not verified. The import's cover beat
    has its own Reduce Motion rules, under *Make a record* below.
  - *Make a record* (import, #205): the Mac's Desktop import (#159) on iPhone, on the studio
    backdrop (`StudioBackdrop`) until a cover is set, with the tab bar on the backdrop as in
    Settings. Values in `Theme.Import`; the beat's clock and curves in
    `Views/Import/ImportBeat.swift`, the same numbers as `apps/web/src/lib/import-flow.ts`.
    - *Invitation* (no track yet): an accent band sweeps left to right across the screen once
      (700 ms, skewed 12 degrees, fully showing by 12 % of the way and gone at the end), then a
      bare disc (176 pt, accent house label), **Add a track** and "or add audio from Files" fade
      in and rise 6 pt (480 ms, after 280 ms). It plays each time the invitation appears. Add a
      track is a clear glass pill (a white 14 % to 4 % fill, a 12 % rim with a 32 % top edge)
      that fills with three soft clouds of fluorescent blue light (azure, ice and cobalt over a
      thin blue wash) while it is pressed: they fade in over 0.3 s and drift slowly back and forth
      (4 s) while lit, with a soft dark pool under the label so the white text keeps at least
      4.5:1 against the light at every point of the drift. The clock that runs the sweep stops
      once it has played, so a waiting invitation draws nothing. It opens Files with several files allowed: one file starts a single, two
      or more an album (the iPhone has no drop and no switch before the record, so the count
      decides; the library's "Make an album" still starts an album). Files shared in from other
      apps go straight to the record. The page title is gone; the waiting chips and toasts stay
      at the top.
    - *The record* (once a track is added; an album stays a record if every track is removed,
      until it is saved): the release page's layout. The sleeve says "Add cover art" (the cover
      sheet: recent covers, Photos, Files, then the crop) and the disc peeks out; a meta line
      holds the Single / Album switch and the track count; then the title, artist, album (a
      single only, "Album, same as track title"), year and genre as inline fields; then the tracks in
      the faked-glass panel (white 6 % fill, no outline; replaced 15 Oct 2026, owner on the
      phone: the 10 % hairline round the panel and the 1 px `border` box round each file row
      read as borders; on iPhone a file row inside a panel has no fill and no border, and the
      empty-state silhouette blocks lose their stroke too; the release page's tracks panel
      is the same component). Switching kind keeps the fields and the cover, and a single
      keeps only the first track.
    - *Tracks* (replaced 15 Oct 2026, owner: the rows looked like the first iPhone version;
      they now follow the Mac's track list, `TrackList`, and a track is replaced from its own
      row). Each row is the Mac's: min height 48, the number (subheadline, tabular, white 60 %,
      24 wide), the title as an inline field (body semibold; an album's is editable, a single's
      is the file's), and at the trailing edge a **replace** button (circling arrows, white
      60 %, 44 pt hit area, "Replace <title>" for VoiceOver) that opens Files for one audio file
      and swaps it in at that position, the title taken from the new file's tags or name; then,
      on an album of two or more, the Mac's grip (three lines, white 35 %) as the hint that rows
      drag. At the accessibility text sizes the number takes only its own width, the title wraps
      (up to four lines) and the plays sit under it. Replace and Add a track do nothing while
      files load or the record sends. No music
      tile, no "Audio file" caption, no chevron. Rows are divided by the Mac's hairline (white
      7 %, from the number's leading edge, none above the first or below the last). A long
      press lifts a row with the system's normal drag (owner: no glass tile, "just a normal
      drag"). A **single** is just its one row in the panel:
      no "Tracks" heading and no Add a track, since the row's replace button does that. An
      **album** keeps the "Tracks" heading, the "Hold and drag a track to reorder." hint, swipe
      to delete and **Add a track** at the end, and every row has replace. The release page's
      tracks panel uses the same row, with its plays ("12 plays", muted, tabular) where the
      Mac shows them and no replace button, since a saved release's files are not swapped.
    - *Send* (replaced 15 Oct 2026, owner: the record goes into its cover, then a playful
      "Sent" pop-up, in place of the release page's ceremony and the done screen). Tapping
      Send closes the keyboard and scrolls the record back to the sleeve (350 ms, then a short
      settle), then the disc slides all the way into the sleeve, turning 240 degrees (950 ms,
      curve 0.33, 0, 0.15, 1), while the files are written. If the send fails, the disc eases
      back out to its peeking pose (600 ms, curve 0.2, 0.8, 0.2, 1) and the message sits in the
      footer just above Send, on a soft dark halo (`bg` at 90 %, blurred 8) so the list never
      shows through it, at most 5 lines (3 at the accessibility text sizes; VoiceOver reads it
      all), with a **Details** link opening the whole message in a sheet when that cuts it short.
      Once the disc is in and the send has worked, the **Sent card** pops up over everything,
      tab bar included, modelled on Google Health's "You're all set" card: the page dims (black
      45 %, 250 ms); a compact card (`card`, radius 28, padding 24, 16 from the screen edges,
      sitting in the lower half) springs up from 40 pt below at 94 % scale (spring response 0.5,
      damping 0.72); behind its top edge a soft glow in the cover's colours blooms (the
      backdrop palette's colours, blurred 40, from 60 % scale and clear to full over 700 ms;
      accent and violet with no cover); the record, sealed, sits on the card's top edge
      (sleeve 96 pt, overlapping the card by half), dropping in tilted −8 degrees and settling
      to −3 with the same spring; a success haptic plays. The card says **Sent** (title, 28
      bold), "Your track has been sent to Spotify." or "Your album has been sent to Spotify."
      (body, muted), then one quiet line ("It's in Your Library, under Local Files." or "To
      play it as an album, make it a playlist from its page in your library."), then a full
      width **Open in Spotify** primary pill (opens the Spotify app; when Spotify isn't
      installed the pill is **Close** instead) and a **Close** text button. Open in Spotify and
      Close both take the page back to the invitation behind the card (a single whose share
      queue has a next file stays on the record), and Close drops the card away (200 ms). The
      card is modal for VoiceOver, which reads "Sent" first; at large text it scrolls inside
      the card. With Reduce Motion the disc is in at once, the card and glow fade in over 200 ms
      with no spring, tilt or bloom, and the haptic still plays. The release page keeps its
      ceremony.
    - *The beat*, whenever a cover is set (from Files, Photos or a recent cover), starting once
      the sheet it came from (the crop, or the cover sheet for a recent cover) has closed, so
      no sheet hides it: the cover
      slides in from 48 pt to the right with a fade (0 to 420 ms, curve 0.3, 0.5, 0.3, 1); a
      warm-white flash over the sleeve (255, 252, 246 at the centre to 255, 248, 238 at the
      edges, with a faint 16 pt spill at 40 %) swells to fully opaque (420 to 720, curve 0.45, 0,
      0.55, 1), holds (720 to 820) and fades (820 to 1300, curve 0.5, 0, 0.7, 1); the backdrop
      takes the cover's colours from 420 ms (its own 900 ms cross-fade, the studio backdrop
      fading out over 500 ms); then the disc, which stays peeking out of the sleeve as on the
      release page, turns 240 degrees into place (1340 to 2290, curve 0.33, 0, 0.15, 1). After
      the beat the record rests there, cover and peeking disc, so the page never shows a bare
      sleeve. (Changed 15 Oct 2026, owner on the phone: on iPhone the disc no longer seals into
      the sleeve as it does on the Mac, #159.) A tap anywhere, or typing in a field, mid-beat
      jumps to the end and still does its job. A cover that replaces another plays the beat
      again from the peeking disc.
      Removing the cover brings back "Add cover art", the peeking disc and the studio backdrop.
    - *Reduce Motion*: no sweep, slide, flash or turn. The invitation and a new cover fade in
      over 160 ms, the colours change at once, the disc stays peeking out of the sleeve, still,
      and the glow's light shows on press without drifting.
    - *Large text*: the fields, the buttons and the hint scale with Dynamic Type and wrap, and the
      invitation scrolls when it doesn't fit; the sleeve and the discs keep their size.
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
  logo). Below: eyebrow "YOUR LIBRARY" (replaced 13 Oct 2026: sentence case), title "Nothing here yet" (24 bold mobile / 36 desktop),
  one line of `text-muted` 14 body, then a primary "Add your first single" and a secondary "Make
  an album" pinned low. The full empty state lives in the main Library view.
- **Web sidebar (#154)**: a slim 64 px rail, always there and see-through over the page, holds the
  menu button (three lines) at the very top, then Library and the accent Import circle in the
  order the panel lists them; at its foot sit Settings and, at the very bottom, the profile: a
  32 px circle with the first letter of the signed-in email (white on an `accent` tint), or a
  person glyph when not signed in. *Since 15 Oct 2026 the profile replaces the quiet brand mark
  that used to sit at the foot, and Settings moved down from under Import.* Hovering the rail
  blooms a glass panel out of its right edge: the panel controls (**Pin down**, which shows
  "Pinned" while docked, and the Open on hover switch) level with the menu button, rows for
  Library and Import each level with its rail icon, then "Your plays" with Top tracks, Top
  albums, Top artists and an optional record-sleeve shelf (the #1 row larger, with its cover),
  and at the bottom a hairline, the Settings row and the profile row (the circle, then the
  signed-in email, "Syncing with your phone", "On this Mac", or the Demo pill with "Read-only
  sample"), each level with its rail icon. The profile, on the rail or in the panel, opens
  Settings at its account and sync section. How the panel opened decides how it
  closes: a hover-opened panel hides 300 ms after the pointer leaves; one opened with the menu
  button stays when the pointer leaves, and closes only on a second click of the button, Escape
  or choosing a page (never on a click outside); with Open on hover off the hover never opens it
  and leaving never closes it. Choosing a page, on the rail or in the panel, closes an unpinned
  panel at once so the new page is in view, and hovering does not reopen it until the pointer has
  left the sidebar and come back. Pin down docks the panel as a column, which a page choice
  leaves alone. The glass is faked (no blur), motion is transform and opacity only, and all of it
  stands still under reduced motion. The MagicPath sidebar is not used.
- **Stats page (#145; `apps/web/src/components/stats/`, built 15 Oct 2026, the source of truth)**:
  the "Stats" view in AppShell, reached from the sidebar's Stats rail icon, panel row or "See all
  stats". Top to bottom: the heading and the period control (`.seg-glass`: Today, This week, This
  month, This year, All time; scrolls sideways when the room is short); the digest sentence ("You
  played your tracks 121 times this week, mostly Night Bus to Nowhere.") with a ‹ › stepper that
  goes back (Yesterday, Last week, 2 weeks ago, Last month, ...) and wears the glass once stepped
  back; a quiet line saying what is counted ("Counted on this Mac since 15 Oct.", or "Play counting
  is off. Turn it on in Settings."; never claims other devices, #202); Tracks / Albums / Artists
  (`.btn-seg`); the sleeve fan; then everyone ranked from #1 as a List (rank, cover, name, artist,
  last played, play bar, total; Sort by Plays, Name or Recently played; ranks stay put) or a Grid
  (the sorted sea). One play total, sentence case, tabular numbers. The cover of the current #1
  washes the page (`AmbientBackdrop`, `--btn-tint` from its palette) under a darkening scrim.
  - **Data**: one `GET /api/plays/summary` per (period, step), kept 60 s, read again at local
    midnight and when the window regains focus (`usePlayStats`, shared with the sidebar). Stepping
    back is offered only while the earlier period starts within the 400 days the Mac keeps; else
    the ‹ is off with the tooltip "Kept for 400 days". The page never sends a range the server
    refuses (a test runs every reachable period against the server's check). All time ranks the
    summary's `allTime`; the response's `countingSince` (earliest day bucket) feeds the coverage
    line. Albums are releases, artists are release artists. Nothing counted: the quiet empty line
    (the demo's summary is empty), with the Settings link when counting is off.
  - **Fan** (`SleeveFan`, shared with the sidebar's shelf: three sleeves there, five here, the look
    of each size in `.fan[data-size]`): #1 in the middle in gold, silver and bronze either side (their names are gold, silver and bronze
    too, here, in the list and grid and in the sidebar; names use a bronze a shade lighter than the
    rank's, so every name colour is at least as light as the #b3b3b3 grey and keeps 4.5:1 on the wash),
    #4 and #5 outside; with fewer than five the same rule runs and the set is centred, no empty
    slots, the tilt per step widening as the fan thins (`lib/fan-layout.ts`); no items means the
    period's empty line, no fan. Hover or focus lifts a sleeve with name and plays; every record peeks a little at rest (about 9%) and the chosen one more (about 18%), the middle (label) always hidden, and the records go by status: #1 gold, #2 silver, #3 bronze (metallic vinyl) and the rest black vinyl; artists are round discs with no record. The medal records shine on an 8s loop, the owner's exception to "one shimmer per hover, never a loop": a soft band glides left to right through the top half, then about two seconds later a reverse band glides right to left through the body, each glide about 1.6 to 1.8s with a gentle start and finish; gold leads and silver and bronze follow 0.3s and 0.6s behind in their own metal's light, clipped to the disc and off under reduced motion. The page fan is a wheel: the sleeves tilt round one far pivot, so they sit on one shallow arc (not a half circle), and it is stacked with depth, each step out a little smaller and darker, like cards. At rest, before a hover or focus, number one sits at half its lift. The chosen one lifts, grows and loses its shade, and ← → wheel through them left to right; the lift stays on the keyboard-focused sleeve when the pointer leaves. The sidebar's shelf is the original tight stack of three, number one in front, with the same depth and shading. Under about 545px of room the chosen sleeve's name and plays sit in a caption under the fan instead of on the cover, and the narrow wheel lifts the chosen sleeve higher (0.6 of its width) so it clears its neighbours: at least 47px of each sleeve stays to tap in every selection state at 390px (about 41px at 360px and 36px at 320px).
  - **Activation**: a sleeve, list row and grid tile is a button. A sleeve first plays a short
    opening beat (360ms: the record slides further out, the sleeve lifts and grows a little; none
    under reduced motion, which opens at once), then the release opens. A track opens its release
    scrolled to that track's row (centred) with a one-time soft tint on the row (about 1.6s; shown
    still for 2s under reduced motion); list rows and tiles do the same without the beat. An album
    opens its release with no highlight; an artist opens the Library filtered to that artist (its search
    query). A mouse only lifts on hover. On touch the first tap lifts and the second opens; a tap
    elsewhere drops the lift. Visible focus rings (2px white; the shelf keeps its accent ring).
  - **Grid sizing**: three grids in rank order (ranks 1 to 6, 7 to 14, the rest), columns counted
    from the room by container queries with one gap, so a tile is never under 72px, nothing
    overlaps from 360 to 1600px, and a better rank is never smaller. Name under every tile (artist
    too on the biggest); rank and plays on the cover.
  - **Long lists**: the List and the Grid show 100 at first, then an ink button "Show 100 more"
    ("Show 37 more" near the end); when the last page opens, focus moves to its first row. Covers
    load lazily, and the page keeps the reads of its last 8 periods.
  - **Narrow (390px)**: the period control scrolls, the fan scales with its room (210px sleeves down
    to a fifth of the room below 545px, so it fits a 320px phone), the list drops last played below 480px of room and the bar below 760px.
  - **Contrast**: the wash is capped for white text, but the greys need more over a pale cover, so
    a scrim darkens the top of the page and the unchosen tab words are 70% rather than 50%.
    Measured over a cream cover as #1: every text 5.36:1 or better, bars 5.8:1 against their track
    (3:1 needed). Fan rank pills and tags are darker so the medal colours and white text hold on
    pale covers.
  - **Motion** (all in `globals.css`): one rise-in, the fan-out when the tab or period changes, the
    sleeve lift, record slide and tag, the grid hover lift. Nothing loops except the medal records'
    8s shine, the owner's exception (its glides use cubic-bezier(0.37, 0, 0.63, 1), a gentle in and
    out, since the house curve crossed the visible cap of the disc too fast and read as rushed). Reduced motion drops
    every animation and transition to nothing (its block is last in the file, after the rules it
    overrides).
- **Library list (desktop main)**: same sectioning as mobile — YOUR COLLECTION (replaced 13 Oct 2026: sentence case) / All music
  header with track-count meta, Singles then Albums in `card` containers (radius 12), "Add a
  song" primary below. *Since 15 Oct 2026 (#207)* each section is a full-width table, like a
  Spotify playlist: one quiet header row above the container (12, `text-dim`, sentence case:
  Title, Genre, Year, Tracks, Added; no "#" column, since the library is not an ordered list),
  then rows on one shared grid: the 56 thumbnail with title (semibold) and artist (`text-muted`)
  under it, then genre, year, track count and the date the release was added ("Feb 6, 2026", the
  user's locale), then the chevron. Numbers are tabular. An empty genre or year shows nothing.
  Columns drop as the section narrows: Added under 820, Genre under 680, Year and Tracks under
  520. One 1 px divider between rows, as before. The cover grid keeps its own layout.
- **From your devices tray (desktop, #115, #185, #172)**: a clear faked-glass cloud button at the
  top right with an `accent` count badge; open, it becomes a bare red X and the badge hides. The
  frosted tray (about 272 wide, radius 22) drops out diagonally from that corner and closes only
  from the button or Escape. It is the one surface with a real backdrop blur (28, only while open,
  a solid fill under reduced transparency), an exception kept from #115 rather than a pattern for
  new surfaces. It is at most the window height less 96 and scrolls inside itself when longer. Each pending release is a row: a small record sleeve (48 cover,
  radius 10, the disc peeking out) that is itself the Send to Spotify button (hover: the cover
  turns `accent` with a black plus and the disc rolls out), then title (15 semibold), artist and
  track count (13 `text-muted`) and a quiet origin label (12 `text-dim`: "from your iPhone", "from
  the web", "from another device"). A sent row collapses out. Rows whose files have not reached
  the server have two states, from `GET /v1/files/missing`:
  - *Still sending*: the row is greyed (the sleeve artwork alone at 50 % and greyscale; title
    `text-muted` and artist `text-dim` stay readable, so the 50 % disabled rule does not apply to
    the text) and is not a button. In place of the plus, three 4 px square
    dots sit on the cover's lower third and type out like a terminal: ".", "..", "..." and again,
    0.4 s a step with no easing between steps. These rows sort last, above one quiet footer line
    (12 `text-muted`): "Still sending this one from your phone…" / "Still sending these from your
    phone…" (another origin: "…from that device…" / "Still sending these…"). Reduced motion: the
    three dots stand still (the steps are declared only when reduced motion is not requested).
  - *Waiting on your phone*: once a later check still finds the files missing, or the record is
    an hour old. The sleeve is a still picture at 60 %; under the origin label "Waiting on your
    phone" (12 semibold, `text`), then one quiet line, "The audio hasn't arrived yet." (owner's
    choice, 15 Oct 2026, from Codex's review: lighter than the earlier "This song's files never
    reached the server.", and no stronger than a repeated check can prove), and a secondary pill, **Resync Mac and phone** (another origin: "Waiting on that device", **Resync**).
    After a press: "Asked your phone to send it again. Open Locally on your iPhone to finish." If
    the service asks to wait: "Try again in a few minutes." under the pill.
  - A re-sent release (a newer server version of it) returns to *Still sending*, never straight
    to *Waiting*; the same version pulled again changes nothing.
