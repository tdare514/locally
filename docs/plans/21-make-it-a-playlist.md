# Make it a playlist, guided flow (issue #21)

## Summary

Ship option B from `docs/research/playlists.md` (#18): a polished, guided, copy-driven flow that
helps a user turn an imported album into a Spotify playlist by hand. No API call can add a local
file to a playlist (research §2), so this plan only replaces today's plain instructions with a
Copy-button plus per-platform steps and a fallback line, on both apps. It is UI and copy only:
no sync, metadata, or API contract change, and no new permissions beyond a clipboard write the
user triggers themselves.

The existing "Make it a playlist" `DisclosureGroup` on iOS's release page
(`apps/ios/Locally/Views/Library/ReleaseDetailView.swift:123`) and the plain done-album sentence
in `Copy.Import.doneAlbum` (`apps/ios/Locally/Resources/Copy.swift:66`) both get the new copy and
a Copy button. The Mac app's release page (`apps/web/src/components/ReleaseView.tsx`) has no such
disclosure today; this plan adds one there, matching iOS placement and wording.

## Decisions (what is fixed by this plan)

1. **Scope is B only.** Option E (clipboard `spotify:local:` URIs) and option C (API-created
   playlist) are not built here. The "Check first" section below tells the implementer how to
   fold E in cheaply if the Mac check says it still works, without re-opening this plan.
2. **Where the guided flow lives, per app:**
   - iOS: the import-time `DoneView` is the done screen the issue asks for. After an album
     import it shows the album title with a Copy button, the track titles in order (already
     there), the iPhone steps and the fallback line. The existing
     `DisclosureGroup(Copy.Detail.makeItAPlaylist)` in `ReleaseDetailView.swift` shows the same
     steps and Copy button for a release opened later. Both read the one set of strings in
     `Copy.Detail`, so the text cannot drift.
   - Mac: `apps/web/src/components/ReleaseView.tsx` gets a new disclosure section in the same
     position as iOS's, between the Tracks section (ends `apps/web/src/components/ReleaseView.tsx`
     around line 230, the closing `</div>` after `<TrackList .../>`) and the action-button row
     (`Save changes` / `Show in Finder` / `Delete`, starting at the `<div className="flex
     flex-wrap items-center gap-3">` right after it). Because web has no separate "done" screen
     today (`ImportView`'s `onImported` navigates straight to `ReleaseView` after a toast, see
     `apps/web/src/components/AppShell.tsx:72` `handleImported`), the Mac app does not get a
     new intermediate screen. Instead the release page is the done screen: `handleImported`
     passes a `justImported` flag (prop or route state) to `ReleaseView`, and when it is set the
     disclosure renders expanded so the album title, Copy button, track list and Mac steps are
     visible on arrival. Opened later from the library, the disclosure starts collapsed. This is
     the issue's "Done screen" mapped onto the app's actual navigation, not a new screen.
   - The disclosure is shown only when `release.kind === "album"` (Mac) / for `.album` releases
     (iOS), matching the existing gate.
