# Agent briefing — Locally web app (apps/web)

## What this is

The Mac/desktop app of the Locally monorepo: a local-only Next.js app that imports audio files,
tags them with ID3v2 metadata (converting non-mp3 to 320k mp3 via ffmpeg), and stores them in a
library folder that Spotify's "Show Local Files" feature can read. See `docs/web-plan.md` for the
full product spec and API contract, and the root `AGENTS.md` for the monorepo map and global
invariants. Paths below are relative to `apps/web`.

## Architecture map (apps/web)

```
src/shared/            # imported by both client and server; NO node imports
  types.ts             # API/DB shapes shared by client and server
  errors.ts            # ValidationError, NotFoundError, PublicError
src/server/
  config/
    SettingsStore.ts        # interface: get()/set() app settings
    FileSettingsStore.ts    # JSON-file impl (~/.spotify-local-import/settings.json)
    paths.ts                # default library dir, settings file path helpers
    settingsUpdate.ts       # PUT /api/settings policy: libraryDir rules, dismissed-flag and sync-state resets
    settingsView.ts         # projects server-internal Settings down to safe client response
  storage/
    LibraryRepository.ts     # interface: list/find/upsert/remove, scoped to a libraryDir
    JsonLibraryRepository.ts # library.json impl: per-dir mutex, atomic tmp+rename write
  audio/
    AudioConverter.ts        # interface: toMp3(input, output)
    FfmpegConverter.ts       # shells out to ffmpeg (argv array, never a shell string)
    TagService.ts            # interface: write(path, tags) / read(path)
    Id3TagService.ts         # node-id3 (write) + music-metadata (read)
  releases/
    ReleaseLayout.ts          # pure: sanitizeSegment, folderFor, trackFileName, coverFileName
    ReleaseService.ts         # import/update/replaceCover/delete/get/list — the core domain logic
    InspectService.ts         # POST /api/inspect: read tags off uploads without storing them
    ReleaseSyncHooks.ts       # interface: post-mutation callbacks so SyncEngine can push; wired via setSyncHooks()
  fs/
    FileSystem.ts             # interface wrapping disk I/O (save, move, mkdirp, isInside, ...)
    NodeFileSystem.ts         # node:fs implementation
  sync/
    SyncApi.ts                # interface + HttpSyncApi: sign-in code/verify, list/push records, upload files
    SyncEngine.ts             # reconcile loop, push local changes, accept "From your phone" releases
    SyncRecord.ts             # zod schema for the wire record, plain-name + extension guards, to/fromSyncRecord
    SyncState.ts              # SyncState + SyncStateStore interface: pushed/uploaded/pending bookkeeping
    FileSyncStateStore.ts     # JSON-file impl (sync-state.json next to settings.json), zod-validated
  http/
    responses.ts              # errorResponse/badRequest
    validation.ts             # upload limits, mime sniffing, zod schemas: request → validated DTO parsers
  container.ts                # getServices(): builds and memoises the singletons above
src/app/api/**/route.ts   # thin HTTP handlers: parse via http/validation, call a service, respond
src/app/api/sync/**/route.ts  # sync: code/verify/status/signout, reconcile, accept/[id]
electron/                 # Mac desktop shell (Electron); compiled by tsconfig.electron.json to electron/dist
  main.ts                 # spawns the Next standalone server on a free 127.0.0.1 port, opens one window, locks navigation
  lib/freePort.ts         # findFreePort() on 127.0.0.1
  lib/serverEnv.ts        # pure: env for the server child (HOSTNAME forced to 127.0.0.1, PORT, config dir, ffmpeg, PATH)
  lib/migrateConfig.ts    # pure: first-launch copy of ~/.spotify-local-import config into Application Support
  lib/waitForServer.ts    # polls the server URL until it answers or the child dies
  lib/update-manifest.ts  # pure: verifies the Ed25519-signed update envelope and validates the manifest (#71)
  lib/updater.ts          # update check, SHA-256-verified download, ditto unzip, bundle swap; app-menu "Check for Updates…"
  lib/updateConfig.ts     # pinned manifest URL, public key, bundle id (empty = updater disabled)
scripts/prepare-standalone.mjs  # copies public and .next/static into .next/standalone after the desktop build
scripts/after-pack.mjs    # electron-builder hook: copies the standalone node_modules into the app bundle
scripts/build-ffmpeg.sh   # builds a static LGPL ffmpeg (+ libmp3lame) from pinned sources into electron/vendor/ (ADR 0006)
scripts/check-ffmpeg.mjs  # desktop:package preflight: fails unless the vendored ffmpeg for this arch exists
scripts/publish-desktop.mjs  # owner-run: zips Locally.app, uploads to Blob, signs and uploads desktop/latest.json (#71)
scripts/desktop-keygen.mjs   # owner-run once: creates the Ed25519 update-signing key under ~/.config/locally
electron/build/licenses/  # committed LGPL/licence texts and SOURCES.md; shipped as Resources/licenses
electron/vendor/          # git-ignored: the built ffmpeg binary, per uname -m arch
src/proxy.ts              # loopback-only + same-origin CSRF guard (Next middleware)
src/lib/api-client.ts     # client-side typed fetch wrappers (imports src/shared/types)
src/lib/crop-geometry.ts  # pure: square/original crop geometry, mirrors iOS ImageCropper.swift
src/lib/crop-image.ts     # crops and downscales image files, respects EXIF orientation
src/components/**         # UI, unaffected by this architecture
tests/unit/**             # vitest; fakes for every interface above, no real disk/network/ffmpeg
tests/unit/routes/**      # route handlers called directly with a mocked getServices()
```

