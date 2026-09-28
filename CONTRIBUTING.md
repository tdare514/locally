# Contributing

## Setup

```bash
cd apps/web && npm install
```

You'll also need `ffmpeg` on PATH (`brew install ffmpeg` on macOS) for real conversions;
tests fake it out, so it isn't required to run `npm run check`.

## Before you push

```bash
npm run check   # tsc --noEmit && eslint && vitest run
```

All three must pass with zero errors. `npm run build` should also succeed for anything
that touches routing, config, or the build pipeline.

## Where things go

See the architecture map in `apps/web/AGENTS.md`. In short:

- Pure domain logic with no I/O → `src/server/releases/ReleaseLayout.ts`.
- A new external dependency (storage, converter, tag reader) → define an interface next
  to its role (e.g. `src/server/audio/AudioConverter.ts`), implement it in a sibling file,
  and wire it into `src/server/container.ts`. Don't reach for the concrete class from a
  route handler or another service — depend on the interface.
- HTTP-shaped concerns (parsing multipart forms, status codes, upload limits) → `src/server/http/`.
- Route handlers (`src/app/api/**/route.ts`) should stay thin: parse the request via
  `http/validation.ts`, call `getServices().<something>`, return JSON, and let
  `errorResponse` translate thrown errors into status codes.
- Types shared between client and server → `src/shared/types.ts`. Never redeclare a shape
  that already exists there.

## Writing a test

Tests live under `tests/unit/` and run with vitest (`npm run test` or `npm run check`).

- Pure classes (like `ReleaseLayout`) need no setup — just call methods and assert.
- Anything backed by real disk (like `JsonLibraryRepository`) should use a fresh
  `fs.mkdtemp(path.join(os.tmpdir(), ...))` directory per test, cleaned up in `afterEach`.
  Never point a test at `~/.spotify-local-import` or `~/Music`.
- `ReleaseService` tests use fakes for every injected collaborator except the filesystem:
  an in-memory `LibraryRepository`, a `SettingsStore` fake constructed with a temp
  `libraryDir`, a converter that copies bytes instead of running ffmpeg, and a tag
  service that records calls instead of writing real ID3 frames. See
  `tests/unit/ReleaseService.test.ts` for the pattern to copy.
- Prefer asserting on behavior (files exist at the right path, a release's fields) over
  asserting on a fake's call log, except where the call log itself is what's being tested.
