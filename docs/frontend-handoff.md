# Frontend handoff: Claude builds, Codex reviews

Written 15 Oct 2026 for bringing Codex into Locally for frontend design input and review.

**Roles:**
- **Claude** (the Claude Code session that wrote this) owns the implementation of the branches below.
- **Codex** reviews and proposes.
- **The owner** (tdare514) decides.

**Sources:**
- **Design source of truth:** [`docs/design.md`](design.md). When a decision changes, that file changes first, and both apps follow.
- **Repo rules:** [`AGENTS.md`](../AGENTS.md), [`apps/web/AGENTS.md`](../apps/web/AGENTS.md) and [`apps/ios/AGENTS.md`](../apps/ios/AGENTS.md).

## Where the work is

| | |
|---|---|
| Checkout | `/Users/tdare514/Documents/Coding Main/coding/locally-145-streams` (a git worktree) |
| Branch | `design/145-streams-page`, PR #192 (ready for review), issue #145 |
| Current design task | The **Stats page** on the Mac is built on real data. Now: the sleeve fan's spacing (see "Review round 2" at the end) |
| Merged since | PR #208 (the sidebar's Today / This week / This month) and #209 (Settings and profile at the foot of the rail), both merged into this branch |
| Not ours | `/Users/tdare514/Documents/Coding Main/coding/locally` is another session's checkout. That session also owns PRs #191 and #195 → #196 → #197 |

## How to preview
- **Stats page:** reached from the sidebar's Stats icon in the app below. The sample-data prototype was deleted when the page was built.
  - Removed: the Stats page is now real (see below). Use the real Mac app on a test library, next.
