# Spotify Local Import — build plan

## What this is
A local companion app (Next.js, runs on localhost) that lets a user import audio files
(mp3/wav/flac/m4a/...), attach a cover photo, artist, album, year, genre, and organise them
as **Singles** (one file) or **Albums** (many files sharing one cover). The app writes the
metadata *into the files* as ID3v2 tags (converting non-mp3 to 320k mp3 with ffmpeg, because
Spotify's Local Files only reads mp3/mp4) and stores them in a library folder. The user points
Spotify → Settings → Library → "Show Local Files" → "Add a source" at that folder, and Spotify
shows the art/artist/album exactly as entered. Spotify's public API has no upload endpoint, so
this is the only mechanism that works; it mirrors how Apple Music's local import behaves.

## Conventions
- Next.js 16 App Router, TypeScript, Tailwind v4. `src/` dir. No import alias (use relative paths).
- Shared types live in `src/lib/types.ts` — import from there, never redeclare.
- Default library dir: `~/Music/Spotify Local Import`. Configurable via settings, persisted in
  `~/.spotify-local-import/settings.json`. Library index persisted at `<libraryDir>/library.json`.
- Files laid out as `<libraryDir>/<Artist>/<Album>/<NN> - <Title>.mp3` plus `cover.jpg` in the album folder.
  Sanitise path segments (strip `/ \ : * ? " < > |`, trim, fall back to "Unknown").
- Tagging: `node-id3` (`NodeID3.write` / `NodeID3.update`) with tags: title, artist, performerInfo (album artist),
  album, year, genre, trackNumber ("N/TOTAL"), image (APIC, type 3 "front cover", mime from file).
- Reading existing tags to prefill: `music-metadata` (`parseFile`).
- Conversion: spawn `ffmpeg` (use system `ffmpeg` on PATH; error clearly if missing):
  `ffmpeg -y -i in -vn -codec:a libmp3lame -b:a 320k out.mp3`. mp3 inputs are copied, not re-encoded.
- Cover art: resized/normalised is NOT required; accept jpg/png as-is (max 10 MB).
- Always run server-side file work in route handlers with `export const runtime = "nodejs"`.

## API (all JSON unless noted)
- `GET  /api/settings` → `Settings`
- `PUT  /api/settings` body `{ libraryDir }` → `Settings` (creates folder; migrates nothing)
- `GET  /api/library` → `Library`
- `POST /api/import` multipart: `meta` (JSON `ImportMeta`), `cover` (optional image), `audio` (1..n files, order = meta.tracks) → `Release`
- `POST /api/inspect` multipart: `audio` (1..n) → `{ files: { name, title, artist, album, year, genre, durationSec, hasCover }[] }` (prefill from existing tags; do not store anything)
- `GET  /api/releases/[id]` → `Release`
- `PATCH /api/releases/[id]` body `UpdateReleaseMeta` → `Release` (rewrites tags in every track; renames files/folders if artist/album/title changed)
- `PUT  /api/releases/[id]/cover` multipart `cover` → `Release` (replaces cover.jpg and re-embeds APIC in all tracks)
- `DELETE /api/releases/[id]` → `{ ok: true }` (deletes the release folder + index entry)
- `GET  /api/releases/[id]/cover` → image bytes (404 if none)
- `POST /api/reveal` body `{ path? }` → `{ ok: true }` runs `open -R <path>` (macOS) to show in Finder; defaults to libraryDir
- Errors: non-2xx with `{ error: string }`.

## UI (single page app at `/`)
Spotify-like dark theme (#121212 bg, #1DB954 accent, Inter/system font). Layout:
- Left sidebar: "Library" (list of releases with cover thumb, title, artist, kind badge), "+ Import" button, "Settings" button.
- Main: 
  - **Import view**: segmented control `Single | Album`. Drop zone / file picker for audio.
    Single: exactly one file. Album: many; sortable list with per-track title + number.
    Cover picker with preview (square). Fields: Title (album), Artist, Year, Genre.
    On file drop call `/api/inspect` to prefill from existing tags. "Import to Spotify" submit → POST /api/import → navigates to release view.
  - **Release view**: big cover, editable fields, track list (editable titles, reorder), Replace cover, Delete, "Show in Finder".
    Saving calls PATCH; cover replacement calls PUT cover.
  - **Settings / Connect to Spotify panel**: shows library folder path (editable), and a 4-step
    checklist: open Spotify → Settings → Library → enable "Show Local Files" → "Add a source" → pick this folder.
    Note: Spotify caches local-file metadata; after editing an existing track, restart Spotify to see changes.
- Client components only where interactivity is needed. Keep state in React; no extra libraries.

## Work split
- Agent "backend": `src/lib/{paths,settings,library,tags,convert,fsutil}.ts` + all `src/app/api/**/route.ts`.
- Agent "frontend": `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, `src/components/**`, `src/lib/api-client.ts`.
- Agent "docs": `README.md`, `.claude/launch.json`, `.gitignore` additions, `scripts/make-fixtures.sh` (ffmpeg-generated test tones).
- Reviewer (Fable): integration test in browser, fixes.
