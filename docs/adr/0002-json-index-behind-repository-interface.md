# 2. JSON index behind a `LibraryRepository` interface

## Status

Accepted.

## Context

The app needs an index of releases (id, metadata, track/file paths) separate from the
tagged audio files themselves, so it can list/find/delete releases without re-parsing
every mp3's ID3 tags on every request. This is a local single-user tool with, realistically,
a few hundred to a few thousand releases — not a scale problem yet.

## Decision

Store the index as a single `library.json` file inside the library directory
(`JsonLibraryRepository`), written atomically (temp file + rename) and serialized through
an in-process, per-directory mutex so overlapping API requests can't interleave a
read-modify-write and lose an update. All access goes through the `LibraryRepository`
interface (`list`/`find`/`upsert`/`remove`, each scoped to a `libraryDir`) rather than
`ReleaseService` touching `fs` or JSON directly.

JSON was chosen over SQLite (or another embedded DB) because:

- it needs zero new dependencies or native bindings,
- the whole index is small enough to read/write in one shot on every request without
  a noticeable cost, and
- it's trivially inspectable/editable by a user in a text editor if something goes wrong.

## Consequences

- This does not scale well to concurrent multi-process access (e.g. two instances of the
  app pointed at the same library dir) — the mutex only protects within one Node process.
  That's an explicit non-goal for now.
- The swap point for a future SQLite (or other) backend is exactly one class:
  implement `LibraryRepository` (see `src/server/storage/LibraryRepository.ts`) and wire
  it into `src/server/container.ts`. `ReleaseService`, `InspectService`, and every route
  handler are unaffected because none of them import `JsonLibraryRepository` directly.