- **The real Mac app on a test library** (never the owner's real one):
  - Run `LOCALLY_CONFIG_DIR=<a temp config dir> npx next dev -H 127.0.0.1 -p <port>` from `apps/web`.
  - A ready-made test config with drawn covers and per-day plays is at `/private/tmp/claude-501/-Users-tdare514-Documents-Coding-Main-coding/947a90c1-22c8-4c68-aaea-eed86bd8a662/scratchpad/203-build/config`. That's the session scratchpad, so it may not survive a reboot.
  - Usually running at http://127.0.0.1:3177, from this worktree, on the config `/private/tmp/claude-501/-Users-tdare514-Documents-Coding-Main-coding/947a90c1-22c8-4c68-aaea-eed86bd8a662/scratchpad/192-preview/config` (13 played tracks with drawn covers).
- **The other previews in the app:**
  - `/dev/buttons`: the button set.
  - The Import page: Import in the sidebar.
  - The sidebar: hover the left rail.
- **Screenshots:** in `docs/design-previews/<issue>/`. The Stats ones are in `docs/design-previews/145/`.
- **Checks:** `cd apps/web && npm run check` (typegen, tsc, eslint, vitest).

## The direction (decided by the owner)
- **The #112 immersive look:**
  - The cover's colours wash the page.
  - Covers are record sleeves with a disc.
  - A calm, slow colour drift where there's no cover.
  - Playful but calm, and never a stats.fm or Spotify copy.
- **Glass is faked:** `.glass-fake`, the phone-tray cloud button's recipe. No `backdrop-filter` over the animated ambient.
- **Text:** sentence case only, with no small uppercase tracked labels. Tabular numbers for counts.
- **Plays:** the UI shows **one play total** per track (all devices), never per-device splits.
- **Motion:**
  - All of it in one file, `apps/web/src/app/globals.css`.
  - The house easing is `cubic-bezier(0.16, 1, 0.3, 1)`.
  - Transform and opacity only.
  - Every effect has a `prefers-reduced-motion` fallback.
  - Restraint: one shimmer per hover, never a loop.
  - See `~/.claude/design/motion.md` on the owner's machine.
- **Buttons (#155):** see "Buttons on the Mac" in `docs/design.md`.
  - Main actions are see-through at rest and light into the cloud glass on hover.
  - Secondary actions are ink with a white halo, and Delete has a red halo.
  - Toggles are words with a dot.
  - The owner rejected anything that looks like 2000s glossy buttons.
- **Merged today:**

  | PR | What |
  |---|---|
  | #173 | buttons |
  | #176 | Import, "make a record" with the slide, flash and seal beat |
  | #177 | the rail + bloom sidebar |
  | #188 | iPhone Settings, glass groups |
  | #206 | the Mac counts plays per day, with a local `GET /api/plays/summary` |

## The Stats page: decisions already made
- **The direction:** B, with the podium replaced by the **five-sleeve fan** from the sidebar's Stats shelf.
  - #1 sits in the centre in gold, silver and bronze are either side, and #4 and #5 are outside.
  - Hover or focus lifts a sleeve and slides its record out, with the title and plays.
  - The sidebar shows the top 3, and this page shows the top 5.
- **Below the fan** are the "regular stats" as in the sidebar: a ranked list with cover, artist, last played, a play bar and the total.
  - A **List / Grid** toggle switches it. Grid is the "sorted sea": covers sized by plays, in rank order.
  - The list starts at #1, so the top 5 appear in both the fan and the list. That was Claude's default, and the owner has not objected.
- **Time frames,** deeper than the sidebar:
  - Today, This week, This month, This year and All time.
  - Step back with ‹ › (Last week, 2 weeks ago, Last month…).
  - The chosen period sits on the `.seg-glass` control, the same glass as a hovered main button.
- **Tracks / Albums / Artists** drive the fan and everything below. Artists are round discs.
- **The page is called "Stats".** The sidebar gets a Stats row and rail icon, plus "See all stats", when it ships (`HAS_STATS_PAGE` in `apps/web/src/components/sidebar/flags.ts`).
- **Data:** this Mac's plays from `GET /api/plays/summary?from&to` (range ≤ 400 days, `to` ≤ tomorrow, `from` ≥ today − 400), using the period maths in `apps/web/src/lib/play-periods.ts` from PR #208.
  - Other devices' plays arrive with #202.
  - The iPhone version is #204.
- **Built (15 Oct 2026):** the real page, under `apps/web/src/components/stats/`, on real data, with Codex's review folded in (reduced-motion order, real activation, responsive Grid, coverage line, sparse fans, light-cover contrast, 390 px). `docs/design.md` "Stats page (#145)" describes it as built; the prototype is deleted. Not built: other devices' plays (#202), the iPhone (#204).

## Relevant files
- **The page:**
  - `apps/web/src/components/stats/StatsView.tsx` (page), `SleeveFan.tsx` (the fan, shared with the sidebar's shelf), `StatsRows.tsx` (list and grid), `controls.tsx`
  - Pure helpers: `src/lib/fan-layout.ts`, `stats-copy.ts`, `stats-layout.ts`, and `play-periods.ts` (periods and steps)
- **Styles:** in `apps/web/src/app/globals.css`, the `.fan*` and `.st-*` rules, the `.seg-glass*` rules, the button set (`.btn-save`, `.btn-ink`, `.btn-seg`) and the sidebar (`.sb-*`).
- **The sidebar it pairs with:** `apps/web/src/components/sidebar/` (`StatShelf.tsx`, `StatList.tsx`, `use-stats.ts`), and `apps/web/src/lib/play-stats.ts` for ranking.
- **Data:** `apps/web/src/app/api/plays/summary/route.ts`, `apps/web/src/server/plays/playsSummary.ts` and the plan [`docs/plans/193-plays-by-day.md`](plans/193-plays-by-day.md).
- **Ambient:** `apps/web/src/components/AmbientBackdrop.tsx`, `AmbientSpace.tsx` and `apps/web/src/lib/artwork-palette.ts`.

## Questions for Codex
1. **Hierarchy:** the fan, then the digest sentence, then the list or grid. Does the page read top-down, or does the fan compete with the period controls? Should the list start at #6 to avoid repeating the top 5?
2. **Period stepping:** are ‹ › with "Last week" and "2 weeks ago" clear next to the five period options? Is there a calmer pattern that still allows going back months?
3. **The sea (Grid):** at the smallest cover sizes, is it still readable and clickable? What minimum size and focus treatment would you set?
4. **Contrast over the wash:** the page takes the #1 cover's colours. Do text and play bars keep contrast on very light covers (cream, pastel), and is a scrim needed?
5. **Consistency:** the sidebar shows 3 sleeves and this page shows 5, with the same component styling. Anything that should differ beyond size?
6. **First week and empty states:** day counting started with this update, so "This week" can be thin or empty for new users. What should the page show then, beyond "No plays yet this week"?
7. **iPhone (#204):** what has to change for the fan and the sea on a 390 pt-wide screen?
8. **Accessibility:** is the keyboard and screen-reader story for the fan right (sleeves are focusable, focus lifts like hover)? Anything missing under Reduce Motion?

## How to review without colliding
- **Leave your feedback** as comments on PR #192 (or #208), or in a "Codex review" section added to this file on a branch of your own.
- **Don't push to `design/145-streams-page` or `feat/203-sidebar-periods`.** Claude implements, so there's one writer per branch.
- **To propose code,** use a `codex/<topic>` branch off `main` and point to it in a PR comment.
- **Settled decisions** are listed above and are the owner's. Disagree in a comment, with a screenshot, and the owner decides.
- **Never run the app against the owner's real library or config.** Use `LOCALLY_CONFIG_DIR` with a temp copy. Tests never touch real directories.

## Review round 2: the sleeve fan's spacing (15 Oct 2026, evening)

**The owner, on the fan at the top of the Stats page:** "There's issues with the placement. They shouldn't be this crowded. They should be sitting in such a way that you can easily wheel through them. Maybe the selected one pops out a bit more prominently than now. But I like this as a base: we should just perfect it, not make it way more different."

**Before** (screenshots outside the repo, readable by path):
- `/private/tmp/claude-501/-Users-tdare514-Documents-Coding-Main-coding/947a90c1-22c8-4c68-aaea-eed86bd8a662/scratchpad/review-pack/fan-before-owner.png`: the owner's screenshot at 1440px, on a test library where some covers are blank.
- `/private/tmp/claude-501/-Users-tdare514-Documents-Coding-Main-coding/947a90c1-22c8-4c68-aaea-eed86bd8a662/scratchpad/review-pack/fan-before-week.jpg`: the default state.
- `/private/tmp/claude-501/-Users-tdare514-Documents-Coding-Main-coding/947a90c1-22c8-4c68-aaea-eed86bd8a662/scratchpad/review-pack/fan-before-hover.jpg`: a side sleeve lifted.

**Why it is crowded:**
- Every `.fan-sleeve` sits at the same spot (`left: 50%`). The spread comes only from `rotate(var(--a))` around a far pivot (`transform-origin: 50% 330%`), at 11° per step for five (`lib/fan-layout.ts`). That moves each step only about half a sleeve sideways.
- The active #1 is lifted 0.232 of a sleeve and scaled 1.07, so #2 and #3 show about a quarter, and #4 and #5 are slivers.
- In an emulated touch test, taps on the visible part of #4 landed on #2: Chrome's touch targeting picked the neighbour.

**The fix Claude is building now,** for the page fan only (the sidebar's three-sleeve shelf stays identical):
1. **A sideways step per sleeve:** the CSS `translate` property, `--fan-step`, as well as the tilt. Less tilt on the page (`--fan-tilt` about 0.7). `--w` is retuned so the fan fits from 390 to 1440px.
2. **Targets:**
   - In the default state, every non-active sleeve has at least 55% of its button uncovered, and #2 and #3 at least 65%.
   - A left-to-right sweep at mid-height lifts 4, 2, 1, 3, 5, each over a band at least 0.35 of a sleeve wide.
3. **The chosen one pops more:** a lift of about 0.3 of a sleeve and a scale of about 1.12. The rest dim behind a dark overlay at about 0.2, faded by opacity.
4. **← → wheel focus through the sleeves** in visual order.
5. **The fan rule** in `docs/design.md` ("Stats page (#145)", **Fan**) is updated to match.

**After:** when the commit lands on this branch, the screenshots are `docs/design-previews/145/stats-fan-1440.png` and `stats-fan-390.png`. Check `git log --oneline -3` for "space the sleeve fan out". The live page is at http://127.0.0.1:3177 (Stats in the left rail).

**Questions for Codex:**
1. **Spacing:** how much overlap keeps it one hand of cards around #1 while each sleeve is easy to land on and sweep through? Is 55 to 65% uncovered right?
2. **Prominence:** is lift, scale and dimming the rest the right way to make the chosen one pop, within transform and opacity only? Or would straightening it fully, or a brighter rim, do more?
3. **"Wheel through them":** beyond hover and ← →, should a horizontal trackpad swipe over the fan step the selection? Vertical scrolling must keep scrolling the page. Or is that over-building?
4. **Hierarchy:** with a wider fan, does the page still read top-down: the digest sentence, the fan, then the list or grid?
5. **Narrow and touch:** at 390px, and for the hosted web on touch, do the sleeves stay tappable?

Reply as a comment on PR #192, as before. Claude implements; please don't push to this branch.
