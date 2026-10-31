# Locally design language

Shared by the Mac app (`apps/web`) and the iOS app (`apps/ios`). Version 2, 27 Sep 2026: the
first version was distilled from the web app; this one folds in the owner's MagicPath designs
("Desktop Dashboard", "Desktop Crop Overlay", "Mobile Library", "Mobile Editor"), except the
desktop sidebar, which is deliberately not adopted because its icon set reads as Spotify's. The
web app keeps its own sidebar. When the design session changes anything, this file changes first
and both apps follow.

## Design rules (30 Oct 2026)

The owner's call in the 30 Oct consistency sweep (the Consistency Checklist, picks C01 to C27): the neon, the
glowing glass buttons and the cover-glow pills look "vibe-coded" and "cartoonish". Locally should
be modern and minimal, and still have feeling. These rules come first. Where a component below
still describes a glow, shimmer, tinted thumb or glass button, that part is retired: build the
quiet version these rules describe, and rewrite the component's entry when you touch it.

**Where the feeling comes from.** The music: the cover, its colours and the record. The cover
wash, the sleeve with its disc, the disc turning while it plays and the save and import
ceremonies are the emotive parts, and they stay. Controls stay calm so those parts can carry it.

1. **Colour belongs to surfaces, not controls.** The cover's colours wash the page behind the
   content (capped, under its scrim), and the studio backdrop stands in when there is no cover. A
   button, switch, slider or chip is never tinted with the cover. `accent` marks only the focus
   ring, the selected item in a list or menu, links and eyebrows. It is never a fill behind a
   label or a light source.
2. **No light effects on controls.** No glow, halo, outer shadow in a colour, shimmer or light
   sweep, fluorescent fill, colour cloud inside a capsule, or bright rim. A control's states are a
   change of fill, opacity or text colour, nothing that emits light. Retired: the Cover Glow
   button, the Glow pill, the main button's glass-and-shimmer hover, `.seg-glass`, the tinted
   glass thumb on switches and sliders, `CoverGlowShimmer` and the glass play disc.
3. **Buttons are plain and look the same at rest on both apps.**
   - **Main action** (one per screen or bar: Save, Add to library, Send to Spotify, Sync now):
     a solid capsule, `text` fill with a black semibold label, at least 44 pt tall. Hover
     (Mac) lightens to `text-soft`; press dims to 85 %; disabled is `elevated` with a
     `text-dim` label. It has a shape at rest, since a phone can't hover.
   - **Secondary** (Cancel, Select, Copy, Done): the word alone in `text-muted`, `text` on
     hover or press. No pill, no underline animation, no halo.
   - **Destructive**: the trigger is a `danger` word; the final confirm is one solid `danger`
     capsule with a black label, with the same hover, press and focus states as the main
     action, on every confirm in both apps.
   - **Icon-only** wherever the glyph is universal (play, pause, share, close, more, add,
     back): the drawn icon in `text` at 20 to 24 pt in a 44 pt target, no circle or glass
     behind it, with an accessible label. Use an icon and a word only when the icon alone is
     unclear.
4. **Play controls are icons.** Play, pause, next and previous are the drawn glyphs in white,
   with nothing behind them. The record turning, the cover and the wash are what make playing
   feel alive.
5. **Glass is for things that float, never for things you press.** The tray, menus, popovers,
   the mini player, toasts, sheets and Mac dialogs use one glass recipe: dark, neutral, a faint
   1 px hairline, no tint and no rim light. Buttons, switches and sliders sit on that glass;
   they are not made of it.
6. **Choosers are quiet and slim.** A two- or three-way switch is a slim `elevated` track with
   a neutral thumb a step lighter (`elevated-hover`) and white labels, the same on both apps, at
   most 36 pt high on the Mac and 44 pt on the iPhone. Sliders are a thin track and a plain white
   knob. On/off switches are the platform's switch in `accent`.
7. **Rank with type, not trophies.** Stats show rank with numerals and size: #1 larger, the
   rest in a plain list. No gold, silver or bronze shine, medal discs or badges. Keep the fan of
   sleeves, but plain.
8. **One shape scale.** Corner radius 8 for inputs, tiles and small surfaces, 12 for cards,
   panels and list containers, 16 for sheets and dialogs, and a full capsule for buttons and
   switches. Covers keep 4 and sleeves keep their own spec.
9. **Motion explains, then gets out of the way.** Movement says where something came from or
   that it was saved (the sleeve tucking in, a toast rising, a sheet sliding up). No ambient
   motion on controls, no looping highlight, and every effect has a still version under Reduce
   Motion. Read `~/.claude/design/motion.md` before adding any.
10. **Loading should be invisible where it can be.** Make pages fast first, so most of them
    need no placeholder (sweep pick C19: lag and slow pages matter more than the placeholders). Where
    a wait is real, show still skeletons shaped like the content, after 300 ms, never shimmering,
    and never "Loading…" text or a blank block. A busy button keeps its label and shows a small
    spinner in place of its icon.