## Non-negotiable rules

- **Never write outside the library dir.** Every path derived from user input (artist/album/track
  names, the `reveal` path, cover filenames) is sanitised through `ReleaseLayout` and checked with
  `FileSystem.isInside` before any write or delete.
- **Every user-derived path goes through `ReleaseLayout`/`isInside`.** Don't hand-roll path joining
  or sanitisation elsewhere — route new cases through those two.
- **Loopback-only server.** `src/proxy.ts` rejects non-loopback `Host` headers and cross-origin
  mutating requests. Don't relax this without updating `SECURITY.md`.
- **No shell-string process spawning.** `ffmpeg`/`open` are invoked with `spawn`/`execFile` and
  argument arrays, never a shell string built from user input.
- **Desktop shell.** `electron/` must keep the server's `HOSTNAME=127.0.0.1` (the standalone server
  defaults to 0.0.0.0; ADR 0003 forbids that) and must not add a place to write beyond the app's
  config dir. It runs the standalone build only, with no custom Next server and no path logic.
- **Bundled ffmpeg stays LGPL.** Build it with `--disable-gpl --disable-nonfree`, pinned by
  checksum in `scripts/build-ffmpeg.sh`. A version bump updates `electron/build/licenses/SOURCES.md`
  and ADR 0006.
- **Tests never touch real user directories.** No test may read/write `~/.spotify-local-import` or
  `~/Music`; use `os.tmpdir()` and an in-memory `SettingsStore` fake.

## Running checks

```bash
npm run check   # next typegen && tsc --noEmit && eslint && vitest run
```

### Building the desktop app

```bash
npm run desktop:build    # LOCALLY_DESKTOP_BUILD=1 next build + prepare-standalone + tsc for electron/
npm run desktop          # run the built shell (needs desktop:build first)
npm run desktop:dev      # shell against `npm run dev` on 127.0.0.1:3000 (start dev in another terminal)
npm run desktop:package  # unsigned dist-desktop/mac-*/Locally.app via electron-builder
```

`LOCALLY_DESKTOP_SMOKE=1 LOCALLY_DESKTOP_USER_DATA=$(mktemp -d) electron electron/dist/main.js`
prints `smoke-ok <url> <title>` and exits. Always pass the `LOCALLY_DESKTOP_USER_DATA` override for
smoke and manual runs: without it the shell uses `~/Library/Application Support/Locally` and copies
the real `~/.spotify-local-import` config into it on first launch.

## Adding a new storage backend or converter

1. Implement the relevant interface (`LibraryRepository`, `AudioConverter`, `TagService`,
   `FileSystem`, or `SettingsStore`) in its own file next to the existing implementation.
2. Wire it up in `src/server/container.ts` (`buildServices()`), swapping the constructor call.
3. Nothing else changes — `ReleaseService`/`InspectService`/route handlers depend only on the
   interfaces, not the concrete classes.
4. Add a unit test for the new implementation under `tests/unit/`, following the pattern in
   `tests/unit/JsonLibraryRepository.test.ts` (real temp dir, no mocking of the class under test).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
