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
- Sync client: email-code sign-in, push, reconcile, "From your phone"
- One-time "Spotify can't see this yet" prompt on the release page: copy path, open Spotify settings, dismiss; hidden once Spotify's local-files index lists the library folder

### iOS (apps/ios)
- Onboarding picks the Spotify Local Files folder via a security-scoped bookmark
- Single and album import, edit in place, delete
- Cover thumbnails kept in the app's own Application Support directory
- Share extension ("Send to Locally") with an app-group inbox, plus a Documents-folder inbox
- StoreKit one-time purchase wired up but gates no feature yet
- Library is the home tab, split into Singles and Albums sections with counts
- Sync client: Keychain account, push, reconcile, "From your Mac"
- Share extension verified on an iPhone 12 Pro (iOS 18.7) and sync verified end to end on a phone, both 27 Sep 2026

### Sync API (apps/api)
- Email-code accounts, device tokens, versioned releases with last-writer-wins
- Quota enforcement and signed, expiring file URLs (local store and Vercel Blob)
- Rate limiting, CORS, daily cleanup cron
- SQLite (libSQL) via Drizzle, migrated automatically on first request
- Runs locally only; not deployed yet (#3)

## In progress
- Security hardening from the Sep 27 review: web origin check, zod validation, HTTPS-only sync, sign-out on base URL change, Keychain hardening and the iOS privacy manifest landed (#11 closed); the medium/low backlog remains (#12)
- Security review of apps/api (#20): findings fixed 28 Sep; the in-memory rate limiter is per instance, so the deploy (#3) needs a shared-store `RateLimiter` before going live
- Deploying apps/api to Vercel with libSQL, Blob and Resend behind the existing interfaces (#3)

## Known issues
- iOS crash in `SyncEngine.backfillUnpushed` when a delete overlaps the 30s reconcile loop; the delete is lost (#19)
- Share extension can't be provisioned for a device build on the project's Personal team; simulator-only for now (see apps/ios/README.md)
- App Store submission checklist still open: screenshots not captured
- Sync: a cover replaced on one device never updates on the other; plan in docs/plans/26-sync-cover-hash.md (#26)
- Spotify caches local-file metadata; restart Spotify to see edits to an already-imported track

## Next
- Guided "Make it a playlist" flow on both apps, option B from docs/research/playlists.md; plan in docs/plans/21-make-it-a-playlist.md (#21)
- Remaining iOS restructure items: on-device checks of the import silhouette and drag reorder (#6)
- Mac library development: search, sort, bulk actions, playlist-aware grouping; plan-only: conversion job queue, SQLite index, multi-library (#7)
- Repo health: CI workflows, an all-rights-reserved LICENSE and root-doc fixes landed; still open are the vitest .mts rename, apps/ios/README stale references, and the test gaps (#13)

## Architecture decisions
See docs/adr/. Product plans: docs/web-plan.md, docs/ios-plan.md. Sync contract: spec/sync.md.
