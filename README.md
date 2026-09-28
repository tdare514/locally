# Locally

Locally imports audio files, tags them (cover, artist, album, year, genre, track numbers) and
delivers them to the folder Spotify's Local Files feature reads, on a Mac and on an iPhone, with
an optional sync service that mirrors the two libraries.

Spotify's public API has no upload endpoint, so writing tags directly into local files is the
only way to add cover art and metadata that Spotify will recognize. Non-mp3 formats are
automatically converted to 320 kbps mp3, since Spotify's Local Files feature only reads mp3 and
mp4 locally.

## Apps

| App | What it is |
|-----|------------|
| [`apps/web`](apps/web/AGENTS.md) | Mac/desktop app (Next.js, local-only server on 127.0.0.1). Import mp3/wav/flac/m4a, ID3v2 tagging, cover art, release edit in place. |
| [`apps/ios`](apps/ios/AGENTS.md) | iPhone companion (SwiftUI, XcodeGen). Onboarding picks the Spotify Local Files folder, single/album import, edit in place, share extension ("Send to Locally"). |
| [`apps/api`](apps/api/README.md) | Hosted sync service (Next.js, API routes only): email-code accounts, device tokens, versioned releases. Contract in [`spec/sync.md`](spec/sync.md). |

## Run the Mac app

### Requirements

- Node.js 20+
- ffmpeg on PATH (install with `brew install ffmpeg` on macOS)
- Spotify desktop app
- A folder for your library (default: `~/Music/Spotify Local Import`)

### Run

```bash
cd apps/web && npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Run the iOS app

```bash
cd apps/ios && xcodegen generate && open Locally.xcodeproj
```

See [`apps/ios/README.md`](apps/ios/README.md) for device and share-extension notes.

## Run the sync service

```bash
cd apps/api && npm install && npm run dev
```

Runs on port 4000. See [`apps/api/.env.example`](apps/api/.env.example) for the environment
variables it reads.

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

## Repository layout

```
apps/            # web, ios, api — see each app's README/AGENTS.md
spec/            # metadata.md (release/track/tag model), sync.md (sync contract)
docs/            # adr/ (decisions), design.md (shared design tokens),
                 # web-plan.md, ios-plan.md (product plans), plans/ (cross-app feature plans),
                 # research/ (background research notes, e.g. playlists)
scripts/         # make-app-icons.py, make-listener-icons.py, make-brand-marks.py render the
                 # icon/brand assets and need Python 3 plus librsvg's rsvg-convert
                 # (brew install librsvg); make-fixtures.sh builds test fixtures
fixtures/        # git-ignored, built by scripts/make-fixtures.sh
STATUS.md        # where the project is now
AGENTS.md        # monorepo map and working rules
SECURITY.md      # threat model and mitigations
CONTRIBUTING.md
LICENSE          # all rights reserved; viewing only
```

## Checks

- `apps/web`: `npm run check`
- `apps/api`: `npm run check`
- `apps/ios`: `xcodegen generate`, then `xcodebuild` (see `apps/ios/AGENTS.md`)

CI runs the same checks on every push and pull request — see `.github/workflows/`.
