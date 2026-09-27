@AGENTS.md

## Claude-specific notes

- Author commits as `tdare514 <143902012+tdare514@users.noreply.github.com>`, with a
  `Co-Authored-By: Claude` trailer.
- Run `npm run check` before pushing anything.
- Self-review the diff (`git diff`) before every push — check for stray debug code,
  leftover temp-dir writes, and that no test touched a real user directory.
