# Status

Snapshot of now, not a changelog. Update this when a change makes it stale.
Git history holds the past.

Last updated: 2026-09-28

## Current focus
Hardening from the Sep 27 security review across web, iOS and the new sync API, then deploying the API so both clients sync against a real URL. Repo-health and agent-readiness gaps (#13, #22 to #25) are being closed alongside.

## What works
### Web (apps/web)
- Import mp3/wav/flac/m4a; non-mp3 converted to 320k mp3 via ffmpeg
- ID3v2 tagging, cover art with a square/original crop dialog
- Release edit in place: tracks are re-tagged, never renamed, so Spotify playlists keep the track
- Delete, reveal in Finder, settings
- Import and update requests validated with zod; every write checked inside the library dir
- Loopback-only server (127.0.0.1) with a full-origin CSRF check
- Sync client: email-code sign-in, push, reconcile, "From your phone"; a cover replaced on either device follows via the record's coverHash (#26)
- Guided "Make it a playlist" disclosure on album release pages: Copy button for the title, per-track Mac steps and a fallback line; opens expanded on the page an album import lands on (#21)
- One-time "Spotify can't see this yet" prompt on the release page: copy path, open Spotify settings, dismiss; hidden once Spotify's local-files index lists the library folder

### iOS (apps/ios)
- Onboarding picks the Spotify Local Files folder via a security-scoped bookmark
- Single and album import, edit in place, delete
- Cover thumbnails kept in the app's own Application Support directory
- Share extension ("Send to Locally") with an app-group inbox, plus a Documents-folder inbox
- StoreKit one-time purchase wired up but gates no feature yet
- Library is the home tab, split into Singles and Albums sections with counts
- Sync client: Keychain account, push, reconcile, "From your Mac"; cover replacements follow via coverHash (#26)
- Sync pushes and deletes queue in a persistent outbox, retried each reconcile until the server confirms; a delete during reconcile or offline is no longer lost (#19)
- "Make it a playlist" guide on the album done screen and release page: Copy button for the title, per-track iPhone steps and a fallback line (#21)
- Share extension verified on an iPhone 12 Pro (iOS 18.7) and sync verified end to end on a phone, both 27 Sep 2026

### Sync API (apps/api)
- Email-code accounts, device tokens, versioned releases (syncVersion 1 and 2) with last-writer-wins
- Quota enforcement and signed, expiring file URLs (local store and Vercel Blob)
- Rate limiting, CORS, daily cleanup cron
- SQLite (libSQL) via Drizzle, migrated automatically on first request
- Deployed to https://locally-sync-api.vercel.app (Vercel project locally-sync-api: Turso database, private Blob store); fails closed until the Resend key is set (#3)

## In progress
- Security hardening from the Sep 27 review: web origin check, zod validation, HTTPS-only sync, sign-out on base URL change, Keychain hardening and the iOS privacy manifest landed (#11 closed); the medium/low backlog is done on web (symlink-aware inside checks, index schema, ffmpeg watchdog, settings file perms, decoded CSRF path); its iOS items remain (#12)
- Security review of apps/api (#20): findings fixed 28 Sep; auth rate limits now live in the shared libSQL database, so they hold across Vercel instances
- Deploying apps/api to Vercel with libSQL, Blob and Resend behind the existing interfaces (#3): live; waiting on RESEND_API_KEY and MAIL_FROM, then point both clients at the URL and smoke-test

## Known issues
- Share extension can't be provisioned for a device build on the project's Personal team; simulator-only for now (see apps/ios/README.md)
- App Store submission checklist still open: screenshots not captured
- Spotify caches local-file metadata; restart Spotify to see edits to an already-imported track

## Next
- Remaining iOS restructure items: on-device checks of the import silhouette and drag reorder (#6)
- Mac library development: search, sort, bulk actions, playlist-aware grouping; plan-only: conversion job queue, SQLite index, multi-library (#7)
- Architecture review for multiple users (docs/reviews/2026-09-28-architecture.md): atomic sync version #28 first, then API observability #29, token expiry #33, async email and deletes #31; plans written for pagination (#30, docs/plans/30-sync-pagination.md) and account deletion (#34, docs/plans/34-account-deletion.md), both to implement after the iOS sync lane and #3; owner decisions on Mac packaging #35 and privacy/terms #36
- Repo health: CI workflows, an all-rights-reserved LICENSE and root-doc fixes landed; still open are the vitest .mts rename, apps/ios/README stale references, and the test gaps (#13)

## Architecture decisions
See docs/adr/. Product plans: docs/web-plan.md, docs/ios-plan.md. Sync contract: spec/sync.md.
