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
| Branch | `design/145-streams-page`, PR #192 (draft), issue #145 |
| Current design task | The **Stats page** on the Mac, going from the approved prototype to the real page |
| Also open | PR #208 (`feat/203-sidebar-periods`, worktree `locally-203-periods`): the sidebar's Today / This week / This month. Reviewed, waiting on the owner's merge |
| Not ours | `/Users/tdare514/Documents/Coding Main/coding/locally` is another session's checkout. That session also owns PRs #191 and #195 → #196 → #197 |

## How to preview
- **Stats prototype (sample data, dev only):**
  - From this checkout: `cd apps/web && npm run dev -- -p 3192`.
  - Then open http://127.0.0.1:3192/dev/stats (`/dev/streams` is the same page).
  - It's usually already running on 3192.
  - The route returns 404 in production builds and in the demo.
- **The real Mac app on a test library** (never the owner's real one):
  - Run `LOCALLY_CONFIG_DIR=<a temp config dir> npx next dev -H 127.0.0.1 -p <port>` from `apps/web`.
  - A ready-made test config with drawn covers and per-day plays is at `/private/tmp/claude-501/-Users-tdare514-Documents-Coding-Main-coding/947a90c1-22c8-4c68-aaea-eed86bd8a662/scratchpad/203-build/config`. That's the session scratchpad, so it may not survive a reboot.
  - Usually running at http://127.0.0.1:3177, from the `locally-203-periods` worktree.
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
- **Not built yet:** the real page. The prototype is sample data, under `apps/web/src/components/dev/streams/`.

## Relevant files
- **The prototype:**
  - `apps/web/src/components/dev/streams/StatsView.tsx` (page)
  - `StatFan.tsx` (the five-sleeve fan, mirrors the sidebar's `StatShelf`)
  - `parts.tsx` (list, grid, period controls)
  - `sample-data.ts` (a seeded day-by-day history)
  - `StreamsPrototype.tsx`
  - The routes `apps/web/src/app/dev/{stats,streams}/page.tsx`
- **Styles:** in `apps/web/src/app/globals.css`, the `.st-fan-*` rules, the `.seg-glass*` rules, the button set (`.btn-save`, `.btn-ink`, `.btn-seg`) and the sidebar (`.sb-*`).
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