3. **Copy button, not copy-and-select-everything.** One button copies the album title (the string
   the user pastes as the new playlist's name). Track titles are already visible as a numbered
   list on both release pages; no separate "copy track list" control is added.
4. **Single source of strings per app:**
   - iOS: `apps/ios/Locally/Resources/Copy.swift`, inside `enum Import` (the done-album sentence)
     and `enum Detail` (the disclosure body). No new enum.
   - Mac: a new `apps/web/src/lib/playlist-copy.ts` module, mirroring the iOS pattern (a plain,
     framework-free source of the exact strings, importable by both `ReleaseView.tsx` and its
     test). This is the first strings module on the web app; existing components inline their
     copy as JSX literals, so this plan introduces the pattern rather than following one.
5. **Mac steps default to per-track (no Command-click), pending the Check first item below.**
   The issue's default Mac copy assumes Command-click multi-select still adds local tracks to a
   playlist. Research §5 flags this as unconfirmed. Ship the guided flow with a build-time
   constant, `MAC_SUPPORTS_MULTISELECT` in `playlist-copy.ts`, defaulting to `false` (per-track
   steps, the safe assumption) until the implementer confirms otherwise per "Check first" below.
   iOS needs no such flag; only the Mac copy depends on it. Do not ship with the assumption
   baked in as `true`.
6. **Fallback line is always shown**, under the numbered steps on both apps, not conditionally.
7. **No StoreKit/purchase gating.** This flow is not a paid feature; it stays available to every
   user, consistent with today's disclosure.

## Check first (open questions and what to do for each answer)

From research §5, three things must be checked on a real phone and a real Mac before the
per-platform copy is finalized. The implementer does this first, in a fresh session, before
writing any code, and records the outcome as a code comment next to the constant/string it
affects (so a later reader does not have to re-derive it).

1. **Does Command-click multi-select and "Add to playlist" still work for local tracks in the Mac
   Spotify client?**
   - If yes: set `MAC_SUPPORTS_MULTISELECT = true` in `playlist-copy.ts` and use the issue's
     Mac copy verbatim ("Command-click these N tracks. Right-click, Add to playlist, New
     playlist. Paste the name.").
   - If no: keep `MAC_SUPPORTS_MULTISELECT = false` and use the per-track steps, worded like the
     iPhone copy: "Open Spotify, then Your Library, then Local Files. On the first track,
     right-click, Add to playlist, New playlist, paste the name. For each other track:
     right-click, Add to playlist, `<album>`."
2. **Does Local Files on iPhone offer multi-select?**
   - If yes: shorten `Copy.Detail`'s iOS step list to a Command-click-style multi-select
     instruction analogous to the Mac steps (select all N tracks, then one "Add to playlist, New
     playlist" action), and note in a comment above the string which iOS/Spotify version was
     checked.
   - If no (today's assumption, research §2 "iOS" and §5): keep the existing per-track steps,
     just with the exact wording below in Copy.
3. **Does pasting `spotify:local:` URIs into a Mac playlist still work?**
   - If yes: this unlocks option E as a fast follow, not part of this build. Leave a `// TODO
     (#21-followup or new issue): option E verified working <date>, see docs/research/playlists.md
     §5` comment in `playlist-copy.ts` and do not implement E in this change; file it as its own
     issue so it gets its own plan per `AGENTS.md`'s "feature that spans more than one app gets a
     plan" rule (E only touches Mac, so it may not need the cross-app plan step, but still gets
     its own issue rather than being folded in here).
   - If no, or untested within the time box: leave the same TODO noting "unverified" and move on.
     This does not block shipping B.

### How the implementer verifies on real devices

- **Mac, Command-click**: import or open an existing album release (2+ tracks) in the Mac
  Spotify client's Local Files view. Command-click two tracks, right-click.
  - Expected if working: an "Add to playlist" item appears in the context menu, followed by
    "New playlist".
  - Expected if broken: either no multi-selection highlights both tracks, or "Add to playlist"
    is missing/greyed out. Either failure means answer "no" to question 1.
- **iPhone, multi-select**: open Local Files in the Spotify iOS app with 2+ local tracks
  visible. Look for a "Select" affordance (top-right or long-press) that shows checkboxes.
  - Expected if working: selecting 2+ tracks surfaces a bulk "Add to playlist" action.
  - Expected if broken: no selection mode, or the three-dots-per-track menu is the only way to
    add to a playlist. Either failure means answer "no" to question 2.
- **Mac, `spotify:local:` paste**: with a local track's exact URI in hand (artist, album, title,
  duration in seconds, from `spec/metadata.md`'s tag fields), open an existing or new playlist,
  click into the track list, and paste (Cmd-V) the URI string directly.
  - Expected if working: a track row appears in the playlist using the pasted metadata.
  - Expected if broken: paste does nothing, or Spotify shows an error/toast. Either means answer
    "no" to question 3.

## Contract changes

None. `spec/metadata.md` and `spec/sync.md` are untouched: no field is added to a release or
track, and nothing crosses the sync wire differently. This is copy and a client-side clipboard
write.

## Affected components

### apps/ios

- `Locally/Resources/Copy.swift`
  - `enum Import`: `doneAlbum(albumTitle:)` (line 66) becomes the short "sent" sentence only;
    the step list moves to `enum Detail` so `DoneView` and the disclosure share it (decision 2).
    New text under Copy below.
  - `enum Detail`: replace `makeItAPlaylist` (line 142, currently just the disclosure's title) by
    keeping it as the title and adding a new `makeItAPlaylistSteps(albumTitle:)` (or similar,
    following the existing `doneAlbum(albumTitle:)` pattern of a `static func` for
    album-title-interpolated copy) plus a new `makeItAPlaylistFallback` constant for the shared
    fallback line.
- `Views/Import/DoneView.swift`
  - For album imports: show the album title with a Copy button that copies it to
    `UIPasteboard.general.string`, keep the existing ordered track list, then render the
    `Copy.Detail` steps and the fallback line below it. Single imports are unchanged.
- `Views/Library/ReleaseDetailView.swift`
  - Inside the existing `DisclosureGroup(Copy.Detail.makeItAPlaylist)` (line 123), replace the
    body (`Text(Copy.Import.doneAlbum(albumTitle: model.title))`) with the new step list plus a
    Copy button (copies `model.title`) plus the fallback line, all from `Copy.Detail`.
- Use `UIPasteboard.general.string = albumTitle` for the copy action (no new dependency; it is
  the standard iOS pasteboard API). Add a small transient "Copied" confirmation consistent with
  existing button feedback patterns in the view (check `Theme.swift` / nearby buttons for the
  existing toast/feedback convention before inventing a new one).

### apps/web

- New file `src/lib/playlist-copy.ts`: exports the exact strings (see Copy below) as functions
  taking `albumTitle: string`, plus the `MAC_SUPPORTS_MULTISELECT` constant from decision 5 and
  Check-first question 1. Pure, no React, no node imports (mirrors `src/lib/crop-geometry.ts`'s
  style), so it is trivially unit-testable.
- `src/components/ReleaseView.tsx`: add a disclosure section (a `<details>`/`<summary>` pair or a
  small local collapsible, matching `docs/design.md`'s card/border tokens, gated on
  `release.kind === "album"`) placed between the Tracks section and the action-button row (see
  Decisions above for the exact insertion point). It renders the steps from `playlist-copy.ts`
  and a Copy button that calls `navigator.clipboard.writeText(release.title)`.
- `src/components/Icons.tsx`: add a small `CopyIcon` (no copy icon exists today; follow the
  existing icon components' style, e.g. `ChevronRightIcon` at line 50, for stroke width and
  viewBox conventions).
- `src/components/AppShell.tsx`: `handleImported` passes a `justImported` flag to `ReleaseView`
  for album imports so the disclosure opens expanded on arrival (decision 2). The toast stays.
  `ImportView.tsx` is unchanged.

### Shared

- `docs/design.md`: add the disclosure/Copy-button pattern used on the Mac release page to the
  "Desktop release page" bullet (or a new bullet immediately after it), so the component is
  documented the same way the mobile "Editor / release detail" bullet documents its layout. Note
  the token choice (`card`/`border`, matching the existing disclosure look) and that the Copy
  button uses the existing secondary/outline button style already defined in the tokens table.
- `docs/ios-plan.md` and `docs/web-plan.md`: whichever plan doc still shows the old done-album /
  disclosure copy verbatim (check both for a literal quote of today's strings) gets updated to
  match, since `Copy.swift`'s header comment says its text "mirrors `docs/ios-plan.md`'s
  'In-app copy' section verbatim."
- `STATUS.md`: move the "Guided 'Make it a playlist' flow on both apps" line from **Next** to
  **What works**, under both the Web and iOS subsections, once shipped.

## Copy

Exact strings, no exclamation marks, second person, present tense (per `Copy.swift`'s header
comment, which this plan follows for both apps).

**Shared fallback line (both apps, both platforms' step lists):**
> "If Add to playlist is missing, update Spotify and open it again."

**iOS, `Copy.Import` (done screen heading sentence; the steps follow it from `Copy.Detail`):**
> "Sent. To hear it as an album, make it a playlist in Spotify."

**iOS, `Copy.Detail` disclosure body, default (per-track, `MAC_SUPPORTS_MULTISELECT`-equivalent
not applicable to iOS; used unless Check-first question 2 says otherwise):**
> "Open Spotify, then Your Library, then Local Files. On the first track tap the three dots, Add
> to playlist, New playlist, paste the name. For each other track: three dots, Add to playlist,
> `<album>`."

If Check-first question 2 finds multi-select on iPhone, replace with:
> "Open Spotify, then Your Library, then Local Files. Select these N tracks, then Add to
> playlist, New playlist. Paste the name."

**Mac, `playlist-copy.ts`, default (`MAC_SUPPORTS_MULTISELECT = false`, per-track, matches the
iOS per-track wording but for the Mac client):**
> "Open Spotify, then Your Library, then Local Files. On the first track, right-click, Add to
> playlist, New playlist, paste the name. For each other track: right-click, Add to playlist,
> `<album>`."

If Check-first question 1 confirms Command-click still works, replace with the issue's original:
> "Open Spotify, then Your Library, then Local Files. Command-click these N tracks. Right-click,
> Add to playlist, New playlist. Paste the name."

**Copy button label (both apps):** "Copy" (icon-only is acceptable on iOS if space is tight,
matching the existing pencil-badge icon-only convention in `ReleaseDetailView.swift`; Mac keeps a
visible "Copy" label per the desktop button conventions in `docs/design.md`).

**Copy confirmation (both apps), transient, 2 seconds:** "Copied"

## Security

- No new network calls, no new permissions, no new stored data. The clipboard write
  (`UIPasteboard.general.string` on iOS, `navigator.clipboard.writeText` on Mac) fires only from
  a direct user tap/click on the Copy button, the standard user-gesture-gated clipboard API on
  both platforms; nothing is copied automatically.
- Copied text is the release's own title/artist string, already visible on screen and already
  present in the release's local metadata; nothing sensitive or newly exposed.
- No secrets, tokens, or file paths ever touch the clipboard.
- `spec/sync.md` is untouched, so no new field can leak between devices via sync.
- Web: the Copy button must work under the app's existing loopback-only, CSRF-checked server
  (`src/proxy.ts`); since this is a pure client-side clipboard write with no fetch involved, it
  needs no route changes and doesn't touch the CSRF surface at all. Confirm `ReleaseView.tsx`
  doesn't gain any new `fetch`/`api-client.ts` call as part of this work, it shouldn't need one.

## Tests

Both apps currently have no view-level UI tests (iOS has `ReleaseDetailViewModelTests.swift` for
the view *model*, not the view; web has zero `*.test.tsx` files, see
`apps/web/AGENTS.md`'s architecture map, `src/components/**` is listed as "UI, unaffected by this
architecture"). This plan does not introduce a UI test harness; it keeps the new logic in pure,
already-testable modules instead.

- **iOS**: add a `Copy.swift`-string test (or extend an existing Swift Testing suite under
  `LocallyTests/`) asserting:
  - `Copy.Import.doneAlbum(albumTitle:)` (or its replacement) does not contain the old inline
    step list, and does contain the album title placeholder substitution.
  - `Copy.Detail`'s new step-list and fallback strings are non-empty and (if a
    `<album>`-interpolating function) substitute correctly.
  This mirrors how a plain string constant would be tested: value equality, not view rendering.
- **Mac**: add `apps/web/tests/unit/playlist-copy.test.ts` (vitest, matching the existing
  `tests/unit/**` convention) covering `src/lib/playlist-copy.ts`:
  - Both branches of `MAC_SUPPORTS_MULTISELECT` produce the expected exact strings from the Copy
    section above.
  - The fallback line is exported and matches exactly.
  - Album-title interpolation is correct (e.g., an album titled `Rumours` produces a string
    containing `Rumours`, not a literal `<album>`).
- No test touches `ReleaseView.tsx` or `ReleaseDetailView.swift`/`DoneView.swift` rendering
  directly; that stays a manual check (see Rollout order) consistent with how the rest of each
  app's UI is verified today.
- Run `npm run check` in `apps/web` and build with `xcodebuild` per `apps/ios/README.md` before
  pushing, per the root `CLAUDE.md`.

## Out of scope

- Option E (clipboard `spotify:local:` URIs) and option C (API-created playlist with cover):
  tracked separately per Check-first question 3 and research §4's "Later, gated" section.
- Any change to `spec/metadata.md` or `spec/sync.md`.
- A Mac "done screen" as a new, separate view; decision 2 explains why the existing
  toast-then-navigate flow already serves that purpose.
- StoreKit/purchase gating of this feature (decision 7).
- Automated UI/snapshot testing infrastructure for either app; out of scope for this change per
  the Tests section.
- Catalog-track matching (option D) and any Spotify Web API integration.

## Rollout order

1. Implementer runs the three "Check first" device checks and records the outcomes as code
   comments (per that section) before writing any UI code.
2. iOS: update `Copy.swift` (`Import` and `Detail` enums), then `DoneView.swift` and
   `ReleaseDetailView.swift`, then the `Copy.swift` string tests. `xcodegen generate` if any file
   is added/removed, then `xcodebuild` build and, if a simulator is available, `xcodebuild test`.
3. Mac: add `src/lib/playlist-copy.ts` and its vitest suite first (pure logic, fast to verify),
   then wire `Icons.tsx`'s new `CopyIcon` and the `ReleaseView.tsx` disclosure section, then
   `npm run check`.
4. Manual pass on both apps: import a real (or test) album, confirm the steps and Copy button
   appear on the done screen (iOS) and on the expanded disclosure the import lands on (Mac),
   tap/click Copy, confirm the pasteboard/clipboard holds the album title, and walk through the
   printed steps against the real Spotify client from step 1's findings. Then open the release
   from the library and confirm the collapsed disclosure shows the same content.
5. Update `docs/design.md`, `docs/ios-plan.md`/`docs/web-plan.md` (whichever holds the stale
   verbatim copy), and `STATUS.md` in the same change, per `AGENTS.md`'s rule that a change
   updates the docs it makes stale.
6. Self-review the diff per the root `CLAUDE.md` before pushing: confirm no stray debug prints,
   no temp-dir writes, and that the new clipboard calls are gated behind the button's own
   user-gesture handler (not fired on render or on disclosure expand).
