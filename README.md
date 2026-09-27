# Spotify Local Import

A companion web app for managing local audio files with metadata that Spotify's Local Files feature can read. Import audio files (mp3, wav, flac, m4a), add cover art, artist, album, year, and genre information, and organize them as Singles or Albums. The app writes metadata directly into the files as ID3v2 tags and stores them in a library folder. Point Spotify's "Show Local Files" feature at that folder, and your music appears in Spotify with all the metadata you entered—just like Apple Music's local import.

Spotify's public API has no upload endpoint, so this desktop companion is the only way to add cover art and metadata to local files that Spotify will recognize. Non-mp3 formats are automatically converted to 320 kbps mp3, since Spotify's Local Files feature only reads mp3 and mp4 locally.

## Requirements

- Node.js 20+
- ffmpeg on PATH (install with `brew install ffmpeg` on macOS)
- Spotify desktop app
- A folder for your library (default: `~/Music/Spotify Local Import`)

## Run

```bash
npm install
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

- `src/app/api/` — API route handlers (import, settings, library, releases, cover management)
- `src/lib/` — Server-side logic (file paths, settings, library index, metadata tags, audio conversion, file utilities)
- `src/components/` — Reusable React UI components
- `src/app/` — Layout, main page, and global styles
