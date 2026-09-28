# Locally — agent briefing

Locally imports audio files, tags them (cover, artist, album, year, genre, track numbers), and
delivers them to the folder Spotify's Local Files feature reads. It is a monorepo of three apps
that share one metadata model and one sync protocol.

## Components

| Path       | What it is                                            | Read before working on it |
|------------|-------------------------------------------------------|---------------------------|
| `apps/web` | Mac/desktop app (Next.js, local-only server)          | `apps/web/AGENTS.md`      |
| `apps/ios` | iPhone companion (SwiftUI, XcodeGen, share extension) | `apps/ios/AGENTS.md`      |
| `apps/api` | Hosted sync service (Next.js, API routes only)        | `apps/api/AGENTS.md`      |

Shared, app-independent material:

- `spec/metadata.md` — the release/track/tag model every app writes. Change it here first.
- `spec/sync.md` — the sync contract between `apps/api` and both clients.
- `docs/adr/` — decisions already made; add an ADR rather than relitigating one.
- `docs/design.md` — design tokens and components shared by web and iOS.
- `docs/web-plan.md`, `docs/ios-plan.md` — product plans. `STATUS.md` — where the project is now.

## Global invariants (apply in every app)

- **Never write outside the user's library or Spotify folder.** Every user-derived path is
  sanitised by that app's `ReleaseLayout` and inside-checked before any write or delete.
- **No shell-string process spawning.** External tools get an argument array, never a string
  built from user input.
- **No secrets in the repo.** Config comes from env or the app's settings store; `apps/api/.env.example`
  documents keys without values.
- **Contract changes are cross-app.** A change to `spec/sync.md` or `spec/metadata.md` states its
  effect on every client in the same change (or a linked issue) and keeps existing clients
  working until they are updated.
- **Tests never touch real user directories, the network, or external services.** Use temp dirs
  and the fakes each app already provides.

## Working in this repo

- Read the `AGENTS.md` of the app you are changing; it holds that app's architecture map, rules,
  and check commands. Do not load the others.
- `STATUS.md` is the snapshot of what works, what is in progress, and what is next. Update it in
  the same change when your work makes it stale.
- Several sessions may work in this checkout at once. Stage only the files you changed with
  explicit `git add <path>`; never stage, stash, clean, or delete untracked paths you did not create.
- A feature that spans more than one app gets a plan in `docs/plans/<issue>-<name>.md` before
  implementation: contract changes, compatibility, security implications, affected components,
  tests. Implement from the plan in a fresh session; do not redesign the approved contract there.

## Checks

| App        | Command                                                             |
|------------|---------------------------------------------------------------------|
| `apps/web` | `npm run check`                                                     |
| `apps/api` | `npm run check`                                                     |
| `apps/ios` | `xcodegen generate`, then `xcodebuild` (see `apps/ios/AGENTS.md`)   |
