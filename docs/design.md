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
| danger | #F15E6C | errors, delete |
| accent | #1E7DF0 (hover #3B8EF5) on both platforms, decided 27 Sep 2026 | eyebrows, primary buttons, selected segment, focus ring, accent icons, the shimmer on the app icon |

The accent is the same on both platforms. It replaced the web app's Spotify green and the iOS
orange placeholder; never reintroduce a green near #1DB954 (App Store branding rule in
`docs/ios-plan.md`).

## Mark and app icon

The mark is a plus sign cast in chrome, with a shimmer band running across it off-centre
(42 % across, tilted 34°), corners eased to radius 27 of a 240-wide bar. The main app icon is
the chrome plus on black with the shimmer tinted by the accent. Four alternates ship as
user-selectable icons: accent-coloured metal on black, gunmetal on the accent, chrome on the
card grey, and accent metal on the accent. All are rendered by `scripts/make-app-icons.py`
(`--accent 1E7DF0 --corner 27 --shimmer 42 --tilt 34`); the studies that led here are the
"Locally Mark Studies" page. In the tab bar the mark is a plain plus in a circle, accent when selected.

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
| Drop-zone line / hint | 14 medium / 12 | | #D7D7D7 / text-hint | |
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
- **Cover drop zone** (import): a square `card` block with a 1 px dashed `border-dashed` (accent
  on hover), an image-plus icon (30, `text-muted`, accent on hover), "Click or drop an image"
  (iOS: "Tap to choose a cover") and the hint "Square artwork works best".
- **Audio drop zone**: a `card` block, min height 128, dashed border as above, an upload-cloud
  icon (26), "Drop audio files here, or click to choose" (iOS: "Tap to choose a file") and the
  hint "Singles are one file. Switch to Album for multiple."
- **Desktop import layout**: two columns, 240 cover column and the form; fields in a two-column
  grid; the audio drop zone full width; a footer row with a 1 px `border` on top holding a
  `text-dim` note "Your files stay on this device." on the left and the primary button on the
  right.
- **Library list (mobile)**: one `card` container, radius 12, 1 px `border`; rows 78 min height
  with 12 padding, 56 square art radius 6 (or an `elevated` tile with a muted note icon), title
  and subtitle, a `text-dim` chevron at the right; rows separated by 1 px `border`; press
  background `row-hover`. Header above: eyebrow "YOUR COLLECTION", title "All music", meta
  "N tracks". Desktop keeps the current sidebar rows.
- **Editor / release detail (mobile)**: top bar with back and "Edit Metadata" (Locally: the
  release title); a full-width square cover, radius 10, shadow, with an "Edit" pill overlay
  bottom-right (`bg` at 80 % with blur, pencil icon 14, 14 semibold text); then the DETAILS
  eyebrow + "Metadata" + "Tap to edit"; the fields; then "Tracks" (18 bold) + "N files" and one
  file row per track: `card` with 1 px `border`, radius 8, min height 64, a 36 `elevated` tile
  holding an accent file-music icon, filename 14 medium, "Audio file" 12 muted, chevron; sticky
  footer with the save action.
- **Desktop release page**: breadcrumb eyebrow "LIBRARY / SINGLE", title 36, "artist · year" in
  `text-muted`, then a 180 cover beside the fields.
- **Crop dialog**: `card` with `dialog-border`, radius 9, padding 20 to 24, title "Crop cover"
  19 bold; the preview on #050505 with the image, an outer white 25 % border, centre lines at
  white 10 %, and an inner frame inset 12 at white 60 %; under it a centred Square | Original
  segmented pill (padding 2, segments 20 by 6, 14 pt), the hint "Spotify shows covers as a
  square." centred in `text-muted`, and a right-aligned row of Cancel (text button) and Done
  (primary, 24 by 10).
- **Kind badge** (SINGLE / ALBUM): `elevated` pill, badge type.
- **Errors**: `danger` 12 text under the field or button that failed.
- **Empty state**: `text-muted` 14, "No releases yet. Import your first track or album to get
  started."
- **Web sidebar**: unchanged from the current web app (nav pills, LIBRARY eyebrow, rows, brand
  mark), on `card`. The MagicPath sidebar is not used.
