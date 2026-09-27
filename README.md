# Spotify Local Import

A companion web app for managing local audio files with metadata that Spotify's Local Files feature can read. Import audio files (mp3, wav, flac, m4a), add cover art, artist, album, year, and genre information, and organize them as Singles or Albums. The app writes metadata directly into the files as ID3v2 tags and stores them in a library folder. Point Spotify's "Show Local Files" feature at that folder, and your music appears in Spotify with all the metadata you entered—just like Apple Music's local import.

Spotify's public API has no upload endpoint, so this desktop companion is the only way to add cover art and metadata to local files that Spotify will recognize. Non-mp3 formats are automatically converted to 320 kbps mp3, since Spotify's Local Files feature only reads mp3 and mp4 locally.

This is a monorepo: `apps/web` (below) is the Mac/desktop app, `apps/ios` is the
iOS companion, and `apps/api` is the hosted sync service that lets the two
mirror each other's libraries — see `apps/api/README.md` and `spec/sync.md`.

## Requirements

- Node.js 20+
- ffmpeg on PATH (install with `brew install ffmpeg` on macOS)
- Spotify desktop app
- A folder for your library (default: `~/Music/Spotify Local Import`)

## Run

```bash
cd apps/web && npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Connect to Spotify

1. **Spotify Settings**: Open Spotify → Settings → Library
2. **Enable Local Files**: Turn on "Show Local Files"
3. **Add Source**: Click "Add a source" and choose the library folder (default `~/Music/Spotify Local Import`)
4. **Refresh**: The "Local Files" playlist appears under Your Library; Spotify scans the folder for mp3 files with embedded metadata

> **Note**: Spotify caches local-file metadata. After editing an already-imported track's tags, restart Spotify to see the changes.

## Limitations

- **Format conversion**: Spotify only reads mp3 locally, so non-mp3 files are converted to 320 kbps mp3. mp3 files are copied without re-encoding.
- **Metadata cache**: Restart Spotify after editing tags in an existing track for changes to appear.
- **Playback on one device**: Local files only play on the device holding the audio files. To listen on other devices, use Spotify's own local-files-on-mobile sync flow.
- **Finder integration**: The "Show in Finder" feature is macOS-only.

## Project Layout

```
src/shared/            # types + error classes shared by client and server
src/server/
  config/              # SettingsStore interface + JSON-file implementation
  storage/              # LibraryRepository interface + JSON-file implementation
  audio/                # AudioConverter (ffmpeg) and TagService (ID3) interfaces + implementations
  releases/              # ReleaseLayout (pure path rules), ReleaseService, InspectService
  fs/                    # FileSystem interface + node:fs implementation
  http/                  # error responses, upload validation, request → DTO parsing
  container.ts           # builds and memoises the service singletons
src/app/api/**/route.ts # thin HTTP handlers built on the services above
src/proxy.ts            # loopback-only + CSRF guard (Next middleware)
src/lib/api-client.ts   # client-side typed fetch wrappers
src/components/         # reusable React UI components
tests/unit/             # vitest unit tests, no real disk/network/ffmpeg
docs/adr/               # architecture decision records
```

See `AGENTS.md` for the full architecture map and the project's non-negotiable rules.
