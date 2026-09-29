# Status

Snapshot of now, not a changelog. Update this when a change makes it stale.
Git history holds the past.

Last updated: 2026-09-29

## Current focus
Mac library work (#7); the Sep 27 security backlog (#12) is closed on both apps. Mac packaging (#35): the Electron shell is in as an unsigned developer build with an LGPL ffmpeg bundled (#69, ADR 0006); signing and notarisation (#70) and auto-update (#71) follow. One #36 point is decided and planned: before anyone else can sign up, the terms must say the user may upload only audio they own, or otherwise have the right to upload (ADR 0005, `docs/plans/36-own-the-audio.md`). Still owner decisions on #36: the privacy-policy URL and full privacy text, a takedown contact, whether the 30-day unused-blob cleanup is the retention policy, and whether first sign-ups are invite-only. Agent-readiness (#22–#25) and repo health (#13) are done; async email/deletes (#31) and the iOS import silhouette/reorder code (#6) landed.

## What works
### Web (apps/web)
- Import mp3/wav/flac/m4a; non-mp3 converted to 320k mp3 via ffmpeg
- ID3v2 tagging, cover art with a square/original crop dialog
- Release edit in place: tracks are re-tagged, never renamed, so Spotify playlists keep the track
- Delete, reveal in Finder, settings
- Import and update requests validated with zod; every write checked inside the library dir
- Loopback-only server (127.0.0.1) with a full-origin CSRF check
- Sync client: email-code sign-in, push, reconcile, "From your phone"; a cover replaced on either device follows via the record's coverHash (#26)
- "Delete sync account…" in Settings deletes the cloud account after a confirm and signs this Mac out; music files stay (#34)
- Guided "Make it a playlist" disclosure on album release pages: Copy button for the title, per-track Mac steps and a fallback line; opens expanded on the page an album import lands on (#21)
- One-time "Spotify can't see this yet" prompt on the release page: copy path, open Spotify settings, dismiss; hidden once Spotify's local-files index lists the library folder
- Library is the home view: empty state mirrors iOS onboarding (diagram + Add your first single / Make an album); populated library splits Singles and Albums with counts in the main list and the sidebar (#7)
- Release page header is compact: a 112 cover thumb beside the kind badge, title, and artist, with the metadata fields below. Import puts a 120 cover beside title and artist, then year and genre (#7)
- Library search and sort (#7): a toolbar under "All music" filters by title, artist, genre, year, or track title (case- and accent-insensitive, every word must match; ⌘F focuses, Escape clears) and sorts by Recently updated, Title, Artist, or Year; the sidebar list follows the same query and sort, and both survive opening a release
- Library bulk actions (#7): Select on the library toolbar swaps in a selection bar; checked rows can be edited together (Artist, Year, Genre, blank leaves unchanged, tracks re-tagged in place) or deleted after an inline confirm. Both run per release through the existing endpoints and report partial failures by title in the toast
- Electron desktop shell (#35): `npm run desktop:package` produces an unsigned `dist-desktop/mac-arm64/Locally.app` that spawns the Next standalone server on a free 127.0.0.1 port (HOSTNAME forced, ADR 0003) and opens one locked-down window; config lives in `~/Library/Application Support/Locally`, copied once from `~/.spotify-local-import` with owner-only modes; ffmpeg is a static LGPL 2.1 build (ffmpeg 9.0.2 + LAME 3.100, ADR 0006) built once by `npm run desktop:ffmpeg` from checksum-pinned sources and shipped as `Resources/ffmpeg` with the licence texts in `Resources/licenses`; arm64 only so far. Smoke: `LOCALLY_DESKTOP_SMOKE=1` with a `LOCALLY_DESKTOP_USER_DATA` temp dir. Interim updater (#78, ADR 0007): a launch check (at most every 6 h) and Locally ▸ Check for Updates… read an Ed25519-signed manifest from Blob, verify the zip's SHA-256, and swap the bundle with rollback after a prompt; `npm run desktop:publish` releases (see `apps/web/README.md`)

### iOS (apps/ios)
- Onboarding picks the Spotify Local Files folder via a security-scoped bookmark
- Single and album import, edit in place, delete
- Cover thumbnails kept in the app's own Application Support directory
- Share extension ("Send to Locally") with an app-group inbox, plus a Documents-folder inbox
- StoreKit one-time purchase wired up but gates no feature yet
- Library is the home tab, split into Singles and Albums sections with counts
- Import Single/Album share one layout; empty Tracks uses `TrackListSilhouette` (1 or 3 rows);
  2+ tracks show a long-press reorder hint and `.onMove` without an Edit button (#6, #17)
- Sync client: Keychain account, push, reconcile, "From your Mac"; cover replacements follow via coverHash (#26)
- "Delete sync account…" in Settings (App Store 5.1.1(v)) deletes the cloud account and signs the phone out; sign-out and delete both clear per-release sync markers so a new account re-pushes everything (#34)
- Sync pushes and deletes queue in a persistent outbox, retried each reconcile until the server confirms; a delete during reconcile or offline is no longer lost (#19)
- Each release records which files the server holds, so a push retry after a partial failure uploads only what's missing and a cover replace re-uploads only the cover (#27)
- "Make it a playlist" guide on the album done screen and release page: Copy button for the title, per-track iPhone steps and a fallback line (#21)
- Share extension verified on an iPhone 12 Pro (iOS 18.7) and sync verified end to end on a phone, both 27 Sep 2026
- Security backlog (#12) closed: M4ATagWriter checks `replaceItemAt` and removes its temp export, ID3TagWriter guards the synchsafe size limit and streams audio, the share extension allow-lists audio extensions and the Inbox sweeps orphaned files
- Sync device name persists across relaunch and verify sends the model marketing name, e.g. "iPhone 14" (#38). A phone that signed in before this change keeps "iPhone" on the server until it signs out and back in; the model table covers through the iPhone 17 family and iPhone Air, with a note in `SyncDeviceName.swift` on extending it (#64)
- Web and iOS skip a pulled sync record whose track or cover extension the API would refuse, keep the rest of the page, and still fail the page on a structurally broken record; the shared `invalid-*` fixtures assert the refusal in all three apps (#39, web skip #60)
- Import silhouette and long-press drag reorder checked on an iPhone 14, 28 Sep 2026 (#6): empty album shows three faint rows, empty single shows one, both with "No tracks yet"; two or more tracks show "Hold and drag a track to reorder." with no Edit button, and a saved release-page order is still there after leaving and coming back

### Sync API (apps/api)
- Email-code accounts, device tokens, versioned releases (syncVersion 1 and 2) with last-writer-wins
- Quota enforcement and signed, expiring file URLs (local store and Vercel Blob)
- Rate limiting, CORS, daily cleanup cron
- Every response carries x-request-id; 4xx/5xx, rate-limit, quota and auth failures log one JSON line (request ID, route, status, duration, user ID); the daily cron logs total stored bytes, warning past STORAGE_ALERT_BYTES (#29)
- Device tokens expire after a year unused (the account itself never expires) (lastSeenAt refreshed at most daily); a cross-user test matrix shows another account gets 404 on every release, file and device route (#33)
- DELETE /v1/me deletes an account (email echoed as confirmation) in one transaction; its blobs are queued in pending_deletes and drained right after, with the daily cron as the guarantee (#34)
- Email send (`POST /v1/auth/code`) and release file prune (`PUT /v1/releases/:id`) run after the response via Next `after()`; blob deletes are batched with `FileStore.deleteMany` (#31)
- SQLite (libSQL) via Drizzle, migrated automatically on first request
- Release pulls are paged (#30): at most 200 releases or 2 MiB per `GET /v1/releases` page with `hasMore`; web and iOS loop until the last page, saving the cursor per page (100-page guard); `/v1/me` lists the 50 newest devices with `devicesHasMore`. Shipped clients stay correct and catch up over several reconciles
- Deployed to https://locally-sync-api.vercel.app (Vercel project locally-sync-api: Turso database, private Blob store, Resend); both clients default to it; smoke-tested end to end 28 Sep from a Mac and an iPhone 14: sign-in, push each way, tombstone (#3 closed). Resend still uses the sandbox sender, which only delivers to the owner's address: verify a domain and set MAIL_FROM before anyone else signs up (#58, `launch` label)

## In progress
- Security review of apps/api (#20): findings fixed 28 Sep; auth rate limits now live in the shared libSQL database, so they hold across Vercel instances
- Sync API operations: the Vercel project's ignored-build-step cancels `vercel redeploy`, so an env change needs a push touching apps/api or `vercel deploy --prod --archive=tgz` from a repo root linked to locally-sync-api. The skip rule fails open since #57: if the last deployed commit is missing from Vercel's shallow clone the build goes ahead instead of erroring

## Known issues
- Share extension can't be provisioned for a device build on the project's Personal team; simulator-only for now (see apps/ios/README.md)
- App Store submission checklist still open: screenshots not captured
- Spotify caches local-file metadata; restart Spotify to see edits to an already-imported track

## Next
- Follow-ups from the 29 Sep review of the Cursor PRs (#41–#55): web pull-page skip (#60), device-name backfill guard (#62); owner decision on the Inbox sweep and import allow-list (#65)
- Mac library development: search, sort, and bulk actions landed; playlist-aware grouping next; plan-only: conversion job queue, SQLite index, multi-library (#7)
- Mac packaging (#35, ADR 0004): `npm run desktop:package` in `apps/web` builds an unsigned `Locally.app` around the Next standalone server. ffmpeg is bundled as an LGPL build (#69, ADR 0006). Still to do: Developer ID signing and notarisation (#70, owner action, before the 1 Nov public demo), switching on the interim updater (#78: built, but off until the owner creates the public `locally-releases` Blob store, runs `npm run desktop:keygen` and fills `electron/lib/updateConfig.ts`; `electron-updater` replaces it after #70, #71), an Intel build of ffmpeg. Until #70 only the developer can open it. On #36 the rights clause is decided (ADR 0005) and the sign-up acknowledgement is planned; the privacy policy, takedown contact, retention statement, and invite-only question remain owner decisions. Sign-ups stay closed

## Architecture decisions
See docs/adr/. ADR 0005 records the sync rights clause (#36). Product plans: docs/web-plan.md, docs/ios-plan.md. Sync contract: spec/sync.md.
