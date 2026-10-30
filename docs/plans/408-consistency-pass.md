# 408 — Consistency pass: quiet design across Mac and iPhone

Source: the owner's 30 Oct Consistency Checklist (27 parts, C01 to C27). The owner picked
**match** for 25 parts and **keep** for C13 (navigation) and C25 (release page edit model).
The rules are in `docs/design.md`, **Design rules (30 Oct 2026)** (PR #407). Every issue builds to
those rules, not to the older glow entries.

No contract changes: nothing touches `spec/sync.md`, `spec/metadata.md` or `apps/api`. Every issue
changes UI only.

## Issues

| # | Issue | Picks | App | Model |
|---|---|---|---|---|
| 409 | Plain buttons | C01 C02 C03 C06 | Mac | sonnet |
| 410 | Slim neutral choosers and slider | C04 C05 C07 C15 | Mac | sonnet |
| 411 | Plain buttons, switches and slider | C01 C02 C04 C06 C07 C15 | iPhone | sonnet |
| 412 | Shared icon set | C21 C13 | both | opus |
| 413 | Plain transport, one playing state | C17 C14 | Mac | sonnet |
| 414 | Plain transport, one playing state | C17 C14 | iPhone | sonnet |
| 415 | Toasts and dialogs on one glass recipe | C10 C11 | Mac | sonnet |
| 416 | Settings in glass groups | C20 C26 | Mac | sonnet |
| 417 | Labels, search, headers, corners | C08 C12 C22 | Mac | sonnet |
| 418 | Eyebrows, headers, corners | C12 C22 C08 | iPhone | sonnet |
| 419 | Right-click track menu | C09 | Mac | sonnet |
| 420 | One Collections card | C24 | Mac | sonnet |
| 421 | Added moment, one wording | C27 | Mac | sonnet |
| 422 | Slow pages, then loading | C19 | Mac | opus |
| 423 | Slow screens, then loading | C19 | iPhone | opus |
| 424 | Research: what stats people want | C23 | docs | opus |
| 425 | Stats redesign plan | C23 C05 | docs | opus |
| 426 | Retire the glow entries in design.md | C16 C17 C14 | docs | sonnet |

C18 (empty states) is covered by 409, 411, 417 and 418. C13 and C25 stay as they are.

## Order and overlap

- **First, once #407 merges:** run the Mac and the iPhone in parallel. On the Mac, 409 comes
  before 410, because both edit the button and switch rules in `globals.css`. On the iPhone, 411
  runs on its own. 412 (icons) and 424 (research) can run at the same time; neither touches
  their files.
- **Then:**
  - Mac 413 (needs 412), 415, 416, 417, 419, 420 and 421. They share `globals.css`, so run them
    one at a time or keep each to its own section of the file. 415 goes before 421, which uses
    the toast. 417 goes before 416, so Settings gets the corner scale.
  - iPhone 414 (needs 412) and 418.
- **Performance:** 422 and 423 can start at any time, but they are best done after the
  restyles, so the measurements cover the final pages. Each one's build or profiling takes a
  heavy unit or the whole Mac.
- **Stats:** 425 waits for 424 and the owner's approval of its plan. The Stats build issues
  come from 425.
- **Last:** 426 rewrites `docs/design.md` once the build issues have landed. Until then, each
  issue edits only its own component's entry in `docs/design.md`.
- Every visible change goes through `/codex-review` before its PR merges. Stage explicit paths.
