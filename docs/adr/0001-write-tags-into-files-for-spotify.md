# 1. Write tags into files, rather than using an upload API

## Status

Accepted.

## Context

We want Spotify to show a user's own audio files with the artist, album, cover art,
and track order they choose — even though those files aren't on Spotify's servers.

## Decision

Spotify's public Web API has no endpoint to upload or attach metadata to arbitrary
audio files. The only integration point is "Local Files": Spotify's desktop client scans
a folder the user points it at and reads whatever ID3v2 tags (and embedded APIC cover
art) are already in each file. So instead of talking to an API, this app:

- writes tags directly into the audio files themselves (`node-id3`), and
- converts anything that isn't mp3 to 320kbps mp3 first, because Spotify's Local Files
  scanner only reads mp3/mp4 — a flac or wav file with perfect tags still won't show up.

This mirrors how Apple Music's "Local Files" import works, for the same reason: no
vendor API for this exists, so the file itself has to carry the metadata.

## Consequences

- The app must own a conversion step (ffmpeg) and a folder layout Spotify can be pointed
  at, not just a database of metadata.
- Editing metadata later means rewriting tags into the file in place (see `ReleaseService.update`),
  not just updating a row — and Spotify caches what it last read, so users may need to
  restart the client to see changes (documented in `docs/web-plan.md` and the Settings panel).
