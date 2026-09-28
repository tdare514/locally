# Architecture review, 28 Sep 2026

A review of all three apps against eight questions: bottlenecks at 10× and 100× users, coupling,
unobservable failures, untested behaviour, missing trust boundaries, context agents keep
rediscovering, work that should be asynchronous, and compounding debt. It assumes **many
independent users**, not just the owner. Each finding links to the issue that owns it; this
document is a snapshot, and the issues are the source of truth.

Written against `origin/main` at `23bcdc8` (the API is live on Vercel and waiting on Resend; the
shared libSQL rate limiter has landed; #26 steps 1 and 2 have landed).

## What is already sound

- **API:** thin route handlers over a service layer, with `FileStore`, `Mailer` and `RateLimiter`
  interfaces wired only in `container.ts`. Tokens and codes are stored hashed with a pepper; code
  attempts are capped and rate limited. Signed file URLs expire after 5 minutes and uploads go
  straight to Blob, not through the function. The indexes match the current query shapes.
- **Web:** thin routes; logic sits in `ReleaseService` and `ReleaseLayout` behind `FileSystem` and
  `LibraryRepository`. Path containment runs before every write, and processes are spawned with
  argument arrays. The origin check is enforced in `proxy.ts`.
- **Repo:** CI builds and tests all three apps (iOS on macOS runners), path-filtered to each app
  and `spec/**`.

## Findings

Ranked by risk. "Lane" is the set of files an issue collides with, which sets the run order.

| # | Finding | Lane | Issue |
|---|---------|------|-------|
| 1 | The sync version counter is read and written in two steps, with no transaction anywhere in `apps/api/src`. Concurrent pushes can share a version, and a client can skip one release for good. | API | #28 |
| 2 | An iOS delete is started in the background and never retried or saved to disk; racing reconcile makes it crash and lose the delete. Needs a persistent outbox, actor isolation, and the reconcile loop moved out of `RootView`. | iOS sync | #19 (comment) |
| 3 | No request IDs or structured logs; a 500 can't be matched to a log line. Rate-limit and quota rejections aren't logged. There are no global storage or egress alerts. | API | #29 |
| 4 | Device tokens never expire. Cross-user isolation is tested for releases only, not for files, signed URLs or devices. | API | #33 |
| 5 | Users can't delete their account. This is a privacy gap for multiple users, and App Store 5.1.1(v) requires it once iOS sync ships. | Cross-app (plan first) | #34 |
| 6 | `listSince` and `listDevices` have no page limit. | Cross-app (plan first) | #30 |
| 7 | Sending the sign-in email and deleting blobs run inside requests; cleanup deletes files one round trip at a time. | API | #31 |
| 8 | The sync record is defined by hand in three places with nothing checking them against the spec. | spec + all tests | #32 |
| 9 | The Mac app installs only for a developer (`npm run dev`, `brew install ffmpeg`). | Owner decision | #35 |
| 10 | Hosting other people's audio and emails needs a privacy policy, terms, a takedown contact and a retention policy before sign-ups open. | Owner decision | #36 |
| 11 | `library.json` is read and rewritten whole on every list and edit; ffmpeg converts tracks one by one inside the import request. Fine at hundreds of releases, slow near 5,000. | Web library | #7 (comment) |
| 12 | Web has no route-level tests for import, library or releases, and none for sync retry or conflicts. | Web tests | #13 (comment) |
| 13 | Some web routes validate input by hand instead of with zod. | Web server | #12 (comment) |

## Recommended order

Issues in the same lane run one after another; different lanes can run at the same time.

- **API lane:** #28 → #29 → #33 → #31. #28 should land before the smoke test with real devices
  (#3).
- **iOS sync lane:** #19 (with the outbox) → #27 → the rest of #26. Then #30 and #34
  implementation, which also touch this code.
- **Web lane:** #12 → the web test gaps in #13.
- **Plans only (safe in parallel with everything):** #30 and #34, written into `docs/plans/`.
- **After #26 is finished:** #32 (contract fixtures).
- **Owner decisions, not sessions:** #35 and #36. #36 gates opening sign-ups.
- **Not startable:** #7 (brief to come) and #6 (needs a physical device).

## Context to stop rediscovering

#28 adds the sync invariants to `apps/api/AGENTS.md`: versions are unique per user, a pull returns
everything above the cursor, a tombstone is re-sent until the server confirms it, and any
multi-step write goes in a transaction.