11. **The basics hold everywhere.** Text and icons at 4.5:1 or better on the surface they sit on
    (check on a pale cover's wash too), 44 pt touch targets, sentence case for every label,
    eyebrow and button, visible focus, and nothing that works only on hover.

**Before you ship a screen, check:** Is there any glow, shimmer, tint or coloured shadow on a
control? Does the main action have a shape at rest? Could any labelled button be an icon? Is
colour coming from the cover behind the content rather than the controls? Does it pass 4.5:1 on
the palest cover you can find? Does it still read under Reduce Motion?

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
| dialog-border | #303030 | the iPhone crop sheet's border (the Mac's dialogs are glass since #415) |
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

The web app uses the main icon for `icon.png` and `apple-icon.png`.
The shared hand-drawn set on both platforms (#213; iPhone template images `Icon/…`,
`LocallyIcon`; the Mac's `Icons.tsx`, shown at `/dev/icons` and in the iPhone gallery's `icons-set`
frame) is Library, Import (a plain plus), Stats, Person, chevron, X, pencil, search and copy,
accent when selected, and since #412 (30 Oct 2026) Settings (a drawn cog, a toothed outline with a centre hole, on both apps: it replaced
the Mac's sliders and the iPhone's `gearshape`), play, pause, next, previous, grid, list (the
Library's layout toggle on both) and sort (the Library's sort button on both); Stats' list / grid switch and the share sheet's Settings row use the drawn glyphs too; both apps' mini player and
record player use the transport glyphs (#413, #414). The owner kept SF Symbols for the
note on file rows and the Tracks and Single options, Add cover art (`photo.badge.plus`), trash,
checkmarks, seals, folder, iphone, photo, `rectangle.stack.fill`, `paperplane.fill` and system
menus. The metallic plus studies remain in
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

On iPhone every size below scales with Dynamic Type (16 Oct 2026, #226: an accessibility audit
found the library, the cover sheet, the record's track count and the Sent card's Close fixed). A
role keeps its point size at the default text size and grows with the text style named beside it:
`themeFont(_:)` with `@ScaledMetric(relativeTo:)` (page title 24 → title2, section title 18 →
title3, eyebrow and field label 11 → caption2, input 16 → body, body and meta 14 → subheadline,
row title 15 → body, row subtitle 14 → subheadline, drop-zone line 14 → subheadline, drop-zone
hint 12 → footnote, badge 10 → caption2, primary button 15 → body, chevron 13 → footnote). So
nothing changes at the default size. Screens built before this keep their layouts up to XX Large
and stack or wrap at the accessibility sizes; nothing truncates mid-word.
Controls grow from their content, not by scaling a fixed height: a pill button keeps its 48 pt
(36 pt compact) minimum and its height comes from the scaled label plus 12 pt above and below; the
library's search box keeps a 40 pt minimum and grows with its text; segmented pills (the library's
cover size, the crop sheet's Square / Original) scale their labels, keep 44 pt targets, wrap onto
two rows when the words don't fit, and mark the chosen option selected for VoiceOver.
Two things on fixed-size art stop growing instead (20 Oct 2026): the Library cloud's count badge
stops at XXXL, since the 40 pt cloud doesn't grow and its VoiceOver label carries the count; the
library's layout toggle and sort buttons stop at 84 pt (icons 35 pt), so the three-way toggle fits
a 320 pt screen. The empty sleeve's caption keeps scaling: at the accessibility sizes its note and
hint drop away and **Add cover** wraps.

| Role | Size | Weight | Colour | Tracking |
| --- | --- | --- | --- | --- |
| Page title, desktop | 36 | bold | text | -0.02em |
| Page title, mobile | 24 | bold | text | -0.03em |
| Page subtitle (desktop, under the title) | 16 | regular | text-muted | |
| Section title (Metadata, Tracks) | 22 / 18 | bold | text | -0.03em |
| Eyebrow (Local library, Your collection, Details) | 13 iPhone, 14 desktop | semibold | accent | none, sentence case |
| Breadcrumb eyebrow (Library / Single) | 12 | semibold | text-dim | none, sentence case |
| Header meta, right-aligned (7 tracks, Tap to edit) | 12 to 14 | regular | text-muted | |
| Field label | 13 iPhone, 12 desktop | semibold | text-muted | none, sentence case |
| Input text | 16 mobile, 14 desktop | regular | text | |
| Row title | 15 mobile, 14 desktop | semibold | text | |
| Row subtitle | 14 mobile, 12 desktop | regular | text-muted | |
| Drop-zone line / hint | 14 medium / 12 | | text-soft / text-hint | |
| Nav title (mobile top bar) | 18 | bold | text | |
| Badge | 10 | semibold | text-muted | none, sentence case |
| Primary button | 15 mobile, 14 desktop | bold | black on accent | |

**Replaced 13 Oct 2026 (sentence case).** Small uppercase tracked labels are no longer used, so the
eyebrow, breadcrumb eyebrow, field label and badge rows above are replaced. Labels are sentence
case, e.g. `text-sm font-semibold text-accent` on web. The `text-dim` and `accent` roles that name
eyebrows still apply to those labels. The iPhone uses them in sentence case too since #418 (31 Oct
2026): eyebrows and field labels are 13 pt semibold with no tracking, badges stay 10 pt, and Settings
and Collections carry the Mac's eyebrows ("Local library", "Your music") over their titles. A page
eyebrow on the iPhone (Library, Settings, Collections) sits on the Mac's backing, a capsule in the
page `bg` colour (10 pt across, 2 pt down, the text lined up with the title), so `accent` keeps
5.25:1 (#1E7DF0 on #000000) over the moving backdrop or a pale cover's wash; bare, it measured 2.3
to 2.8:1 on Settings. The Collections player shows "Your music" with the collection count beside it
("Your music · 5 collections", the count in `text-muted`) on the same capsule, then the title.

## Shape and spacing

- Radius (rule 8, one shape scale; the iPhone follows it since #418): 8 for inputs, tiles, drop
  zones, file rows and other small surfaces; 12 for cards, panels, list containers and grouped
  sections; 16 for sheets, dialogs and floating panels; buttons, switches, pills and badges fully
  rounded. Covers keep 4 (thumbnails, the editor's cover, the library grid, the collection builder's
  shelf and songs and the mini player's artwork too, with any selection ring at the same radius);
  sleeves keep their own spec. On the iPhone the edit-mode Tracks card is a section of a native
  inset-grouped `List`, which clips it to the system's corner (about 20 pt on iOS 26.5, measured on
  the simulator; smaller on iOS 17 and 18, not measured); it cannot be drawn at 12 without leaving
  the `List`.
- Page padding: mobile 16 (list) to 20 (forms); desktop 40 to 64, content max width 896 (desktop
  form) or 920 (desktop release page). The desktop library has no max width by default: it fills
  the pane with about 24 px each side at `md` and 32 px from `lg` (Full width, #207); the
  Comfortable setting keeps a centred 920 column. *Since 17 Oct 2026 every Mac page follows this
  setting: see **Pages at full width** at the end.*
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
- **Buttons on the Mac (#155, 15 Oct 2026; made plain by #409, 30 Oct 2026; classes in `apps/web/src/app/globals.css`, shown at `/dev/buttons`)**: the rules are **Design rules (30 Oct 2026)** above; this entry is how the Mac builds them. Nothing is tinted with the cover and nothing emits light: a state is a change of fill, opacity or text colour. **Main action** (`.btn-save`: Save to library, Show in Finder on an adopted release, Add to library, Sign in, Sync now…, one per screen, bar or card) is a solid `text` capsule with a black semibold label, 44 tall (the tray's Add all and Try all again are `.btn-save-compact`, 36 tall with a transparent strip that keeps the target at 44). Hover lightens it to `text-soft`, press dims it to 85 %, focus is a 2 px `accent` outline, disabled is `elevated` with a `text-dim` label. **Secondary** (`.btn-ink`: Cancel, Select, Sign out, Copy, Done…) is the word alone in `text-muted`, `text` on hover or press, no underline or halo. **Destructive**: the trigger (`.btn-ink-danger`) is a `danger` word, lightened 15 % toward white so it holds 4.5:1 on a cover wash; the final confirm (`.btn-danger`: Confirm delete, Delete account, Confirm revoke, Delete collection) is the main capsule in `danger` with a black label and the same hover, press and focus states. **Icon-only** (`.btn-icon`: Share in the release bar and on track rows, the Stats stepper, Hide and Dismiss in the tray) is the drawn glyph at 20 px in a 44 target with nothing behind it (`text-soft`, `text` on hover, `text-muted` pressed); give it an `aria-label`. The release page's Back, the Artist field's Open and the tray's cloud button are `.btn-icon` too (the glass ones are gone), so `--tray-size` is 44. **On/off** is the sidebar's knob switch in `accent` everywhere (`KnobSwitch`, `.sb-switch-*`): Settings and the share dialog no longer use an On/Off pill. **Choosers** are the slim switch of the next entry (#410). Retired: the main button's glass-and-shimmer hover, its resting "lit" state in the release bar, `.btn-glow` (the Import invitation's Add a track is now an ordinary `.btn-save`), and the underline and halo on `.btn-ink`.
- **Toasts, dialogs and popovers on the Mac (#415, 31 Oct 2026; `apps/web/src/app/globals.css`)**: rule 5's one glass recipe. `.glass-fake` is `rgb(24 24 28)` at 90 %, a 1 px inset hairline of white at 8 % and a black drop shadow (`0 16px 40px -16px` at 60 %); `.glass-frost` is `rgb(22 22 26)` at 88 % with a 24 px blur and no saturation boost; the release bar's body is `rgb(14 14 18)` at 92 %; each falls back to a solid `rgb(30 30 34)` under Reduce Transparency. The lit top edge, inner glow and white sheen are gone. A toast is a glass capsule (radius 22, at least 44 tall) that rises 8 px over 220 ms and simply appears under Reduce Motion. Its text wraps; an error carries a drawn alert glyph in `danger`, the only red on it, and is announced as `role="alert"` (a success has no glyph and is `role="status"`); an action such as Undo is the word alone (`.btn-ink`) and Dismiss is a `.btn-icon` X with an `aria-label`. The bulk-edit and crop dialogs and the anchored popovers use the same glass at radius 16 and fade in over 160 ms from 98 % scale, also still under Reduce Motion. The iPhone's sleeve is not on the Mac toast because the Mac has no Play next or Add to queue toast. The iPhone's Play next / Add to queue toast is a floating panel at radius 16 (#418, rule 8; its 8 pt sleeve keeps its own spec).
- **Choosers, the sort menu and the cover size slider on the Mac (#410, 30 Oct 2026; `apps/web/src/app/globals.css`)**: every two- or three-way choice is one slim switch (`.btn-seg`, rule 6): an `elevated` capsule track 36 tall with a 2 px inset, an `elevated-hover` capsule thumb that slides under the chosen option, labels in `text-muted` (white when chosen or hovered, 600 weight, 14 px), a 2 px `accent` focus ring, 85 % on press, 50 % when disabled; each option is a 44 px target through a transparent strip above and below the track; `.btn-seg-3` for three options and `.st-seg` with `--n` / `--i` for any number (the Stats period row, which still scrolls sideways when the room is short). Used by List / Grid / Artists, Single / Album, Year / Month / Day, the share link's expiry, Square / Original, library width, the Collections' Record player / List and Picture disc / Black vinyl, and the Stats period and Tracks / Albums / Artists. The Stats stepper's period, once stepped back, sits on a plain `elevated` capsule (`.period-face`). The Library sort is an icon-only `.btn-icon` (the sort glyph; `aria-label` "Sort, Recently updated") that opens a glass menu like the disc menu (`role="menu"`, `menuitemradio` items: Recently updated, Title, Artist, Year, the same four as the iPhone; the chosen one marked by an `accent` check (its label stays white: `accent` text on the glass is under 4.5:1); ArrowDown on the button opens it; arrows, Home, End, Escape and outside clicks work). The cover size slider (`.size-slider`) is a 4 px `elevated` track with three `text-muted` detents and a plain white 16 px knob in a 44 px hit height, three steps, Large by default; the list panel keeps its 12 corner. Retired: the dot toggle, `.seg-glass` and its cover-tinted thumb, the sidebar's unused `.sb-seg`, the accent native range and the native sort select.
- **Buttons, switches and the slider on iOS (#411, 30 Oct 2026, to the Design rules above).**
  - **Main button** (`MainButtonStyle`: Send to Spotify, Save changes, Add a track, Done, Next, Get
    started, Buy): a solid `text` capsule, black semibold label, 48 pt tall full width and at least
    44 pt compact, so it has a shape at rest. Pressed: 85 % opacity, no scale. Disabled: an
    `elevated` capsule with a `text-dim` label (3.3:1; rule 3 prescribes it, and WCAG exempts
    inactive controls from 4.5:1). A busy button keeps its label and shows a `ProgressView` in
    place of its icon (or beside the label); the spinner takes the label colour. The cover's
    colours never reach it. Replaces the Cover glow button, the Glow pill and the flat
    accent pill (the glow clouds, halo, shimmer and dark base are gone).
  - **Secondary** is the word alone (`TextButtonStyle`, `text-muted`, `text` while pressed) with a
    hit area at least 44 pt tall, set inside the style; **destructive** triggers are the same in `danger`. The grey pill is gone. **Icon
    buttons** (`IconButtonStyle`: the Stats stepper and History, the Collections +, the Library
    sort) are the drawn glyph in `text` in a 44 pt target with nothing behind it; 70 % while
    pressed. Done in the collection builder is the labelled main button at every text size. Its
    picks are an `accent` dot with a black check (5.25:1, white would be 4.0:1), a selected shelf
    cover gets a 2 pt `accent` outline and a selected song row a neutral white 8 % fill: no cover
    colour and no glow.
  - **Slim switch** (`SlimSwitch`, was `GlowSwitch`; the Import record's Single / Album, the
    Collections and Stats layouts, the Stats Tracks / Albums / Artists, the date sheet's Year /
    Month / Day, the crop sheet's Square / Original, the share sheet's expiry): an `elevated`
    capsule track 44 pt high at the default size, a thumb in `elevated-hover` inset 3 pt, the
    chosen word in `text` and the others in `text-muted`; an icon and a word per option, icons
    dropped at the accessibility sizes. Each option is a 44 pt target. The thumb slides (spring,
    response 0.35, damping 0.85) with a selection haptic; Reduce Motion moves it without
    sliding. Wider than the room: `.stack` puts the options in a column, `.scroll` scrolls them.
    No tint, rim, glow or shadow. The Library's layout toggle is the same track and thumb.
    Locked: 50 %. `SegmentedPill` and `TintedGlassThumb` are gone.
- **iPhone record fields, covers and library (16 Oct 2026, owner on the phone)**: the inline
  fields read as floating text, so nobody could tell what a value was or that it could still be
  edited, and the import and the release page laid the same fields out differently.
  - *Labelled fields* (`LabeledField`, import record and release page): the same order on both
    screens: Title, Artist, Album (a single being imported only), Release date, then Genre. Each
    field has a row of its own. Each row has its label at the leading edge in a fixed column (subheadline,
    `text-muted`, sentence case, no colon, 60 pt scaled with the text), then the value. A 1
    device-pixel underline sits under the value at all times: white 12 % at rest, 60 % while
    focused (fade 0.15 s). Values: the title in title3 semibold, the rest body; they wrap rather
    than truncate. Placeholders say what to type, in `text-dim`: "Enter single name" or "Enter
    album name" by kind, "Enter artist name", "Same as the single name" (a single's album),
    "Enter release date", "Enter genre"; a track row's title says "Enter track name". Rows are
    12 pt apart. At the accessibility text sizes the label sits above its value.
  - *Release date* (#221, `ReleaseDateField`; owner, 20 Oct 2026: chose the field and calendar over
    three day, month and year boxes). Its own row with the label "Release date" at its own width
    (not the shared column), then one text field with a `calendar` button at the trailing end (44 pt
    target) that opens a sheet; Genre follows on its own row (`ReleaseDateGenreRows`). The sheet
    (medium detent, large at accessibility sizes) has a Year / Month / Day switch over wheels for
    that precision, Done and Clear date; it opens on the typed value, else today. Typed forms
    (`ReleaseDateText`): 2024, 2024-05, 2024-05-17, a month and year, the numeric date in the
    phone's day and month order, and month names in the phone's language ("17 May 2024", "May
    17, 2024"), any case or accents. Leaving the field rewrites a readable date as the app writes
    it ("17 May 2024"). Two messages in `danger` under the row while the field is not focused,
    and Save and Send are blocked: "That date doesn't exist" (31/02/2024) and "Enter a year, or a
    date like 17 May 2024". A release saved before dates, with a year that is not a date, keeps
    showing it and never blocks saving other fields. View mode: "Release date 17 May 2024" in the
    details block, beside Genre when both fit one line, else stacked; "Not set" in the field.
  - *Album notice* (import record, album only): under the Single / Album line, a quiet faked-glass
    card (white 6 % fill, radius 12, 12 pt padding) with `info.circle` and caption text in
    `text-muted`: "Spotify doesn't group your own files into albums. After you send, we'll show
    you how to make a playlist of these tracks." It replaces the explainer that sat between
    Artist and Year, never blocks anything, and is not on the release page, which has the "Make
    it a playlist" guide. It appears when Album is chosen: fade in and rise 6 pt over 0.35 s,
    `cubic-bezier(0.16, 1, 0.3, 1)`; Reduce Motion: the fade only.
  - *Cover sheet on the release page*: tapping the sleeve opens the import's cover sheet (recent
    covers, Photos, Files, then Remove cover when there is one), replacing the "Change cover art"
    dialog; Remove cover is left out there until saving a release can clear its cover (today a
    release keeps its cover once it has one). Recent covers shows each picture once: covers with the same bytes appear once, as the
    newest release's.
  - *Track length*: track rows show the length at the trailing edge, before the replace button,
    as `m:ss` (`h:mm:ss` past an hour), subheadline tabular, white 60 %. It is read from the file
    when the record does not carry it, and left out when it is unknown.
  - *Library sections*: the Singles and Albums headers are buttons with a chevron after the
    count (`chevron.down`, turned -90 degrees when closed). Tapping one folds that section away
    or opens it, in the list and the cover view alike, and the choice is kept across launches.
    While a search is typed both sections show open. The chevron turns and the rows fade over
    0.3 s on the signature easing; Reduce Motion: no turn, rows appear and go at once.
  - *Eyebrows on iPhone* keep their capitals and wide tracking ("YOUR COLLECTION"): the owner
    likes them there (16 Oct 2026), an exception to the 13 Oct sentence-case rule.
  - *Sent card*: Open in Spotify (with `arrow.up.right`) is a cover glow button in the record's
    colours, matching Send to Spotify; without Spotify installed, Close takes that style. The text
    Close under Open in Spotify stays as it is.
  - *Release page: view, then edit* (owner, 16 Oct: "so that users don't accidentally just like
    change information"; the import stays the edit page). Mobbin: Copilot's "Preview budget
    changes" sheet for the review.
    - Opens in **view mode** (*details and tracks redrawn in the Mac's look since 17 Oct 2026: see **Pages at full width** at the end*): each field is its label and the value as plain text, with no
      underline or placeholder; an empty value reads "Not set" in `text-dim`. Track titles are
      plain text, rows have no grip and don't drag, the sleeve isn't a button (an empty one shows
      no "Add cover art"), Delete is hidden,
      and there is no dock. Plays, the reorder hint (hidden in view mode), the plays footnote and
      the "Make it a playlist" guide stay as they are.
    - **Edit** sits at the top right in the navigation bar (the system bar item, so on iOS 26 it
      is glass like the back button). It switches to **edit mode**, the import's look: labelled
      fields with underlines and placeholders, editable album track titles, drag to reorder with
      the grip and the hint, the cover sheet on the sleeve, Delete, and the dock (Unsaved changes,
      Save changes). In edit mode the iOS edit pattern applies: **Cancel** takes the back button's
      place at the top left and the top right is empty (Save is in the dock), so the only ways out
      are Cancel and Save. Cancel with changes asks "Discard your changes?" (Discard, destructive;
      Keep editing); with none it just leaves edit mode. In view mode VoiceOver reads the sleeve
      as "Cover", an image.
    - Switching modes is instant except the dock, which fades in or out over 0.25 s on the
      signature easing (opacity only, scoped to the dock; the list's layout is never animated).
      Reduce Motion: no fade.
    - **Save changes** opens a review sheet, "Check your changes" (medium detent, large at the
      accessibility text sizes; the page's dark sheet): a row per change with the field's label, the old value in `text-dim` with a
      strikethrough above the new value in white ("Not set" for an empty side); a new cover shows
      the old and new thumbnails; each renamed track is its own row; a new order is one row,
      "Track order changed". Below: **Save** (cover glow button) and **Keep editing** (text).
      Save runs the save (with the sleeve's tuck and spin) and returns to view mode; Keep editing
      closes the sheet and keeps the edits.
  - *Accessibility pass* (16 Oct 2026, #226, from `performAccessibilityAudit` and a walk through
    every element on the simulator). Body text on these screens holds 4.5:1, and large text
    (18 pt, or 14 pt bold) holds 3:1, over any cover colour.
    - Kind switch: no change. It is the shared `SlimSwitch` (also the Stats page's); the
      chosen option already carries the selected trait, so VoiceOver says "Selected".
    - The reorder hint moves from `text-dim` to `text-muted` (4.0:1 to 8.5:1 on the panel). The
      library row's subtitle was already `text-muted` (8.4:1), and the Sent card's hint lines
      measure 9:1 once its entrance has settled, so they stay.
    - A track row the person can't edit (the release page in view mode) reads as one element:
      "1, Headlights, 3 minutes 24 seconds, 12 plays". In edit mode its title field and replace
      button stay separate stops.
    - A recent cover tile reads "Use the cover of <title>".
    - The cover picker that only hosts the crop sheet, on the release page and on import, draws
      nothing VoiceOver can reach.
  - *Release dock*: its base is opaque black, so the panel behind it never shows through while
    the keyboard lifts it over the tracks.
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
- **Text field**: `elevated`, radius 8 (the Mac's fields move from 6 in #417), label above in field-label style, placeholder at
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
  details opens a glass dialog with Artist, Release date and Genre; blank fields stay unchanged and
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
    files here" fade in and rise 6 px. "Add a track" is the main button (`.btn-save`, a solid
    white capsule; the glow pill was retired by #409). Audio dropped anywhere on the pane is added.
  - *The record* (once a track is added; it stays if every track is removed): the release page's
    layout. The sleeve says "Add cover art" (click, or drop an image: the existing crop dialog),
    the disc peeks out, a meta line holds the Single | Album toggle and the track count, then the
    title (placeholder "Same as track title" for a single, "Album title"), artist, Year and Genre
    as inline fields that show a faint underline while empty, then the tracks (rename, remove,
    reorder as before; "Reading tags…" while the files are read). The dock (*replaced 17 Oct 2026 by the release bar, same buttons: see **Pages at full width** at the end*) is the release
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
  with 12 padding, 56 square art radius 4 (or an `elevated` tile with a muted note icon), title
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
    field, the artist as a 20 semibold one, then "Release date" and "Genre" as small labels each
    beside an inline value. Inline fields look like text until hovered (white 7 % fill) or focused
    (white 10 % fill plus the 2 px `accent` ring). Enter in the title commits it.
  - *Release date on the Mac* (#221, `ReleaseDateField`, the iPhone's field and calendar idea): on
    the release page, the import record and bulk edit, "Release date" is one inline text field
    ("Add release date") with a small calendar button after it ("Choose a date"). The button opens
    a glass popover like the Featuring one: a Year / Month / Day `.btn-seg` toggle over the
    matching native input (a four-digit year, a month picker, a date picker), Done and Clear date;
    it opens on the typed date, else today. Typing reads the same forms as the iPhone
    (`parseReleaseDateText` in `src/shared/releaseDate.ts`), leaving the field rewrites a readable
    date as "17 May 2024" in the browser's language, and the two messages ("That date doesn't
    exist", "Enter a year, or a date like 17 May 2024") show in `danger` under the field while it
    is not focused and block Save, Add to library and Apply. View mode reads "Release date 17 May
    2024". Lists, sorting and Stats keep the year.
  - *Dock* (*replaced 17 Oct 2026 by the release bar, see **Pages at full width** at the end*): Save to library (primary), "Unsaved changes" in `text-muted` while there are any,
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
  - *Inline fields* (`InlineField`; on the iPhone record and release page replaced 16 Oct 2026 by
    labelled fields, see "iPhone record fields, covers and library"): they read as text. A focused field shows a 1 device-pixel
    underline at 60 % opacity, with a 4 pt gap (`inlineFieldUnderlineOpacity`,
    `inlineFieldUnderlineGap`); the focus fade is 0.15 (`inlineFieldFocusFade`). Year and Genre sit
    10 pt below the title and artist (`fieldsMetaGap`). Theme.swift has no hover fill, so the
    web's 7 % and 10 % fills are not written here.
  - *Library cover view*: a grid of covers kept in Singles and Albums, in three sizes with minimum
    tile widths of 60, 96 and 150 pt and gaps of 8, 12 and 16 pt (`Theme.Library.tileMinWidth`,
    `tileGap`); with the list page padding that gives 5, 3 and 2 columns on a 390 or 402 pt phone
    (#360: Large is the old Medium, Medium the old Small, and the new Small shows the title only; the old
    1-across size is gone, and the choice moved to the key `locally.library.coverSize2`, migrated once
    from the old key; a fresh install starts on Large). The size control is `CoverSizeSlider` at the
    right end of the layout row, covers view only: a thin 4 pt `elevated-hover` track with three 40 % white detent dots (6 pt),
    a plain white 20 pt knob (it grows with the text up to 28 pt; #411, owner C07: slimmer) on the switch's spring, a dense-grid glyph at the left and a bigger one at the right, a 44 pt hit height,
    a selection haptic per detent, adjustable for VoiceOver ("Cover size, Medium"). No tint, rim or shadow. Tiles
    have radius 4, like every cover (#418). A pressed tile grows to 1.03 with a shadow (radius 10, 35 %, y 4) over 0.15 s.
    List rows sit in a radius 12 panel, and the divider between Singles and Albums is white at 7 %.
    The layout toggle is a slim switch track with a neutral thumb sliding on the switch's spring, and the sort button is a plain icon (#411). The Library has no "Add a song" footer (the Import tab does that). Collections is a glass card
    (`CollectionsLibraryCard`, at least 80 pt tall) under the header, washed from the first collection's cover colours (55 % at the leading edge, clear at 70 %), with the first three collections'
    covers as a stack of sleeves (the front one with a vinyl peeking out, the two behind tilted -7 and +5 degrees); it presses to 0.98 and holds its height while loading; one tap opens the Collections screen, which holds "New collection".
  - *Collection builder (iPhone, #366)*: "New collection" and "Add music" open one full-screen page (`CollectionBuilderView`). One cover wash fades down to near-black with no edge; the record sleeve carries the typed name over a mosaic of the first four picked covers; the picks lean in a boxless crate beside "3 songs · 7 min".
    Releases are a shelf of 132 pt covers (112 pt at accessibility sizes; a pick gets a cover-tinted check dot and `GlowRim(corner:)`; shelf and song covers are radius 4 and the pick ring uses the same radius, #418); Songs is a borderless list with a trailing round + that fills with the cover's accent. A frosted search pill and a round cover-tinted Done float at the bottom and stack at accessibility sizes.
    Shelf text is held to accessibility1 so a word is never split ("Har-"). Previews in `docs/design-previews/366/`; sizes in `Theme.Builder`.
  - *Library sky*: an `ArtworkBackdrop` fixed behind the library, coloured by the cover last
    pressed or else the first cover on screen. A pressed cover stops colouring it after 120 pt of
    scroll (`pressedSkyReleaseDistance`). As the library scrolls, the two glows turn 28 and 22
    degrees per screen scrolled (`scrollTurnPrimary`, `scrollTurnSecondary`), against each other.
  - *Reduced motion*: the cover change becomes a plain opacity change over 0.2 s
    (`reducedMotionFadeDuration`), with no scale. The library sky and the other backdrops are held still (STATUS, #128), unless the user turns on Settings › Motion › Keep backgrounds moving (#231), which lets the backdrops alone drift as with Reduce Motion off.
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
      45 %, 250 ms); a compact card (`card`, radius 16, padding 24, 16 from the screen edges,
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
  section and the action row, `card` with 1 px `border`, radius 9 and padding 20 on the Mac (the iPhone
  has no card of its own: the disclosure is a row of the Tracks panel, or a clear row on a collection's
  page, so it has no radius), title "Make it a
  playlist" with a chevron that rotates open. Body: the album title beside a small secondary /
  outline "Copy" button (copy icon, reads "Copied" for two seconds after a click), the
  per-platform steps in `text-muted` 14, and the fallback line "If Add to playlist is missing,
  update Spotify and open it again." in `text-dim` 12. Open by default on the release page an
  album import lands on; collapsed when opened from the library. iOS renders the same body in
  the existing `DisclosureGroup` and on the done screen after an album send.
- **Crop dialog**: on the Mac the glass card of the toasts, dialogs and popovers entry, radius 16, fading in over 160 ms; on the iPhone a `card` with `dialog-border`, radius 16 (`Theme.Radius.dialog`); padding 20 to 24, title "Crop cover"
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
  that used to sit at the foot, and Settings moved down from under Import.* Hovering the top of the rail
  (the menu button through Stats, not Settings, the profile or the empty rail between) blooms a glass panel out of its right edge: the panel controls (**Pin down**, which shows
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
  stats". Top to bottom: the heading and the period control (the slim switch `.btn-seg.st-seg`, #410: Today, This week, This
  month, This year, All time; scrolls sideways when the room is short); the digest sentence ("You
  played your tracks 121 times this week, mostly Night Bus to Nowhere.") with a ‹ › stepper that
  goes back (Yesterday, Last week, 2 weeks ago, Last month, ...) and sits on an `elevated` capsule once stepped
  back (`.period-face`); a quiet line saying what is counted ("Counted on this Mac since 15 Oct.", or "Play counting
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
    scrolled to that track's row (centred) with a one-time glow in the release's own cover colour on the
    row (iPhone, #362: its brightest palette colour lifted to at least 0.85 brightness, a 12 pt-radius wash
    from 30 % at the leading edge to 6 %, a 1 pt rim brighter on top, a soft outer glow, a 3 x 22 pt needle
    cue at the leading edge that grows in, and the number turning white semibold; accent when there is no
    cover; only opacity and the cue's scale animate). The Mac (#413) now shows the same wash, rim, glow and needle cue
    behind the row in the cover's colour (`--btn-tint`), with the shared timing: 0.35 s wait, 0.3 s in, 1.2 s hold,
    1.2 s out, and the same look held still for those 3.1 s under Reduce Motion; list rows and tiles do the same without the beat. An album
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
- **From your devices tray (desktop, #115, #185, #172)** (*sections, Hide and closing on an outside click since 17 Oct 2026: see **Pages at full width** at the end*): a clear faked-glass cloud button at the
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
- **Where Locally keeps your music (desktop, #335)**: the library folder is named for the brand (one constant,
  `BRAND_FOLDER_NAME`), proposed inside the first Spotify folder when there is one, else under `~/Music`. A
  library that already exists is never renamed or moved on its own. *Settings › Library folder* shows a
  `btn-save` "Move into a Locally folder" only when the folder's name differs; it opens an inset panel with the
  destination prefilled and "This moves 21 songs in 3 releases to the folder above. Nothing is changed until you
  confirm." (Move library / Cancel). After a move: "In Spotify, remove the old folder from Local Files sources."
  with the old path and a Copy path button. Hidden in the demo.
- **Where Locally writes (iPhone, #335)**: everything the iPhone writes into Spotify's folder goes into one subfolder named by `Brand.folderName` ("Locally"); Settings' Spotify folder group says so, and a one-time move on launch brings older files in with a one-time line "Locally moved N songs into its own Locally folder in Spotify."
- **Your Spotify folders (desktop, #245 step D, #249; designed 16 Oct 2026)**: Locally adds the
  releases Spotify already plays from the owner's own folders, details only, and never touches the
  files (plan `docs/plans/245-adopt-local-files.md`). The user-facing verb is **add**, never
  "adopt": the folders card, the review page and the toast all say "add to your library". Three
  surfaces, all in the existing look (cards and #155 buttons in Settings, the library colour space
  behind the review page, the #112 release page). References: Cosmos's "We found 2 boards" and
  Savee's import review (a found-count title, every item ticked, one button that names the count),
  Sana's folder list (one row per folder, Remove at its end).
  - *Settings › Your Spotify folders*: a `card` right after Library folder, titled "Your Spotify
    folders" (14 bold, like its neighbours), then one 12 `text-dim` line: "Locally reads the music
    Spotify plays from these folders. It never changes, moves or deletes a file there." Each folder
    is a row: its name (14 semibold) over its full path (12 `text-dim`, cut in the middle when
    long), and **Remove** (`.btn-ink`) at the end. Remove only stops Locally checking that folder;
    releases already added from it stay, and the toast says so: "Stopped checking Masters.
    Releases added from it stay in your library." With no folders the list is one 13
    `text-muted` line: "Add the folder Spotify plays your local files from (Spotify › Settings ›
    Your Library)." When `~/Documents/Spotify Music` exists and is not added,
    a suggestion row sits first: the path in `text-muted` and **Add** (`.btn-save`). Under the
    rows: **Add folder…** (`.btn-save`; the native folder picker in the desktop app, an inline
    path field with Add and Cancel in the browser dev server) and **Check for new files**
    (`.btn-save`, hidden with no folders), then a 12 `text-dim` line, "Last checked today at
    14:02", once there has been a check. Check for new files opens the review page.
  - *Review page* (a main-pane view like Stats, over the library colour space, column as wide as
    the library's): the page header has the eyebrow "Your Spotify folders" (`accent`, sentence
    case) and the title as the finding, "Found 214 releases" (one release: "Found 1 release"),
    then a `text-muted` line, "1,567 tracks in 3 folders. Locally adds their details and leaves the
    files where they are." and, when files were passed over, a quiet disclosure "3 files skipped"
    that opens to one line per type ("2 .flac files", "1 .wav file") and "Locally can't add
    these yet."
    - Rows are grouped by the first folder under each Spotify folder (the owner's Masters,
      Unmastered and OG Files stay apart), each group a section header like the library's
      ("Masters", 14 bold, with "38 releases" in `text-muted` on the right) carrying a group
      tick that ticks or unticks the whole group. Files straight in the Spotify folder group
      under its own name.
    - Each row is the library list row's grid without its columns: the 20 tick (`accent` with a
      black check when ticked, a 1.5 px white 30 % ring when not, the library selection's
      checkbox), the 48 cover (radius 4; no art: *since 17 Oct 2026 the double-note square, see **Pages at full width** at the end*; was the house-label sleeve, a neutral square with
      the `accent` disc label), title (15 semibold) over artist (13 `text-muted`), then "Album,
      12 tracks" or "Single" and the year (13 `text-muted`, tabular), and the folder below the
      group as a 12 `text-dim` path ("Summer EP"), cut at the start when long. Every row starts
      ticked. The whole row toggles its tick (it is the checkbox: role checkbox, Space toggles,
      the focus ring on the row); an unticked row's cover drops to 40 % and its title to
      `text-muted`. Nothing on the row is editable: the details are the file's tags, shown as
      Spotify reads them.
    - A dock pinned to the bottom of the pane, the release dock's pill (black 70 %, white 10 %
      ring): "212 of 214 selected" (13 `text-muted`, tabular), **Select all** or **Select none**
      (`.btn-ink`, whichever changes something), **Cancel** (`.btn-ink`, back to Settings; the
      findings are kept for next time) and the main action, **Add 212 to your library**
      (`.btn-save`; one: "Add 1 to your library"; none ticked: disabled at 40 % with
      `aria-disabled` and the dock's count saying why). Adding sends the ticked groups in batches
      of 20 (`POST /api/adopt`), one batch after another, so the button reads "Adding 40 of
      212…" as batches return; while it runs the button is disabled, the rows can't be toggled,
      and Select all / none and Cancel hide. Leaving the page lets the batch in flight finish on
      the server but sends no more, and a response that lands after the page has gone changes
      nothing on screen (no navigation, no focus move). Retrying is safe: a group already in the
      library comes back in `alreadyAdopted` and counts as added, so a batch whose request failed
      (no answer, or a network error) is simply part of **Try again**. All added: the library
      opens with the toast "Added 212 releases to your library". Some not added (the result's
      `failed`, or a batch with no answer): the page stays, the added rows leave the list, each
      failed row stays ticked with its message in 12 `danger` under its title ("Couldn't reach
      Locally." for a batch with no answer), the header line reads "Added 210 of 212. 2 couldn't
      be added.", and the button becomes **Try again** for what is still ticked.
    - *Opening the page* always loads the stored findings fresh (`GET /api/adopt/proposal`) and
      hides any group already in the library (a release whose `adoptKey` matches), so coming
      back after leaving mid-add shows only what is left, and Add counts only that.
    - *Reading*: from Check for new files until the findings arrive the title is "Reading your
      Spotify folders", the line under it counts files when the route reports progress ("412 of
      1,567 files") and otherwise says "This can take a minute.", a 2 px `accent` line grows
      across the column under the header (transform only, no track behind it), and six skeleton
      rows hold the list's shape (tick ring, cover square and two text bars at white 6 %, still).
      Reduced motion: the line jumps to each new width.
    - *Reading failed* (the scan request itself fails or times out): title "Couldn't check your
      Spotify folders", the error's message (or "Locally didn't answer.") in 13 `text-muted`,
      then **Try again** (`.btn-save`) and **Back to Settings** (`.btn-ink`). Earlier findings,
      if any, are not shown as if this check had found them; the line under the buttons offers
      "Review what Locally found on 16 Oct instead" (`.btn-ink`), which opens them with that
      date in the header line.
    - *Nothing new*: title "Nothing new in your Spotify folders", line "Everything Locally can
      add from there is already in your library.", the skipped disclosure if any, and **Back to Settings**
      (`.btn-ink`). No folders yet (a stale link): "Add a folder in Settings first." with the same
      button.
    - *A folder Locally can't read* (the proposal's `unreadable`): above the groups, one 13
      `danger` line per folder, "Couldn't read ~/Music/Old. Check it's still there and that
      Locally may open it.", and the rest of the findings still show. When nothing new was found
      and a folder couldn't be read, the title is "Couldn't read all of your Spotify folders" and
      the "Everything … is already in your library" line is not shown, since the check was
      incomplete.
    - *Accessibility*: each row is a `role="checkbox"` with `aria-checked`, `tabIndex` 0 and the
      name "Title, Artist, Album, 12 tracks" (the folder as its description); arrow keys move
      between rows, Space toggles. A group tick is a checkbox named "All of Masters" whose state is
      `mixed` when some of its rows are ticked: pressing it from mixed or unticked ticks all,
      from ticked unticks all, and its visual is the `accent` circle with a bar for mixed. One
      polite live region announces "Reading your Spotify folders", then "Found 214 releases" (or
      the nothing-new or couldn't-read title), "Adding 40 of 212", and the end result; the
      skeleton rows are `aria-hidden`. On arrival focus goes to the page title; after adding with
      failures, to the header line. The list keeps bottom padding equal to the dock's height
      plus 24, and a focused row scrolls clear of the dock.
  - *Added releases in the library*: they sit in Singles and Albums with the rest, sorted and
    searched the same way. A 14 folder glyph (the hand-drawn set, `text-dim`) follows the title
    in the list and in the grid's caption (never on the cover), labelled "In your Spotify
    folder" for VoiceOver and as a tooltip: one quiet mark instead of the same line under most
    of the library's rows (the owner's library will be mostly added releases; this replaces the
    plan's per-row line, and the plan's UI section says so). In selection mode their tick is
    hidden and the row can't be selected, since Edit details and Delete don't apply; the
    selection bar adds one 12 `text-dim` line when the library has any, "Releases from your
    Spotify folder can't be selected. Remove one from its own page.", and the row's tooltip says
    the same.
  - *Their release page* is the #112 page in a view mode: the sleeve without the pencil badge
    (it doesn't open the cover picker), title, artist, Year and Genre as plain text (no hover
    fill, no focus ring, "Not set" in `text-dim` when empty), and under the meta line a 13
    `text-muted` line, "In your Spotify folder · Masters/Summer EP" (the folder after the
    Spotify folder). Track rows show number, title, length and plays, with no grip or replace;
    a track whose file has gone is `text-muted` with "File missing" (12 `text-dim`) where its
    length was. The dock (*moved into the release bar on 17 Oct 2026, same buttons and confirm: see **Pages at full width** at the end*) holds **Show in Finder** (`.btn-save`) and **Remove from Locally**
    (`.btn-ink`), with no Save and no "Unsaved changes". Remove confirms inline in the dock, in
    the release page's confirm style but without the red: "Remove from Locally? The files stay in
    your Spotify folder, and Check for new files can add it back." with **Remove** (`.btn-save`)
    and **Cancel**. The "Spotify can't see this yet" prompt never shows (Spotify already plays
    these); "Make it a playlist" stays on albums.
  - Motion: none of its own. A tick's check scales from 0.6 to 1 with opacity over 160 ms on the
    house easing; Reduced motion makes it instant. The library and release page keep theirs.
- **From your devices on the iPhone** (*sections since 17 Oct 2026: see **Pages at full width** at the end*) **(#269, owner 16 Oct: "This notification should be in library… and should match the Mac's design")**: the Mac's tray (the entry above) carried to the phone's Library tab, replacing the toast, chip and list that sat on Import. Import goes back to only making a record.
  - *Button*: in the Library header, at the top right on the eyebrow's line (the track count stays where it is, on the title's baseline), the Mac's clear faked-glass cloud button, 40 pt visible inside a 44 pt hit area, with the `accent` count badge inside its top-trailing corner so it never crosses the 16 pt gutter, shown only while something is pending; while it shows, the gap between the eyebrow and the title grows from 4 to 26 pt so the track count sits clear below the button (owner 16 Oct: "Notification cloud seems choked"). Open, it becomes a bare red X and the badge hides. VoiceOver: "From your devices, 3 waiting" / "Close".
  - *Tray* (owner 16 Oct: "Notification shouldn't take up the full screen width"): a slim panel like the Mac's, 300 pt wide (the screen less the 16 pt gutters when that is narrower), its top-right corner under the cloud button, opening out of that corner (scale from 0.92 at the top-trailing anchor with opacity, 240 ms on the house easing; Reduce Motion a 160 ms fade), radius 16, the phone's faked glass (no live blur), at most 60 % of the screen tall and scrolling inside. It opens and closes from the button, and also closes when the library behind it is tapped (a phone has no Escape). Heading "From your devices".
  - *Rows*, as on the Mac (titles and artists cut short to one line each so the tray stays slim; Dynamic Type at accessibility sizes may wrap to two): a 48 pt record sleeve (the cover, radius 10, the disc peeking out) that is itself the Send to Spotify button (pressed: the cover turns `accent` with a black plus and the disc rolls out), then the title (15 semibold), artist and track count (13 secondary) and the origin label (12 tertiary: "from your Mac", "from the web", "from another device"). A sent row collapses out. The phone has no signal that a pending record's audio is missing from the service (the missing-files check covers this phone's own releases), so it has no "still sending" or "waiting" looks; a failed accept can equally be the network, folder access or a local import error. Two states instead: *sending* (a send is running; it wins over an earlier failure) is the `accent` sleeve with a small spinner in place of the plus, and not a button; *failed* (the last send failed; the sleeve stays the Send button) adds "Couldn't send this yet." (12 `danger`) under the origin label and a secondary **Try again** pill that retries that send. VoiceOver: each sleeve is "Send <title> to Spotify"; a failed row's hint is the sync error text.
  - *Arrival*: no toast. When the pending count goes up, the badge scales in from 0.6 with opacity over 240 ms on the house easing (`.timingCurve(0.16, 1, 0.3, 1, duration:)`). Reduce Motion: the badge just appears, the tray fades in 160 ms, the disc doesn't roll.
- **Pages at full width, the release bar, track columns, the tray's sections and no-cover releases (both apps; owner 17 Oct 2026, from screenshots and the mockups at https://claude.ai/artifact/ADeVZeEP1ZEpHjeVfNTtH4)**: the owner's picks, in one entry because they land together. References on Mobbin: Apple Music's album page (cover beside the details, a full-width track table), SoundCloud's vinyl maker (a bottom bar with the main action on the right), Meetup's grouped notifications (a header per group).
  - *Every Mac page at the library's width* (owner: "we're still not adopting the full page view across all pages"): the release page, Import, Stats, Settings and the Spotify folder review follow the library width setting (#207). Full width (the default) has no max width, with about 24 px each side at `md` and 32 from `lg`; Comfortable keeps a centred 920 column. This replaces the 920 (release page), 896 (forms) and 1180 (Stats) caps. Lines of reading text keep their own measure (a summary sentence stays within about 760, a setting's help line within about 640), and Settings lays its cards out in two columns from `lg`, each card at its natural height, one column below. On the release page the details sit beside the sleeve once the pane is wider than about 900 (sleeve on the left, meta, title, artist, Year and Genre bottom-aligned to it) and under it below that, as now.
  - *The release bar* (Mac; owner picked option C over actions under the details, a top-bar menu and the title line): the floating dock goes. In its place one bar pinned to the bottom of the pane: inset by the page gutters, 24 above the pane's bottom, at least 68 tall (it wraps to a second line when the pane is narrow or an inline confirm is long, the main action keeping the right end of the last line, and grows to fit), radius 24, the release dock's base (black at 82 % with the faked glass edge and its 10 % white ring; no live blur). The destructive or secondary action sits at its left, the main action at its right, with one quiet status line in `text-muted` just left of the main action when there is one. Inside the bar the main action is the plain solid `.btn-save` capsule, which has its shape at rest (the lit state and the cover's `--btn-tint` on the bar went with #409); secondary actions stay `.btn-ink`. Content keeps bottom padding of the bar's actual height plus 48, and a focused row scrolls clear of it. Tab order follows the bar left to right. An inline confirm moves focus to its safe choice (Keep or Cancel); Escape cancels it and returns focus to the button that opened it.
    - Locally's own release: left **Delete** (`.btn-ink-danger`, confirm as now); right "Unsaved changes" while there are any, **Show in Finder** (`.btn-ink`), then **Save to library**.
    - Import (a new record): left **Add a track** (`.btn-ink`); right **Add to library** (disabled until a file and an artist are in, "Adding…" while importing).
    - From your Spotify folder: left **Remove from Locally** (`.btn-ink`, not red, since the files stay: #249's inline confirm, now in the bar); right **Show in Finder**. No status line.
    - It never animates in on load; under reduced motion nothing in it moves.
  - *Track columns* (Mac release page, owner: "title then plays then in playlist then time"): the tracks are a table like the library's: one quiet header row (12, `text-dim`: #, Title, Plays, In playlists, Time), then rows on one grid: the number (`text-dim`, tabular), the title (15 semibold) with the track's artist under it (13 `text-muted`; the release's artist when the track has none, "Unknown artist" when both are empty), plays (14, tabular, right-aligned; nothing when none), the playlists the track is in (13 `text-muted`, one line, "Late night, Ounce and 1 more", cut short when long) and the time (14 `text-muted`, tabular, right-aligned). In playlists drops under 760 and Plays under 560. The import's editing rows keep their grip, rename and remove, and gain the same header and columns. The plays footnote stays under the table.
  - *iPhone release page, view mode* (owner: "the phone looks so weird… can we adopt the Mac's design for how tracks look"): the details become the Mac's: a meta line ("Album · 5 tracks", 13 secondary), the title (30 bold), the artist (18 semibold, white at 85 %) and one line "Year 2025   Genre Rap" (labels secondary, values white); no label column, and an empty value is left out. The tracks lose their card: a "Tracks" heading (17 bold), one quiet header row (#, Title, Plays, Time; 12 tertiary), then rows with the number, the title (16 semibold) with plays and time (tabular, right-aligned) on its line, and the artist (13 secondary) under them across the row's full width, a hairline between rows. The artist line stays on one line below the accessibility sizes and shortens to fit (#361): "A, feat. B & C", then "A, feat. B & 1 more", then "A & 2 more", then a tail ellipsis; names that show keep their links, "& N more" is not one, and VoiceOver reads every name. Stats list rows and artist page rows do the same. The Stats grid is one size on the phone (the Mac's first tier, 3 across on a 390 pt screen): the cover as a sleeve (a 1 pt top-edge highlight, a soft drop shadow, and for ranks 1 to 3 a medal-metal disc peeking about 8 % out of its right side), a glass rank chip (dark base, glass fill, rim), the name, and "1,204 plays" under it (the number semibold, the word "plays" regular at 72 % opacity; medal-coloured for ranks 1 to 3, white for the rest). A Stats list row with no last-played day drops that line instead of showing a dash. Playlists aren't a column on the phone. At the accessibility text sizes the details wrap (Year and Genre each take their own line) and each track's plays and time move under its title as one line ("35 plays, 2:22"), so the title keeps the width. Edit mode is unchanged apart from the sleeve below.
  - *No cover* (owner: "there's no cover, man. It should just be the music symbol… respective of which device it's on"): wherever a release has no art (library rows and grid, release pages, the tray, Stats, the Spotify folder review) the cover is the `card` square with the Mac's double note (`MusicNoteIcon`) centred in `text-dim`, at about a third of the square on large sleeves; the iPhone draws the same glyph (a matching SF Symbol if one exists, else the Mac's path as a shape), not a single note. A record's label with no art is black (#050505 with a 1 px #1E1E1E ring), never `accent`, on the release pages, the tray, Stats and the library; the one exception is the Import invitation's bare record (#330, owner 23 Oct), whose label is the `accent` blue (#1E7DF0) with a soft radial sheen (white 28 % at 35 % 30 %, fading out) and a faint dark edge, on both the Mac (`.record-label-invite`) and the iPhone (`RecordDisc(inviteLabel: true)`). The house-label sleeve from #249 (`HouseSleeve`) is retired. Where the release can be edited the empty sleeve offers it: on the Mac, Locally's own releases and Import show the note over **Add cover** (14 semibold) and "Drop an image or click to choose" (12 `text-dim`), a dashed `border-dashed` edge turning `accent` on hover or drag; on the iPhone the same sleeve shows **Add cover** and "Choose a photo or a file" in the release page's edit mode and always on Import, which has no view mode. Releases from the Spotify folder show the note and nothing else.
  - *From your devices, in sections* (both trays; owner: "at the top is all the ones you can add, at the bottom is all the ones that you can't add, the same way we have singles and albums"):
    - **Ready to add**, then the other section, each under a header line: the name (13 semibold) with its count (`text-dim`), and at the right of that line the section's one action. Both actions are the same control, `.btn-save` on the Mac and a secondary pill on the iPhone, the same size: **Add all** (shown from two ready rows) and **Try all again**. A hairline separates the sections; an empty section isn't shown. The groups never overlap. On the Mac a row is *ready* only when its audio is on the server (no files state, or `ready`); *Still sending* (`arriving`) and *Waiting* rows belong only to the second section. On the iPhone *ready* is pending and neither sending nor failed, and the second section is the failed rows. A row being sent stays in its section with its sending look. **Add all** takes the ready rows as they are when pressed, **Try all again** the failed or waiting rows as they are when pressed; each shows "Adding…" or "Trying…" and is disabled until its own run ends. Every row in a run is reserved the moment the button is pressed: it shows its sending look and its own controls (the sleeve's Send, the row retry, Hide) are disabled until its turn ends, and a send never starts for a release that is already being sent, whichever control asked, so nothing is sent twice. (The iPhone's existing accept-all takes every pending record, so it needs a ready-only version.)
    - Mac, the second section is **Waiting on your iPhone** when every row came from the iPhone, **Waiting on that device** for one other origin and **Waiting on your devices** for a mix, and holds both *Still sending* and *Waiting* rows. One line under its header replaces the per-row lines: "Their audio hasn't arrived yet. Open Locally on your iPhone to finish sending them." ("…on that device…", or "Open Locally on those devices…" for a mix). **Try all again** (shown while any row is *Waiting*) is the existing resync request, which asks every device on the account; after it: "Asked your iPhone to send them again." ("…your devices…" for a mix) and, when the service asks to wait, "Try again in a few minutes." under the header. Rows in this section are compact (40 sleeve, still at 60 %; title 14 semibold `text-muted`; "kwaylone, 1 track, since 27 Sep" 12 `text-dim`). There is no per-row retry on the Mac: the request asks the devices to resend everything they're missing at once, so one button is the honest control.
    - The Spotify folder review keeps its own dock (its selection count, Select all, Cancel and Add N), unchanged.
    - Mac, **Hide**: hovering or focusing a waiting row shows a small icon button at its end, "Hide <title>". It hides that release from this tray on this Mac only (its id and server version are kept locally); nothing is deleted anywhere, and it comes back if a newer version arrives. A toast: "Hidden. It comes back if your iPhone sends it again." with Undo.
    - iPhone, the second section is **Couldn't send yet**: rows whose last send failed, with one line under the header, "Locally couldn't send these yet." (a failure can be the network, folder access or the import), and **Try all again** retrying every failed send. Each row keeps its own retry as a small icon button at its end ("Try <title> again"), since a send there is one download; the per-row "Couldn't send this yet." line and its Try again pill go.
    - Closing (owner: "when you have notifications open and you click… outside of it, it should close"): on the Mac a click or tap anywhere outside the tray (other than the cloud button, which toggles it) closes it; focus returns to the cloud button after Escape or a click on empty space, and stays with the control that was clicked otherwise; the iPhone already closes when the library behind is tapped.
    - Accessibility: each section name is a heading (level 3 under the tray's "From your devices"), and its count is part of the heading's name ("Ready to add, 2"). The lines after Try all again (and the Mac's "Try again in a few minutes.") are announced in one polite live region per tray. Hide and the iPhone's row retry are real buttons, reachable by Tab or the VoiceOver rotor, not only on hover. When a row leaves (sent or hidden) while the tray is open and focus was on that row's own control, focus moves to the next row's control, else the previous row's, else the section's header action, else the tray heading; focus anywhere else is left where it is. Escape closes the Mac tray and returns focus to the cloud button; an outside click that lands on another control closes the tray and lets that control take focus and act.
    - Motion as before: rows collapse out when sent; sections don't animate; reduced motion as before.

## Sharing (#146, Mac, #182)

Plan: `docs/plans/146-sharing.md`. Owner's picks, 23 Oct: a glass popover for Share, and one tray with a second section.

- **Share popover.** A **Share** word (secondary button) in the release bar, before Show in Finder, and a small share icon at the end of every track row (quiet until hover or focus, like the grip; right-click opens it on a row with no disc menu). The popover is `role="dialog"` labelled "Share <name>", 360 wide, the existing popovers' glass (`glass-fake glass-frost`) and their 160 ms scale-in (`playlist-pop`, none under reduced motion). It opens upward from the bar, and from a row with more room above than below. Contents: People (an email field whose entries become pills with a ✕: Enter, comma or space adds, Backspace on empty removes the last; saved groups as chips that add their members; "Save these people as a group", kept in the Mac's settings only), **Link** (an On/Off switch, only when `GET /v1/me` says `publicSharesEnabled`; "Anyone with the link can download this" when on), **Let them share it on** (On/Off; "They can't share it on from Locally" when off), **Expires** (Never / 7 days / 30 days, the word toggle with a dot) and the main-action **Share**. After a reply it shows "Shared with 3 people" ("1 person"), each email the service did not know with "Not on Locally yet", and a returned link with Copy and "Copy it now. Locally can't show this link again." Escape closes it and returns focus to Share; Tab out of it closes it without moving focus. Signed out, Share reads "Sign in to share" and opens Settings at the account section; an added-in-place (adopted) release has no Share.
- **From your friends.** The cloud tray's third section, under the device sections and shown only when it has rows. Same row language: the cover as a record sleeve that is itself **Send to Spotify** (the cover turns accent with a plus on hover), title, artist and track count, and the sender as the quiet line "from sam@example.com". A ✕ at the row's end (hover or focus) **dismisses** it. The badge counts both groups. A sent row collapses out as before; a failed send brings it back.
- **Shared by you.** A Settings card under the sync card: cover, title, "Shared with 3 people", each email with "Added" or "Not yet", "Link on", "Expires 30 Oct" or "Never expires", and a pink **Revoke** that asks inline ("They'll lose access." Confirm revoke / Cancel). Revoked and expired shares stay, greyed, without Revoke.
- **Delete confirm.** Deleting a release that has live shares adds "It's shared with 3 people. They'll lose access. Copies already added stay." to the bar's confirm; Revoke's confirm says the same two sentences.
- **Imported releases (#328).** A release imported from a friend's share goes on only as a reshare of that share, whole: Share sends `POST /v1/shares/:id/reshare` (no track-row Share). When the sender did not allow it, the Share button is replaced by quiet text, "They didn't allow sharing this on".
- **Tray headings.** "From your devices" is the first section heading above both device groups, whose names ("Ready to add", the waiting group) are quieter status subheadings; "From your friends" is a section heading of its own. The sender line and every count use the muted text token (4.5:1 on the glass).
- **Popover size.** The popover never grows past the room on its side of the anchor: the heading and the Share or Done button stay, the body scrolls. After a successful share focus moves to its result heading.
- No new colours, effects or animations: the tray's row collapse and the popovers' scale-in only.

## Sharing (#146) on the iPhone

Plan: `docs/plans/146-sharing.md`; built in #183. Copy is in `Copy.Share`, sentence case, nothing promises more than Locally's own sharing.

- **Share** is a text button beside Edit on the release page in view mode, and "Share this song" in a track row's context menu (and a VoiceOver action). Adopted releases have neither.
- **The sheet** (medium and large detents) sits on the studio backdrop in glass groups: **People** (wrapping email pills with a 44 pt ✕, a field that adds on return or a comma, saved group chips, "Save these people as a group"; groups live on the device only), then **Options** (Link, only while `GET /v1/me` says `publicSharesEnabled`; "Let them share it on", with "They can't share it on from Locally" when off; Expires as a `SlimSwitch` of Never / 7 days / 30 days), then a full-width **Share** pill. The result replaces the form: "Shared with 3 people", each unknown address with "Not on Locally yet", a returned link with Copy link and a `ShareLink`, and "Copy it now. Locally can't show this link again."
- **From your friends** is a second section of the Library header's tray, under "From your devices", in the same row language: the sleeve is **Send to Spotify**, the origin line is "from <sender email>", a small ✕ dismisses. One badge counts both sections; an empty section hides with its heading.
- **Shared by you** is a Settings glass group: cover, title, "Shared with N people", each recipient "Added" or "Not yet", "Link on", the expiry, and a destructive **Revoke** with a confirm. Revoked and expired shares are greyed without Revoke. The group hides when there are none.
- **Delete** confirm adds "It's shared with N people. They'll lose access." when live shares exist.
- Everything uses `themeFont` / `Theme.ScaledFont`, wraps at the accessibility sizes, keeps 44 pt targets and labels every control for VoiceOver. No new motion; the tray keeps its Reduce Motion fade.

## Play in Locally on the iPhone (#336, plan `docs/plans/324-play-in-locally.md`)

- **Row play button** (release page, view mode only; edit mode keeps its rows): the track number is a 44 pt button, reaching into the row's inset and the gap before the title so the number column keeps its width. VoiceOver says "Play <title>" and, on the playing row, "Pause <title>". A release with no files on this phone (an adopted one) shows the plain number.
- **Now-playing glyph**: the playing row swaps its number for the shared now-playing glyph (three bars, `Icon/NowPlaying`) in `accent`; a paused current row shows the drawn play glyph in `accent` (#414). Nothing animates, so nothing changes under Reduce Motion. A track whose file is gone shows "File missing" (13 `text-dim`) under the artist and is skipped.
- **Mini player**: on every tab, above the tab bar, only while a queue exists. A bar inset 12 from the sides and 8 above the tab bar, radius 16, the phone's faked glass (a `card` base under the white 6 % fill, a 10 % rim, no live blur). The cover (44, radius 4), the title (15 semibold) over the artist (14 `text-muted`), then play/pause and next, the drawn glyphs (22 pt, white, 44 pt targets, nothing behind them, #414), with a 2 pt progress line (`accent` on white 12 %) along its bottom edge. Tapping the cover or names opens that release's page in the Library. The bar is a bottom safe-area inset, so the content grows by its height. At the accessibility sizes the names take their own row (title up to 3 lines) above the buttons. It slides up and fades in over 240 ms on the house easing; Reduce Motion is a 160 ms fade.
- **Lock screen**: title, artist, album, the cover, length and elapsed time; play, pause, toggle, next, previous and scrubbing. Playback continues in the background (`UIBackgroundModes: audio`).
- **On iOS 26.1 and later the bar is the system's own** (`tabViewBottomAccessory`, the slot Apple Music uses), the one exception to the faked glass: the system draws the capsule and its live glass, and the bar draws none of its own chrome. The glass lets the page's text through, so a dark backing (black at 70 %, a little wider than the capsule so no edge shows) sits under the title and artist; a row scrolling beneath can't be read through them. The 2 pt progress line is inset 20 from the capsule's ends. The accessory is fixed height, so at the accessibility sizes the inset bar above is used instead. Earlier iOS uses the inset bar at every size.
- **Paused row**: the paused current row shows a `play.fill` in `accent` where the number is. Only the number is the play target, not the whole row, because the artist names in the row are links (#288).
- **When playback can't start** (the audio session refuses), the queue and the bar go and a one-line notice, "Couldn't start playback. Try again.", sits where the bar would be for 4 seconds, in the same faked glass.

## Playing in Locally (Mac, #324 step 3, #338)

- **Row play button.** On the release page the track number turns into a play button on hover and when the button has keyboard focus (Tab reaches it; Enter or Space presses it). It is 32 px square over the number, white, with the app's accent focus ring. Its accessible name is "Play {title}" or "Pause {title}". A row whose file is missing has none. On a row that also has a disc menu, the play button lies over the number (the menu's keyboard handle, still reachable by Tab, ArrowDown or Enter) and the menu's pointer handle is a quiet chevron button in the row's trailing actions before Share, named "Move {title} to another disc" (right-click still opens it).
- **Now-playing glyph.** The row whose track is the player's current item shows its number as a static three-bar glyph in `accent` (a filled mark, never animated, so nothing moves under reduced motion). Hover or focus on that row swaps it for the pause mark (play mark while paused); a paused current row shows the drawn play glyph in `accent` (#413).
- **Mini player.** A glass bar (`glass-fake glass-dock` edge and highlight over a solid backing: 16 % of the cover's colour on near-black, so nothing behind it can be read; no live blur) on every page while a queue exists. Inset 32 px from the pane's rail edge and right edge, 24 above the pane's bottom, and above the release bar where there is one (the bar's height plus 12, published as `--release-bar-h` by `ReleaseBar`). 64 tall, radius 24. Left to right: the cover of the playing item's own release (48 px, the cover fallback art when it has none) with title and artist (a button that opens the queue's context: a release page for a release queue, the Collections page for a collection queue, #349); play/pause and next as plain white drawn glyphs (24 px in 44 px targets, nothing behind them, #413; next disabled on the last item); elapsed, the scrubber, length. No labels in small caps. The scrubber is a native `input type=range` (arrow keys seek one second) with `aria-label="Seek"` and `aria-valuetext` like "1:02 of 3:20": a quiet track (white at 20 %), the played part in the cover's colour, a round white thumb. Every control has a visible focus ring and a hit target of at least 32 px. Text is `text` and `text-muted` on the dark body (at least 4.5:1).
- **Room at the bottom.** The release bar and the mini player each publish their height plus a 12 px gap on the pane (`--release-bar-h`, `--mini-player-h`); `--bottom-bars-h` is their sum plus 36 px of air. A page with a release bar ends with a spacer of that height (inside `ReleaseBar`, before its anchor), any other page with the player alone (AppShell), so every page, Import included, scrolls its last content clear of both.
- **Motion.** The bar rises 12 px and fades in over 240 ms on the signature easing, transform and opacity only. Under reduced motion it just appears. The row button fades in over 160 ms (none under reduced motion).
- **Media keys.** `navigator.mediaSession` carries the playing item's title, artist, album and cover, and play, pause, next, previous and seek handlers, so the Mac's media keys and Now Playing work. Closing the window stops playback.
- **Counting.** Only while Settings › Plays › Count my plays is on (the server answers 204 and counts nothing when it is off). A play counts with the Spotify rule (30 s or 90 % of the track, once per play session) and is added to the same totals; the UI shows one total per track and release. The Stats line reads "Plays in Spotify and in Locally, counted on this Mac since 15 Oct."

## Collections (Mac, List view, #339 step 2, #349)

Previews: `docs/design-previews/339-mac-list/`. The record player look is a later step; this is the List view the plan keeps behind its Record player / List switch. Tokens only: `card`, `elevated`, `border`, `text`, `text-muted`, `accent`, `danger`; no new colours or fonts.

- **The Library row.** A "Collections" section above Singles and Albums, with the same fold button as theirs (title, count, turning chevron, remembered in localStorage as `locally.library.collectionsFolded`; a typed search opens it). Inside, a slim row (it scrolls sideways when long) of 208 x 56 buttons: the collection's sleeve (48 px, radius 8), its name (15 semibold, one line) and "6 tracks" (12 `text-muted`), then **New collection** (a `btn-ink`, 44 tall) which opens a name field in place and, once made, opens the new collection. With none: "Make your first collection: a mixtape of any tracks and releases." in `text-muted` 14, and the same button. The Library's bulk bar gains **Add to collection** (adds the selected releases as release items).
- **The sleeve.** Never stored; the first four different covers among the items, as a 2 x 2 grid with a 1 px `border` gap, one cover when there is one, the empty note on `card` when none. A square from the first paint (the size is the box), so nothing shifts as covers load.
- **The Collections page.** Eyebrow "Your music", title "Collections", **New collection** at the right. Below `lg` one column; from `lg` two: a 24 rem list on the left (search field, then rows of 48 px sleeve, name, "6 tracks · 23:39"; the chosen row is `white/9 %` and `aria-current`) and the chosen collection on the right, laid out like an album page. It sits on the release page's cover-colour wash (`AmbientBackdrop`, coloured from the collection's first cover, the same release the 2x2 sleeve shows; neutral grey with no cover) with the artist page's `st-scrim` over it so the muted text keeps 4.5:1 on pale covers. From the top: the sleeve (184 px, 228 px from `sm`) with the disc peeking out, which turns while this collection plays; the sleeve's cover is a button that plays, pauses or resumes the collection (aria-label "Play / Pause / Resume <name>"), with one soft sweep of light (760 ms, eased in and out) per press, and there is no separate Play button; the name (30 bold, wraps, never truncates, `text-wrap: balance`); the count and length line in `text-muted`; then **Edit collection** underneath. Below, the queue as one list (no sides) of rows of a 40 px cover, title, artist, the now-playing glyph (the play glyph when paused) and the length; the playing row's title is `accent`. A tap plays the queue from there (the same row pauses it). A track whose file is gone is dimmed, says "Missing" and is skipped when playing. Items this Mac can't resolve are hidden and stay in the collection.
- **States** use the plan's wording word for word: no collections (the first-collection line with **New collection**), an empty collection ("Nothing here yet. Add tracks from any release or track row." with **Add tracks**, which opens the Library; Play is disabled), nothing playable ("None of these tracks are on this Mac." and Play disabled), loading (rows and queue as quiet `card` shapes in their final sizes, no spinner), failure ("Couldn't load your collections" with **Try again**).
- **Edit collection.** The name becomes a field; the queue becomes a list of items (a release item is one row, "Release · 6 tracks"). Each row: a grip (44 px), the cover, name and kind, a "..." menu (44 px) with **Move up**, **Move down**, **Remove from collection**, and an X (44 px). Drag by the grip (an accent line shows the drop; Escape cancels), or focus a row and press Option-Up or Option-Down; a polite live region says "Moved to 3 of 12". **Delete collection...** asks with the release bar's inline confirm ("Delete "Late drives"? The tracks stay in your library.", Cancel first), never a browser dialog. Every change saves at once.
- **Add to collection.** An icon button (44 px, a plus, named "Add {title} to a collection") in each track row's actions, quiet until the row is hovered or focused, and a right-click on the row when it has no disc menu; and a text button on the release bar and the Library's selection bar. It opens a small glass menu (`role=menu`) in the overlay layer: focus moves in, the arrow keys, Home and End walk the items, Escape closes it and returns focus to the button, a press outside or Tab closes it. A search field comes first once there are more than 8 collections. Items: each collection (name, "3 items", or "Added" when everything is already in it) and **New collection...**, which swaps the list for a name field and "Create and add". The result is said in a polite live region ("Added to Late drives", "Already in Late drives").
- **Hit areas and focus.** Row buttons, menu items, the grip and the "..." are at least 44 x 44; every control has the accent focus ring; text is `text` or `text-muted` (at least 4.5:1).
- **Motion.** Only the section fold's existing chevron turn and fade; nothing else moves, so reduced motion needs no extra rule.
- **The mini player** opens the Collections page on the playing collection.

## Collections: record player (Mac, #339 step 4, #351)

Previews: `docs/design-previews/339-mac/` (1280 and 900 wide: `playing`, plus `narrow-320` and `large-text-1280` (root font size 200%), `browsing`, `paused`, `vinyl`, Reduce Motion as `*-rm`, `empty-collection`, `empty`). Chosen direction: `docs/design-previews/339/mac-record-player*.png`; plan: `docs/plans/339-collections.md` "The look". Code: `src/components/RecordPlayerView.tsx`, pure parts in `src/lib/record-player.ts`, styles and the keyframes in `globals.css` ("Collections: the record player").

- **The switches.** Under the title, **Record player / List** and **Picture disc / Black vinyl**, each the app's two-word toggle (`.btn-seg`, the slim switch of #410, here without its slide). Both are remembered per device in localStorage (`locally.collections.view`, `locally.collections.record`; every read and write is in try/catch and the page works without storage). Record player is the default; List is the unchanged fallback.
- **The wheel.** 430 x 600, a half dial whose hub (300 across, centre 18 px left of the box) holds "5 of 24", the chevrons (up, down) and a plus, all 44 px buttons; a 1 px ring and an accent notch point at the front row. Each row is a 64 px paper sleeve (a 3 px radius, a printed edge, a faint sheen; the collection's own cover), the name (20, white; 700 at the front) and "27 tracks, 1 hr 56 min" (13, `text-muted`, `text-soft` at the front). Steps are 0.87 of the last, rows stay level, follow the dial's curve (arc length per step, radius 196), fade from 0.85 rad (about 49 degrees) and are gone 0.5 rad later, so about seven show. The playing collection's row says "Playing" or "Paused" in `accent` on a black pill (so it reads on any cover wash: 5.3:1; plain accent text on a wash dropped to 4.1). A row's hit area is 44 px tall however small it is scaled (`.rp-row::after`).
- **The deck.** The app's fake glass (`.glass-fake`, no backdrop-filter) with the platter as a circle flattened by `scaleY(0.4)`, a tonearm, two knobs. The front collection's cover hovers over the record: its sleeve (1 to 4 covers) with a 44 px **Play {name}** while browsing, or the current track's cover with a Playing / Paused tag when it is the playing collection. Now playing is on the right of the deck from 820 px of deck width, under it below that; "Back to {name}" shows while browsing. The record is a picture disc (the current track's cover edge to edge, grooves over it, a small hole) or black vinyl with the cover as the label, one element switched by `data-picture`. Previous, Play / Pause and Next are 44 px (the main one 52), plain white drawn glyphs with nothing behind them, and the cover's Play is the solid main-action capsule (#413). Nothing is on the platter: a bare black record, still, the arm at rest, "Nothing playing", the buttons dimmed (`aria-disabled`).
- **Narrow.** The deck's decorative parts (deck, platter, record, hovering cover, tonearm) sit in one `.rp-stage` drawn 520 px wide and scaled by a transform from the deck's width (`--s`, `clamp(0.35, tan(atan2(100cqw, 520px)), 1)`, 1 from 520 px up), so nothing overflows at 320 px; the Play button on the cover counter-scales so it stays 44 px high, and now playing stays outside the stage at full size. Checked at 320 px wide and with the root font size at 200%: no horizontal page scroll in either.
- **Narrow caption.** Below 430 px of page width (the wheel is then narrower than its 430 px and its rows would clip names at the edge; a container query on `.rp-grid`) the wheel rows show art only (`.rp-text` is `display: none`; each option keeps its `aria-label`) and the selected collection's full name (wraps, 1.25rem, 700) and "6 tracks, 24 min" show under the wheel (`.rp-cap`, `SelectedCaption`). It follows the selection, is real text (not `aria-hidden`: it is not the option's exact label, which adds the player's state) and is `display: none` from 430 px up, where nothing changes.
- **Row names and narrow switches.** A wheel row's name is capped at 196 px (`.rp-text b`), so the front row, the right-most one, always ends in an ellipsis inside the 430 px wheel instead of being cut mid-letter; wheel text stays px. Under 640 px of window width the two switches drop the divider and the second group's padding, each group stays inside the pane (a long option label wraps in two lines), and only the eyebrow and heading keep clear of the cloud button. In the queue, below 26 rem of row width a failed track's Try again drops under the row, lined up with the text column, and the row drops its play icon and tightens its gap so the title and error stay readable.
- **Text size.** The wheel's art and row captions keep fixed pixel sizes (they stop growing, like the Library cloud's badge). Now playing (eyebrow 0.75rem, title 1.25rem, artist 0.875rem, wrapping with `overflow-wrap: anywhere`) and the queue (title 0.9375rem, artist 0.8125rem, two lines then an ellipsis with the full text in `title`; the time column is a minimum width) are in rem and scale with the root font size. Now playing is in the deck's flow (not absolutely placed), so the space under the deck follows its content and the queue moves down. The queue's two sides stack when a column would be under 20rem. Checked with 60+ character titles at a root font size of 200% (`large-text-1280.png`): nothing overlaps, no mid-word breaks.
- **Layout.** The page is container-queried: two columns (wheel, deck) from 900 px of page width, one column below; the deck puts now playing under it below 820 px of its own width. The queue (Side A and Side B side by side, the page's existing rows) and the "Make it a playlist" guide sit under the deck; Edit collection works there as in List.
- **Colour.** The page takes the front record's first cover's colours as the release page does (`useArtworkPalette`, `AmbientBackdrop`).
- **Browsing never stops playback.** The wheel only changes what is previewed (the cover, the queue, the colours, a moment after it settles); Play, Enter or tapping the front row starts that collection (on the playing one it pauses or resumes). Prev goes back one track (it does not restart the current one; the player store has no restart).
- **Steady.** The record, platter and controls are mounted once; a turn, pause, skip, new collection or Picture disc / Black vinyl changes a class, a style value or a text. Rows have stable keys. A control that goes away because it was pressed hands focus on: Play on the cover to the Pause button, Back to {name} to the wheel. Checked in a browser by marking the platter, record and face before a run of turns, pause, resume, skip, Play on another collection and the vinyl switch: the marks were all still there, the face's one running animation was the same object throughout, and focus stayed on the pressed button (and on a pressed queue row).
- **Keys** act only when the wheel (a `listbox` with `aria-activedescendant`, one tab stop) has focus: Up, Down, Home, End, PageUp and PageDown (5 rows), a typed name (a pause of 700 ms starts a new word; a space only continues one), Enter plays or pauses the selected collection. The selection is logical: it changes at once on every key (and is what `aria-activedescendant` and `aria-selected` name) and the animation only chases it, so Down three times and Enter in the same frame plays the third-next collection (`keyTarget` in `src/lib/record-player.ts`, tested). Enter on the hub's buttons, in the search field or on the cover's Play does only what that control does. A search field above the wheel filters the collections (the wheel and "5 of 24" follow). The wheel scrolls (a native wheel listener), drags and snaps; a tap on a row turns to it, a tap on the front row plays it.
- **Motion budget** (nothing else moves; only `transform` and `opacity`, the house easing `cubic-bezier(0.16, 1, 0.3, 1)`; keyframes `rp-turn`, `rp-onto`, `rp-rise` in `globals.css`): the wheel turning and snapping (a `requestAnimationFrame` loop that runs only during a turn, 96 ms time constant so it is the same at any frame rate), the record onto the platter when another collection starts (600 ms), the tonearm's swing (900 ms, on while something is on the platter, still on the record when paused), the cover rising in (420 ms), the record turning (1.8 s a turn, 33 1/3 rpm; still when paused, idle, hidden or off screen).
- **Cost.** Only the rows near the front exist and move: 17 are mounted, at most 13 are inside the cull and about 8 are drawn; a row more than 6 steps away costs one comparison (`rowPose` returns null before any maths) and `windowIndexes` does not walk the list, so 200 collections cost what 20 do. The deck's progress line is its own component, so the four position ticks a second render nothing else. A hidden tab (`visibilitychange`), the deck out of view (its own `IntersectionObserver`) pause the spin; the wheel out of view (a second observer, since at the stacked width one can show without the other) or a hidden tab makes a turn jump and settles one already running. Measured on 23 Oct in headless Chrome 155 (no GPU, 60 Hz), 200 collections seeded through the local API, a scripted 2 s wheel turn (a wheel event every 16 ms, a `requestAnimationFrame` loop recording the gaps): 121 frames, median 16.7 ms, 95th percentile 16.7 ms, worst 16.8 ms (a second run 16.7 / 16.8); the same turn with the page filtered to 12 collections gave the same numbers; with the CPU throttled 6x, median 16.7 ms, 95th 16.8 ms, worst 33.3 ms. Re-measured on 24 Oct after the hit-box change (200 collections, Down every 70 ms for 5 s): 299 frames, median 16.7 ms, 95th percentile 16.8 ms, worst 16.8 ms.
- **Reduce Motion.** The wheel jumps between records, nothing spins (`animation: none` on the face), the cover appears without rising, the record does not slide on, the tonearm sits still (it is placed, not swung). The page is complete without motion.
- **Accessibility.** Names are always in text (the row, the queue heading, the Play button's `aria-label`); each row's label ("Late drives, 27 tracks, playing") and its visible tag come from the player store's one state; icon buttons have `aria-label`s; every control has the accent focus ring (`focus-visible`) and a 44 x 44 hit area (a wheel row's hit box is a fixed 44 px that only moves; only its art and text scale, so a turn costs no layout); the wheel is one `listbox` with `aria-setsize` and `aria-posinset`. The "Your music" eyebrow sits on an opaque `bg` pill (accent on black, 5.25:1 measured from a screenshot; plain accent on the wash measured 2.2:1 on a bright purple cover); the queue's accent track title measured 5.15:1 on its dark ground. Caption text sampled at 7.9 to 9.7:1 on the page wash (white 16 to 20:1). The main pane's `scroll-padding-bottom` keeps the mini player and the release bar off a focused control.
- **States** (the plan's wording, word for word): no collections ("Make your first collection: a mixtape of any tracks and releases." with **New collection**, the empty record), an empty collection (its row says "0 tracks"; "Nothing here yet. Add tracks from any release or track row." with **Add tracks**; Play is disabled), a failed read ("Couldn't load your collections" with **Try again**), loading (quiet shapes in their final sizes, no spinner). These three are the List view's own blocks, shared.
- **Not in this step:** the plan's "A track fails to play" row is the List view's own (its **Try again** moves focus to that track's row button first, since starting clears the failure mark and removes the button).

## Collections record player (iPhone, #339, #352)

Previews: `docs/design-previews/339-ios/` (`player-<case>.png`, from the gallery's `collections-player-*` cases). Target look: `docs/design-previews/339/phone-record-player*.png`. The Mac's half is #351; the maths is a port of its `record-player.ts` into `Domain/RecordWheel.swift`.

- **Switches.** **Record player / List** and **Picture disc / Black vinyl** are the slim `SlimSwitch` (compact) in `CollectionsModeSwitches`, side by side when they fit, else stacked (see Glass controls below, whose switch part #411 retired: no cover tint); a stacked switch uses a 22 pt rounded track with an inset thumb. Each option has a 44 pt hit area and `.isSelected`; each group reads its name ("View", "Spinning record"). The record group shows only in the record player. Both choices are remembered per device (`locally.collections.view`, `locally.collections.record`); hidden with no collections. The List view is unchanged.
- **Glass controls (#363).** The two switches are the slim `SlimSwitch` (compact, no cover tint since #411), side by side when they fit at 390 pt, else stacked, each stacking its own words at the accessibility sizes; the play / pause disc (the thumb recipe on a circle with a top-left highlight) and the played part of the progress line (with a faint glow) take the front cover's colour (the palette behind the wash; accent when none). Previous and next are `GlowGlass` circles with the round `GlowRim` (#414 makes them plain icons); + is a plain icon (#411). The wheel's ring dissolves over its last 18 degrees at the top and bottom. Frames: `docs/design-previews/363-ios/` (`after`, `player-bright`, `player-ax3`).
- **The wheel.** The hub (the playing record, radius 154 with an 8 pt dark platter rim) sits on the left edge; rows ride the right half of a dial of radius 182. A row is a 48 pt `CollectionCoverView`, the name (`rowTitle`, one line, an ellipsis that ends 16 pt inside the screen) and "27 tracks" (`meta`), level, 64 pt apart at the front, each step 0.87 of the last, fading past 0.85 rad (about 49 degrees) so about seven show. A thin ring (radius 214) and a 14 x 3 accent notch mark the front. Only the window of 15 indexes around the front is built, keyed by collection id; placement is `offset`, `scaleEffect` and `opacity` only, and the rows are an `Animatable` view so a snap re-places just those rows. The playing collection's row says "Playing" or "Paused" in `Tint.accentText`, on one line with the count or, when the room is short (320 pt), the state above the count (only the name may end in an ellipsis) (4.5:1 on black; `accent` itself is 4.0:1), from the player's state. Under it, at the left: "1 of 24" and a 44 pt + (New collection).
- **The hub record.** Picture disc: the playing track's cover edge to edge, faint grooves, a 16 pt centre hole. Black vinyl: black with grooves and the cover as a 36 % label. Nothing playing: a bare black record. It always shows the playing track, turns at 200 degrees a second (33 1/3 rpm) only while playing, keeps its angle when paused (the angle is accumulated across pauses), and the two looks are two layers cross-faded in place (0.3 s) so nothing remounts and the turn never restarts.
- **Gestures.** A vertical drag that starts on the wheel turns it (one row per 64 pt); on release it snaps to the nearest row, from the predicted end translation for a flick (at most 8 rows), on `.timingCurve(0.16, 1, 0.3, 1)` over 0.45 s (0.55 s for a tap or an adjust). A drag anywhere else scrolls the page. A light selection haptic on each change of the front row. Every row is a button with a 44 pt hit area however small it is drawn.
- **Motion and power.** The spin and the wheel's animation stop when the scene is not active, in Low Power Mode (`BackdropMotion.isActive`), when the screen is not showing, when the wheel is scrolled out of view (`onGeometryChange`, back-deployed, reduced to one Bool so only an in / out change updates state; it works on iOS 17) and under Reduce Motion, where the wheel jumps. Only transforms and opacity move; nothing that moves has a blur or material.
- **Now playing** (under the wheel, scales fully): the eyebrow "Late drives · track 3 of 27", the title and artist, a progress line, previous / play-pause / next centred (44 pt, the main one 52), plain white drawn glyphs with nothing behind them (#414; the tinted glass disc is gone). While the front differs from the playing collection, "Back to {name}" turns the wheel back. Nothing playing: "Nothing playing", the controls disabled.
- **The queue** is the collection page's, shared (`CollectionQueueHeader`, `CollectionQueueRows`): name in full, "27 tracks, 1 hr 56 min", Play / Pause, Edit collection (opens the page in edit mode; Play / Pause keeps its words on one line and the buttons stack at the largest text), Side A and Side B (the queue split in half, the extra track on A), the rows, "Make it a playlist". The collection page uses the same views, now with Side A and Side B in place of the single "Queue" heading.
- **Text size.** The wheel's art and captions (the rows, the count) stop growing at `xxxLarge`; now playing and the queue scale fully and wrap at the accessibility sizes.
- **VoiceOver.** The wheel is one adjustable element, "Collections", valued "Late drives, 27 tracks, 1 hr 56 min, playing, 1 of 24"; increment and decrement turn it; the default action plays the front collection or pauses it (the hint says which). The count, the + and the controls are separate elements.
- **The wash.** The page takes the front collection's first cover colours through `ArtworkBackdrop` (the library sky's palette and caps), cross-fading as the wheel turns (none under Reduce Motion); it drifts only by the `BackdropMotion` rules. A 45 % black scrim (`playerScrimOpacity`) keeps grey text at 4.5:1 on a pale cover. No blur or material.

## History (iPhone, #399)

- **Look:** the owner's variant B, "Day strip and crate". A strip of 14 days (today at the right), each a stack of cover-coloured discs with its weekday and date; the selected day glows in its top cover's colour. Under it the day's heading (Today, Yesterday or the date), the play count, a minutes pill, then a two-column crate of record sleeves, staggered, newest first. A sleeve's disc peeks out in proportion to how much of the song was heard; under it the time, the title and the device. The newest play's cover washes the page.
- **Behaviour:** tapping a day selects it; tapping a play opens its song page (a song not on this phone opens nothing); scrolling the strip back to its oldest day reads the 14 days before it, to 400 days. At accessibility sizes the crate is one column. Strip days are 44 pt buttons ("Today, Sun, Oct 25, 6 plays, 14 minutes", selected); each sleeve reads "Title, Artist, 3:48 PM, iPhone, full listen".
- **States:** a loading shimmer of sleeve shapes (still under Reduce Motion), "No plays yet", signed out (asks to sign in as Stats does), offline (the last answer with "Couldn't refresh"), and a 429 ("Try again in a few minutes").
- **Ways in:** a round glass History button at the Stats title's trailing edge; the song page's "Last played" line (a clear 44 pt button over it, the line looks as before). Screenshots in `docs/design-previews/368-history/`.

## The song page (iPhone, #365)

- **Hero:** the cover's colours wash the page; the cover is a playable sleeve (`SpinningSleeve`, shared with the collection page) whose disc turns only while this song plays; then the title, the linked artist line and four bare actions (glyph over label, nothing behind them; pressed they go full white with a soft glow in the cover's colour). At AX sizes the actions are a 2 x 2 grid and their labels stop growing at AX3.
- **Details panel:** one opaque near-black panel (`Theme.SongPage.panelFill`) with 28 pt continuous top corners, a 1 pt highlight and a grabber, rising over the wash. Plays (bars in the cover's lifted brighter colour), In collections (tiny sleeves), On the album and File as hairline rows. No glass cards, house sans fonts only.
- **Adopted songs:** the sleeve is dimmed and inert, Edit and Share are left out and a quiet line says "Edit it on your Mac". Screenshots in `docs/design-previews/365/`.
