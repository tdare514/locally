@AGENTS.md
@STATUS.md

## Claude-specific notes

- Author commits as `tdare514 <143902012+tdare514@users.noreply.github.com>`, with a
  `Co-Authored-By: Claude` trailer.
- Run `npm run check` in `apps/web` before pushing web changes and in `apps/api` before pushing API changes; build the iOS app with `xcodebuild` (see `apps/ios/README.md`) before pushing iOS changes.
- Self-review the diff (`git diff`) before every push — check for stray debug code,
  leftover temp-dir writes, and that no test touched a real user directory.
