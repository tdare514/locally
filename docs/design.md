# Locally design language

Shared by the Mac app (`apps/web`, the reference implementation) and the iOS app (`apps/ios`).
The web app is the source of truth for how things look; this file names the choices so the iOS
app can match them without copying markup. When the design session produces new decisions, this
file changes first and both apps follow.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| bg | #121212 | page background |
| panel | #181818 | sidebar, cards |
| elevated | #282828 | inputs, secondary buttons, segmented control track, badges, drop zones, cover placeholder |
| elevated-hover | #3A3A3A | hover on elevated surfaces |
| text | #FFFFFF | primary text |
| text-muted | #B3B3B3 | labels, secondary text, placeholders (at 60% for placeholders) |
| border | #2A2A2A | 1 px borders on inputs and panels |
| danger | #F15E6C | errors, delete |
| accent | web: #1DB954 (hover #1ED760). iOS: #FF7A00 placeholder | primary buttons, selected segment, focus ring |

The iOS app must not ship Spotify's green (#1DB954) or any near-green as its accent: the plan's
App Store branding rule. Every other token is identical on both platforms.

## Type

System font on both platforms. Sizes are points on iOS, px on web.

| Role | Size | Weight | Colour |
| --- | --- | --- | --- |
| Page title | 24 | bold | text |
| Section eyebrow (e.g. LIBRARY) | 12 | semibold, uppercase, tracking wide | text-muted |
| Field label | 14 | medium | text-muted |
| Body and inputs | 14 | regular | text |
| Row title | 14 | medium | text |
| Row subtitle and captions | 12 | regular | text-muted |
| Badge | 10 | semibold, uppercase, tracking wide | text-muted |
| Primary button | 14 | bold | black on accent |

## Shape and spacing

- Corner radius: inputs, thumbnails and cards 6; drop zones and the cover placeholder 8; buttons,
  segmented control and badges fully rounded (pill).
- Section gap 24. Gap between a label and its input 6. Gap between rows in a list 4.
- Input padding 12 horizontal, 8 vertical. Primary button padding 24 horizontal, 10 vertical.
- Page padding 24 on narrow screens, 40 on wide. Content column max width 768.
- Borders are 1 px `border`; inputs switch the border to `accent` on focus, nothing else changes.

## Components

- **Segmented control** (Single | Album): a pill track in `elevated` with 4 padding; the selected
  segment is an `accent` pill with black semibold text, the others `text-muted` text on nothing.
- **Primary button** ("Import to Spotify", "Send to Spotify"): `accent` pill, black bold text.
  Disabled: 40% opacity, no colour change.
- **Secondary button / nav item** ("Settings"): `elevated` pill or block, `text` label.
- **Text field**: `elevated` background, 1 px `border`, placeholder `text-muted` at 60%, label
  above in the field-label style.
- **Cover picker**: a square `elevated` block with a 2 px dashed `border` (about 160 on web, 120 on phone) with centred
  `text-muted` caption "Click or drop an image" (iOS: "Tap to choose a cover"); once chosen, the
  image fills the square with radius 8.
- **Drop zone / file chooser**: an `elevated` block with a 2 px dashed `border`, radius 8, centred `text` line
  ("Drop audio files here, or click to choose") and a `text-muted` 12 pt hint under it
  ("Singles are one file. Switch to Album for multiple."). iOS: "Tap to choose a file".
- **Kind badge** (SINGLE / ALBUM): `elevated` pill, badge type.
- **Library row**: 40 square thumbnail radius 6 (or an `elevated` square with a muted note icon),
  title in row-title style, artist in row-subtitle style, badge on the right, single line each,
  truncated.
- **Empty state**: `text-muted` 14 pt, "No releases yet. Import your first track or album to get
  started."
- **Sidebar** (web only): 256 wide `panel`, 1 px `border` on the right, nav pills at the top,
  LIBRARY eyebrow, release rows, a small brand mark bottom-left. iOS keeps the system tab bar
  instead; the same rows and empty state live in the Library tab.
- **Track list** (album): numbered rows with an editable title field per row, reorder controls at
  the right, `elevated` inputs, 4 gap between rows.
- **Errors**: `danger` 12 pt text under the field or button that failed.
- **Toasts / after-edit note** (web bottom-right, iOS a banner under the form): `elevated` card,
  `text` message, radius 6.
