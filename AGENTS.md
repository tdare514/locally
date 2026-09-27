# Agent briefing — Spotify Local Import

## What this is

A local-only Next.js app that imports audio files, tags them with ID3v2 metadata
(converting non-mp3 to 320k mp3 via ffmpeg), and stores them in a library folder that
Spotify's "Show Local Files" feature can read. See `docs/web-plan.md` for the full product spec
and API contract.

## Repo layout

```
apps/web/   # the Mac/desktop web app (Next.js); paths in the map below are relative to it
apps/ios/   # the iOS companion app (SwiftUI, XcodeGen project); plan in docs/ios-plan.md
apps/api/   # the hosted sync service (Next.js, API-only); see apps/api/README.md and spec/sync.md
docs/       # ADRs and product plans (web-plan.md, ios-plan.md)
spec/       # metadata model shared by both apps, and the sync service contract (sync.md)
scripts/    # make-fixtures.sh: test audio and covers into ./fixtures
```

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
  fs/
    FileSystem.ts             # interface wrapping disk I/O (save, move, mkdirp, isInside, ...)
    NodeFileSystem.ts         # node:fs implementation
  http/
    responses.ts              # errorResponse/badRequest
    validation.ts             # upload limits, mime sniffing, request → validated DTO parsers
  container.ts                # getServices(): builds and memoises the singletons above
src/app/api/**/route.ts   # thin HTTP handlers: parse via http/validation, call a service, respond
src/proxy.ts              # loopback-only + same-origin CSRF guard (Next middleware)
src/lib/api-client.ts     # client-side typed fetch wrappers (imports src/shared/types)
src/components/**         # UI, unaffected by this architecture
tests/unit/**             # vitest; fakes for every interface above, no real disk/network/ffmpeg
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
- **Tests never touch real user directories.** No test may read/write `~/.spotify-local-import` or
  `~/Music`; use `os.tmpdir()` and an in-memory `SettingsStore` fake.

## Running checks

```bash
npm run check   # tsc --noEmit && eslint && vitest run
```

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
